import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';
import { questions as defaultQuestions, categories, type TriviaQuestion } from './data/questions.js';
import { loadConfig, type Config } from './config.js';
import { IdentityService } from './identity-service.js';
import { NostrService } from './nostr-service.js';
import { PaymentTracker } from './payment-tracker.js';
import { WalletService } from './wallet-service.js';

export const DEFAULT_WINNING_STREAK = 10;

export interface TriviaServerOptions {
    random?: () => number;
    questions?: TriviaQuestion[];
    winningStreak?: number;
    // Payment services (optional for testing)
    nostrService?: NostrService;
    paymentTracker?: PaymentTracker;
    walletService?: WalletService;
    config?: Config;
}

export interface ActiveQuestion {
    question: TriviaQuestion;
    shuffledOptions: string[];
    createdAt: number;  // Unix timestamp in milliseconds
}

export interface TriviaServerState {
    currentQuestions: Map<string, ActiveQuestion>;
    scores: Map<string, number>;
    askedQuestions: Map<string, Set<string>>; // userId -> Set of question IDs already asked
    lastActivity: Map<string, number>; // userId -> timestamp of last activity
}

// Pending payment waiters (for confirm_payment)
const pendingWaiters = new Map<string, {
    unicityId: string;
    waitForPayment: () => Promise<boolean>;
}>();

/**
 * Shuffles an array using the Fisher-Yates algorithm.
 * Returns a new shuffled array (does not mutate original).
 */
export const shuffleArray = <T>(array: T[], random: () => number): T[] => {
  const newArray = [...array];

  for (let i = newArray.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [newArray[i], newArray[j]] = [newArray[j], newArray[i]];
  }

  return newArray;
};

/**
 * Resolves a user's input to the specific option text if they typed a letter (a, b, c...),
 * otherwise returns their raw input trimmed.
 */
function resolveAnswerFromInput(input: string, options: string[]): string {
    const normalizedInput = input.toLowerCase().trim();
    const index = normalizedInput.charCodeAt(0) - 'a'.charCodeAt(0);

    // Check if input is a valid single-letter index within the bounds of the options
    if (normalizedInput.length === 1 && index >= 0 && index < options.length) {
        return options[index];
    }

    return input.trim();
}

export function createTriviaServer(options: TriviaServerOptions = {}): { server: McpServer; state: TriviaServerState } {
    const random = options.random ?? Math.random;
    const questions = options.questions ?? defaultQuestions;
    const winningStreak = options.winningStreak ?? DEFAULT_WINNING_STREAK;
    const nostrService = options.nostrService;
    const paymentTracker = options.paymentTracker;
    const walletService = options.walletService;
    const config = options.config;

    // Check if payment is enabled
    const paymentEnabled = !!(nostrService && paymentTracker && config);

    const server = new McpServer({
        name: 'trivia',
        version: '1.0.0',
    });

    const state: TriviaServerState = {
        currentQuestions: new Map(),
        scores: new Map(),
        askedQuestions: new Map(),
        lastActivity: new Map(),
    };

    /**
     * Normalize user ID to prevent mismatches like "@alice" vs "alice"
     * @param rawId - Raw user ID from tool call
     * @returns Normalized user ID (lowercase, trimmed, @ prefix removed)
     */
    function normalizeUserId(rawId: string): string {
        return rawId
            .toLowerCase()
            .trim()
            .replace(/^@+/, '');  // Remove leading @ symbols
    }

    /**
     * Structured logger for trivia state operations
     */
    function logStateOperation(
        operation: 'continue' | 'check_answer' | 'get_score',
        userId: string,
        details: Record<string, any>
    ) {
        const timestamp = new Date().toISOString();
        const logEntry = {
            timestamp,
            operation,
            userId,
            stateSize: {
                questions: state.currentQuestions.size,
                scores: state.scores.size,
            },
            ...details,
        };
        console.log(`[Trivia State] ${JSON.stringify(logEntry)}`);
    }

    /**
     * Clean up expired questions (older than 15 minutes)
     */
    function cleanupExpiredQuestions() {
        const now = Date.now();
        const QUESTION_EXPIRY_MS = 15 * 60 * 1000; // 15 minutes
        let cleaned = 0;

        for (const [userId, activeQ] of state.currentQuestions.entries()) {
            if (now - activeQ.createdAt > QUESTION_EXPIRY_MS) {
                state.currentQuestions.delete(userId);
                cleaned++;
                console.log(`[Trivia] Expired unanswered question for user: ${userId} (age: ${Math.round((now - activeQ.createdAt) / 1000)}s)`);
            }
        }

        if (cleaned > 0) {
            console.log(`[Trivia] Cleanup: removed ${cleaned} expired question(s)`);
        }
    }

    /**
     * Clean up inactive user state (scores, asked questions) after 1 hour of inactivity.
     * This keeps all user state together and releases memory for inactive users.
     */
    function cleanupInactiveUsers() {
        const now = Date.now();
        const INACTIVITY_EXPIRY_MS = 60 * 60 * 1000; // 1 hour
        let cleanedUsers = 0;

        for (const [userId, lastActivityTime] of state.lastActivity.entries()) {
            if (now - lastActivityTime > INACTIVITY_EXPIRY_MS) {
                // Clean up all state for this inactive user
                state.currentQuestions.delete(userId);
                state.scores.delete(userId);
                state.askedQuestions.delete(userId);
                state.lastActivity.delete(userId);
                cleanedUsers++;
                console.log(`[Trivia] Cleaned up inactive user: ${userId} (inactive for ${Math.round((now - lastActivityTime) / 60000)} minutes)`);
            }
        }

        if (cleanedUsers > 0) {
            console.log(`[Trivia] Cleanup: removed state for ${cleanedUsers} inactive user(s)`);
        }
    }

    // Run question cleanup every 5 minutes
    setInterval(cleanupExpiredQuestions, 5 * 60 * 1000);

    // Run user state cleanup every 10 minutes
    setInterval(cleanupInactiveUsers, 10 * 60 * 1000);

    // Tool: Check access (day pass status)
    server.tool(
        'check_access',
        'Check if user has valid day pass for trivia',
        {
            unicity_id: z.string().describe("User's Unicity ID (nametag)"),
        },
        async ({ unicity_id }) => {
            if (!paymentEnabled || !paymentTracker) {
                return {
                    content: [{ type: 'text', text: JSON.stringify({ hasAccess: true, message: 'Payment not required' }) }],
                };
            }

            const hasPass = paymentTracker.hasValidPass(unicity_id);
            const pass = paymentTracker.getPass(unicity_id);

            return {
                content: [{
                    type: 'text',
                    text: JSON.stringify({
                        hasAccess: hasPass,
                        expiresAt: pass ? new Date(pass.expiresAt).toISOString() : null,
                    }),
                }],
            };
        }
    );

    // Tool: Get categories
    server.tool(
        'get_categories',
        'Get all available trivia categories',
        {},
        async () => ({
            content: [{ type: 'text', text: JSON.stringify({ categories }) }],
        })
    );

    // Tool: Continue trivia game (stateful flow control)
    server.tool(
        'continue',
        'Continue the trivia game - returns current unanswered question or next question if ready. This is the main flow control tool.',
        {
            unicity_id: z.string().min(1).describe("User's Unicity ID (REQUIRED)"),
            category: z.string().optional().describe('Category to filter by (only used when getting a new question)'),
        },
        async ({ unicity_id, category }, extra) => {
            const userId = normalizeUserId(unicity_id);

            // Update last activity timestamp
            state.lastActivity.set(userId, Date.now());

            const activeQuestion = state.currentQuestions.get(userId);

            // Case 1: User has an unanswered question - return it again (idempotent)
            if (activeQuestion) {
                const questionAge = Date.now() - activeQuestion.createdAt;

                logStateOperation('continue', userId, {
                    action: 'repeat_question',
                    questionId: activeQuestion.question.id,
                    questionAge,
                });

                return {
                    content: [{
                        type: 'text',
                        text: JSON.stringify({
                            status: 'question_pending',
                            message: 'You have an unanswered question. Please answer it before continuing.',
                            questionId: activeQuestion.question.id,
                            //category: activeQuestion.question.category,
                            question: activeQuestion.question.question,
                            options: activeQuestion.shuffledOptions,
                            currentScore: state.scores.get(userId) || 0,
                        }),
                    }],
                };
            }

            // Case 2: No active question - get a new one
            console.log(`[Trivia] continue - userId: "${userId}" (raw: "${unicity_id}") - getting new question`);

            // Check payment if enabled
            if (paymentEnabled && paymentTracker && nostrService && config) {
                console.log("Payment enabled");

                if (!paymentTracker.hasValidPass(unicity_id)) {
                    console.log("Need to pay");
                    // Need to pay - send payment request
                    try {
                        const cleanId = unicity_id.replace("@unicity", "").replace("@", "").trim();
                        const userPubkey = await nostrService.resolvePubkey(cleanId);
                        console.log("User's public key: " + userPubkey);
                        if (!userPubkey) {
                            return {
                                content: [{
                                    type: 'text',
                                    text: JSON.stringify({
                                        error: 'Could not resolve Unicity ID',
                                        message: `No pubkey found for @${unicity_id}`,
                                    }),
                                }],
                            };
                        }

                        console.log("Will send payment request");
                        const { eventId, waitForPayment } = await nostrService.sendPaymentRequest(
                            unicity_id,
                            userPubkey
                        );

                        console.log("Will wait for response to the payment request");
                        // Store waiter for confirm_payment
                        pendingWaiters.set(eventId, { unicityId: unicity_id, waitForPayment });

                        const paymentReceived = waitForPayment().
                            then((paid) => {
                                if (paid) {
                                    console.log(`[Background] Payment received for ${unicity_id}! Granting pass.`);
                                    const pass = paymentTracker.grantDayPass(unicity_id);
                                } else {
                                    console.log(`[Background] Payment failed for ${eventId}`);
                                }
                                return paid;
                            })
                            .finally(() => {
                                pendingWaiters.delete(eventId);
                            });

                        return {
                            content: [{
                                type: 'text',
                                text: JSON.stringify({
                                    requiresPayment: true,
                                    paymentRequestEventId: eventId,
                                    message: 'Payment required. Use confirm_payment to wait for payment.',
                                    instructions: `Call confirm_payment(event_id="${eventId}") to wait for payment confirmation.`,
                                }),
                            }],
                        };
                    } catch (error) {
                        console.error("Error creating payment request:", error);
                        return {
                            content: [{
                                type: 'text',
                                text: JSON.stringify({
                                    error: 'Payment request failed',
                                    message: error instanceof Error ? error.message : String(error),
                                }),
                            }],
                        };
                    }
                }
            }

            // User has access (or payment not enabled) - return new question
            // Get the set of already-asked question IDs for this user
            let askedIds = state.askedQuestions.get(userId) || new Set();

            // Filter by category if specified
            let filtered = questions;
            if (category) {
                filtered = filtered.filter(q => q.category.toLowerCase() === category.toLowerCase());
            }

            // Filter out already-asked questions
            let available = filtered.filter(q => !askedIds.has(q.id));

            // If category is exhausted, suggest trying a different category
            if (available.length === 0 && category) {
                // Check if there are unasked questions in other categories
                const otherAvailable = questions.filter(q => !askedIds.has(q.id));

                if (otherAvailable.length > 0) {
                    // Get available categories
                    const availableCategories = [...new Set(otherAvailable.map(q => q.category))];

                    return {
                        content: [{
                            type: 'text',
                            text: JSON.stringify({
                                status: 'category_exhausted',
                                message: `You've answered all questions in the "${category}" category!`,
                                suggestion: `Try these categories: ${availableCategories.join(', ')}`,
                                availableCategories,
                                hint: 'Call trivia_continue without a category for random questions, or specify a different category.',
                            }),
                        }],
                    };
                }

                // All questions in this category exhausted and no other categories available
                // Fall through to reset logic below
            }

            // If all questions exhausted (or all in category exhausted with no alternatives), reset
            if (available.length === 0) {
                console.log(`[Trivia] Resetting asked questions for user ${userId} - all questions exhausted`);
                askedIds.clear();
                state.askedQuestions.set(userId, askedIds);
                available = filtered;

                logStateOperation('continue', userId, {
                    action: 'reset_questions',
                    message: 'All questions exhausted, starting over',
                });
            }

            if (available.length === 0) {
                return {
                    content: [{ type: 'text', text: JSON.stringify({ error: 'No questions found for criteria' }) }],
                };
            }

            // Select a random question from available ones
            const question = available[Math.floor(random() * available.length)];
            const shuffledOptions = shuffleArray([question.correctAnswer, ...question.incorrectAnswers], random);

            // Mark this question as asked
            askedIds.add(question.id);
            state.askedQuestions.set(userId, askedIds);

            state.currentQuestions.set(userId, {
                question,
                shuffledOptions,
                createdAt: Date.now(),
            });

            logStateOperation('continue', userId, {
                action: 'new_question',
                questionId: question.id,
                category: question.category,
                currentScore: state.scores.get(userId) || 0,
                questionsAsked: askedIds.size,
                questionsTotal: questions.length,
            });

            return {
                content: [{
                    type: 'text',
                    text: JSON.stringify({
                        status: 'new_question',
                        questionId: question.id,
                        //category: question.category,
                        question: question.question,
                        options: shuffledOptions,
                        currentScore: state.scores.get(userId) || 0,
                    }),
                }],
            };
        }
    );

    // Tool: Confirm payment (wait for payment and grant day pass)
    server.tool(
        'confirm_payment',
        'Wait for payment confirmation and grant day pass',
        {
            event_id: z.string().describe('Payment request event ID'),
        },
        async ({ event_id }) => {
            if (!paymentEnabled || !paymentTracker) {
                return {
                    content: [{ type: 'text', text: JSON.stringify({ error: 'Payment not enabled on this server' }) }],
                };
            }

            const waiter = pendingWaiters.get(event_id);
            if (!waiter) {
                return {
                    content: [{
                        type: 'text',
                        text: JSON.stringify({ error: 'No pending payment found for this event ID' }),
                    }],
                };
            }

            console.log(`[Trivia] Waiting for payment confirmation: ${event_id}`);

            const paymentReceived = await waiter.waitForPayment();
            pendingWaiters.delete(event_id);

            if (!paymentReceived) {
                return {
                    content: [{
                        type: 'text',
                        text: JSON.stringify({
                            status: 'timeout',
                            message: 'Payment not received in time. Please try again.',
                        }),
                    }],
                };
            }

            // Grant day pass
            const pass = paymentTracker.grantDayPass(waiter.unicityId);

            return {
                content: [{
                    type: 'text',
                    text: JSON.stringify({
                        status: 'success',
                        message: 'Payment received! Your day pass is now active.',
                        expiresAt: new Date(pass.expiresAt).toISOString(),
                    }),
                }],
            };
        }
    );

    // Tool: Check answer
    server.tool(
        'check_answer',
        'Check if the provided answer is correct for the current question',
        {
            unicity_id: z.string().min(1).describe("User's Unicity ID (REQUIRED)"),
            answer: z.string().describe('The user\'s answer (text or letter a/b/c/d)'),
        },
        async ({ unicity_id, answer }, extra) => {
            const userId = normalizeUserId(unicity_id);
            console.log(`[Trivia] check_answer - userId: "${userId}" (raw: "${unicity_id}")`);

            // Update last activity timestamp
            state.lastActivity.set(userId, Date.now());

            const activeQuestion = state.currentQuestions.get(userId);

            if (!activeQuestion) {
                // Idempotent behavior: Guide LLM to continue instead of erroring
                logStateOperation('check_answer', userId, {
                    info: 'already_answered',
                    message: 'Question already answered, guiding to continue',
                });
                return {
                    content: [{
                        type: 'text',
                        text: JSON.stringify({
                            status: 'already_processed',
                            message: 'This answer has already been checked. Let\'s move on!',
                            nextAction: 'Call trivia_continue to get the next question.',
                            guidance: 'Remember: Always call trivia_continue right after trivia_check_answer in the same response.',
                        })
                    }],
                };
            }

            logStateOperation('check_answer', userId, {
                questionId: activeQuestion.question.id,
                userAnswer: answer,
            });

            const { question, shuffledOptions } = activeQuestion;

            const answerText = resolveAnswerFromInput(answer, shuffledOptions);

            const isCorrect = answerText.toLowerCase() === question.correctAnswer.toLowerCase();

            let newScore: number;
            let award = false;

            if (isCorrect) {
                newScore = (state.scores.get(userId) || 0) + 1;
                if (newScore >= winningStreak) {
                    award = true;
                    // TODO: Actually send NFT to userId here (see PLAN_NFT_SENDING.md)
                    console.log(`[Trivia] User ${userId} earned an award! Sending NFT...`);
                    state.scores.set(userId, 0); // Reset after award
                } else {
                    state.scores.set(userId, newScore);
                }
            } else {
                newScore = 0;
                state.scores.set(userId, 0);
            }

            state.currentQuestions.delete(userId);

            return {
                content: [{
                    type: 'text',
                    text: JSON.stringify({
                        correct: isCorrect,
                        correctAnswer: question.correctAnswer,
                        explanation: isCorrect
                            ? 'Great job!'
                            : `The correct answer was: ${question.correctAnswer}`,
                        nextAction: 'Call trivia_continue to get your next question',
                        newScore,
                        ...(award && { award: true }),
                    }),
                }],
            };
        }
    );

    // Tool: Get score
    server.tool(
        'get_score',
        'Get the current score for the user',
        {
            unicity_id: z.string().min(1).describe("User's Unicity ID (REQUIRED)"),
        },
        async ({ unicity_id }, extra) => {
            const userId = normalizeUserId(unicity_id);
            console.log(`[Trivia] get_score - userId: "${userId}" (raw: "${unicity_id}")`);

            // Update last activity timestamp
            state.lastActivity.set(userId, Date.now());

            logStateOperation('get_score', userId, {
                score: state.scores.get(userId) || 0,
                hasActiveQuestion: state.currentQuestions.has(userId),
            });

            return {
                content: [{
                    type: 'text',
                    text: JSON.stringify({ score: state.scores.get(userId) || 0 }),
                }],
            };
        }
    );

    // Tool: Get wallet balance (admin only)
    server.tool(
        'get_wallet_balance',
        'Get the wallet balance for the trivia server (admin only)',
        {
            admin_password: z.string().describe('Admin password for authentication'),
        },
        async ({ admin_password }) => {
            if (!config || !walletService) {
                return {
                    content: [{ type: 'text', text: JSON.stringify({ error: 'Wallet service not available' }) }],
                };
            }

            if (admin_password !== config.adminPassword) {
                return {
                    content: [{ type: 'text', text: JSON.stringify({ error: 'Invalid admin password' }) }],
                };
            }

            try {
                const summary = await walletService.getWalletSummary();
                return {
                    content: [{
                        type: 'text',
                        text: JSON.stringify({
                            totalTokens: summary.totalTokens,
                            balances: summary.balances.map(b => ({
                                coinId: b.coinId,
                                amount: b.amount.toString(),
                                tokenCount: b.tokenCount,
                            })),
                        }),
                    }],
                };
            } catch (error) {
                return {
                    content: [{
                        type: 'text',
                        text: JSON.stringify({
                            error: 'Failed to get wallet balance',
                            message: error instanceof Error ? error.message : String(error),
                        }),
                    }],
                };
            }
        }
    );

    return { server, state };
}

// Start server with HTTP transport
async function main() {
    let config: Config;
    let identityService: IdentityService | null = null;
    let nostrService: NostrService | null = null;
    let paymentTracker: PaymentTracker | null = null;
    let walletService: WalletService | null = null;

    // Try to load payment config
    try {
        config = loadConfig();

        console.log('[Trivia] Payment configuration loaded');
        console.log(`[Trivia] Nametag: @${config.nametag}`);

        // Initialize payment services
        identityService = new IdentityService(config);
        await identityService.initialize();

        nostrService = new NostrService(config, identityService);
        await nostrService.connect();

        paymentTracker = new PaymentTracker(config.dayPassHours);
        walletService = new WalletService(config);

        console.log('[Trivia] Payment services initialized');
    } catch (error) {
        console.log('[Trivia] Payment not configured, running in free mode');
        console.log(`[Trivia] Reason: ${error instanceof Error ? error.message : String(error)}`);
        console.log(error);

        // Create minimal config for non-payment mode
        config = {
            port: parseInt(process.env.PORT || '3001', 10),
            winningStreak: parseInt(process.env.WINNING_STREAK || '10', 10),
        } as Config;
    }

    const port = config.port || parseInt(process.env.PORT || '3001', 10);
    const winningStreak = config.winningStreak || DEFAULT_WINNING_STREAK;
    console.log(`[Trivia] Winning streak set to: ${winningStreak}`);

    const { server } = createTriviaServer({
        winningStreak,
        nostrService: nostrService || undefined,
        paymentTracker: paymentTracker || undefined,
        walletService: walletService || undefined,
        config: nostrService ? config : undefined,
    });

    const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
    });

    await server.connect(transport);

    const httpServer = createServer((req, res) => {
        if (req.url === '/mcp') {
            transport.handleRequest(req, res);
        } else {
            res.writeHead(404);
            res.end('Not Found');
        }
    });

    httpServer.listen(port, () => {
        console.log(`Trivia MCP server running on port ${port}`);
    });
}

// Only start server when run directly (not imported for testing)
const isMainModule = import.meta.url === `file://${process.argv[1]}`;
if (isMainModule) {
    main().catch(console.error);
}
