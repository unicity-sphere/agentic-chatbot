import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';
import { questions as defaultQuestions, categories, type TriviaQuestion } from './data/questions.js';

export interface TriviaServerOptions {
    random?: () => number;
    questions?: TriviaQuestion[];
}

export interface ActiveQuestion {
    question: TriviaQuestion;
    shuffledOptions: string[];
}

export interface TriviaServerState {
    currentQuestions: Map<string, ActiveQuestion>;
    scores: Map<string, number>;
}

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

    const server = new McpServer({
        name: 'trivia',
        version: '1.0.0',
    });

    const state: TriviaServerState = {
        currentQuestions: new Map(),
        scores: new Map(),
    };

    // Tool: Get categories
    server.tool(
        'get_categories',
        'Get all available trivia categories',
        {},
        async () => ({
            content: [{ type: 'text', text: JSON.stringify({ categories }) }],
        })
    );

    // Tool: Get a question
    server.tool(
        'get_question',
        'Get a random trivia question, optionally filtered by category',
        {
            category: z.string().optional().describe('Category to filter by')
        },
        async ({ category }, extra) => {
            const userId = (extra as any)?.meta?.userId || 'anonymous';

            let filtered = questions;
            if (category) {
                filtered = filtered.filter(q => q.category.toLowerCase() === category.toLowerCase());
            }

            if (filtered.length === 0) {
                return {
                    content: [{ type: 'text', text: JSON.stringify({ error: 'No questions found for criteria' }) }],
                };
            }

            const question = filtered[Math.floor(random() * filtered.length)];
            const shuffledOptions = shuffleArray([question.correctAnswer, ...question.incorrectAnswers], random);
            state.currentQuestions.set(userId, { question, shuffledOptions });

            return {
                content: [{
                    type: 'text',
                    text: JSON.stringify({
                        questionId: question.id,
                        category: question.category,
                        question: question.question,
                        options: shuffledOptions,
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
            answer: z.string().describe('The user\'s answer (text or letter a/b/c/d)'),
        },
        async ({ answer }, extra) => {
            const userId = (extra as any)?.meta?.userId || 'anonymous';
            const activeQuestion = state.currentQuestions.get(userId);

            if (!activeQuestion) {
                return {
                    content: [{ type: 'text', text: JSON.stringify({ error: 'No active question. Get a question first.' }) }],
                };
            }

            const { question, shuffledOptions } = activeQuestion;

            const answerText = resolveAnswerFromInput(answer, shuffledOptions);

            const isCorrect = answerText.toLowerCase() === question.correctAnswer.toLowerCase();

            if (isCorrect) {
                const currentScore = state.scores.get(userId) || 0;
                state.scores.set(userId, currentScore + 1);
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
                        newScore: state.scores.get(userId) || 0,
                    }),
                }],
            };
        }
    );

    // Tool: Get score
    server.tool(
        'get_score',
        'Get the current score for the user',
        {},
        async (_, extra) => {
            const userId = (extra as any)?.meta?.userId || 'anonymous';
            return {
                content: [{
                    type: 'text',
                    text: JSON.stringify({ score: state.scores.get(userId) || 0 }),
                }],
            };
        }
    );

    return { server, state };
}

// Start server with HTTP transport
async function main() {
    const port = parseInt(process.env.PORT || '3001');

    const { server } = createTriviaServer();

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
