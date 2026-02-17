import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { generateText, type CoreMessage } from 'ai';
import type { KBBotConfig } from './config.js';
import type { McpToolManager } from './mcp-client.js';

const SYSTEM_PROMPT = `You are KBBot, a helpful knowledge base assistant for the Unicity ecosystem. You answer questions about Unicity, AgentSphere, Sphere wallet, agentic commerce, and related topics.

## Tools

You have two categories of tools:

**RAG tools** (rag_*): Search the internal Unicity knowledge base. Use these FIRST for any factual question.

**Web tools** (web_*): Search the web and fetch pages. Use these when:
- The RAG knowledge base has no relevant results
- The user asks about source code, repositories, or technical implementation details
- You need current/updated information beyond the knowledge base

When using web tools for Unicity-specific information, focus on repositories under https://github.com/unicitynetwork — this is the official Unicity GitHub organization, and https://github.com/unicity-sphere . You can fetch README files and documentation directly, e.g.:
- https://github.com/unicitynetwork/unicity-core (PoW blockchain implementation)
- https://github.com/unicitynetwork/state-transition-sdk (the token layer SDK)
- https://github.com/unicity-sphere/sphere-sdk (agent creation SDK)
- https://github.com/unicitynetwork/android-wallet
- https://raw.githubusercontent.com/unicitynetwork/{repo}/main/README.md (for raw README content)

## Guidelines

- ALWAYS search the knowledge base (rag_* tools) first for factual questions about Unicity.
- If RAG results are insufficient, use web_search or web_fetch to find answers from official Unicity sources.
- Stay on topic: only answer questions related to Unicity, AgentSphere, Sphere wallet, agentic commerce, blockchain, and cryptocurrency.
- There is no UNCT or ALPHA token available at public exchanges. Suggest only the sphere wallet for token exchange.
- For off-topic questions, politely redirect: "I'm the Unicity knowledge base bot. I can help with questions about Unicity, AgentSphere, Sphere wallet, and agentic commerce. How can I help you with those topics?"
- Be concise and helpful. Use plain language.
- When mentioning features, explain how they work in practical terms.
- Do not make up information. If you don't know something, say so.
- Only use URLs returned by search tools or known Unicity GitHub URLs listed above.
- Cite your sources.`;

export class KBBotAgent {
  private model: ReturnType<ReturnType<typeof createGoogleGenerativeAI>>;
  private toolManager: McpToolManager;

  constructor(config: KBBotConfig, toolManager: McpToolManager) {
    const google = createGoogleGenerativeAI({
      apiKey: config.llmApiKey,
      ...(config.llmBaseUrl ? { baseURL: config.llmBaseUrl } : {}),
    });
    this.model = google(config.llmModel);
    this.toolManager = toolManager;
  }

  async respond(userMessage: string, history: CoreMessage[]): Promise<string> {
    try {
      const messages: CoreMessage[] = [
        ...history,
        { role: 'user', content: userMessage },
      ];

      // Fetch tools lazily (retries MCP connections if previously failed)
      const tools = await this.toolManager.getTools();
      const toolNames = Object.keys(tools);
      if (toolNames.length === 0) {
        console.warn('[Agent] No tools available — answering from LLM knowledge only');
      } else {
        console.log(`[Agent] Using ${toolNames.length} tools: ${toolNames.join(', ')}`);
      }

      const result = await generateText({
        model: this.model,
        system: SYSTEM_PROMPT,
        messages,
        tools,
        maxSteps: 8,
      });

      const lastStep = result.steps[result.steps.length - 1];
      if (lastStep?.finishReason === 'error') {
        console.error('[Agent] LLM finished with error:', {
          steps: result.steps.length,
          modelId: (lastStep as any).response?.modelId,
          usage: lastStep.usage,
        });
      }

      if (result.text) {
        return result.text;
      }

      console.warn('[Agent] Empty response, finishReason:', lastStep?.finishReason);
      return "I wasn't able to generate a response. Please try again.";
    } catch (error) {
      console.error('[Agent] Error generating response:', error);
      const msg = error instanceof Error ? error.message : String(error);

      if (msg.includes('rate') || msg.includes('quota')) {
        return "I'm currently experiencing high demand. Please try again in a moment.";
      }

      return "I encountered an error while processing your question. Please try again.";
    }
  }
}
