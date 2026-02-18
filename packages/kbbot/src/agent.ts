import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { generateText, stepCountIs, type ModelMessage } from 'ai';
import type { KBBotConfig } from './config.js';
import type { McpToolManager } from './mcp-client.js';

const SYSTEM_PROMPT = `You are KBBot, a helpful knowledge base assistant for the Unicity ecosystem. You answer questions about Unicity, AgentSphere, Sphere wallet, agentic commerce, and related topics.

## Tool usage — follow this priority order, answer as early as possible:

1. **Search the local knowledge base** (rag_* tools). If results are sufficient, answer immediately.
2. **Search the web** (web_search). Only if RAG had no relevant results. If search snippets are sufficient, answer immediately.
3. **Fetch ONE web page** (web_fetch). Only if you need the full content of a specific page found in step 2. Then answer.

Generate your answer as soon as you have enough information — do not proceed to the next step if the current one already gave you what you need. Never retry a search with a rephrased query. Never fetch more than one page.

**Known Unicity GitHub organizations:**
- https://github.com/unicitynetwork — official Unicity GitHub organization
- https://github.com/unicity-sphere — Sphere ecosystem

You can fetch raw README files directly, e.g.: https://raw.githubusercontent.com/unicitynetwork/{repo}/main/README.md

## Guidelines

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
    console.log(`[Agent] LLM model=${config.llmModel} baseUrl=${config.llmBaseUrl || '(default)'}`);
  }

  async respond(userMessage: string, history: ModelMessage[]): Promise<string> {
    try {
      const messages: ModelMessage[] = [
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
        stopWhen: stepCountIs(4),  // This is a balance - fail fast vs spend time web searching 
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

      // LLM exhausted tool-call steps without producing a text answer.
      // Extract tool results and ask a clean question without tool-call message pairs.
      if (lastStep?.finishReason === 'tool-calls') {
        console.warn(`[Agent] Exhausted ${result.steps.length} steps on tool calls, forcing text generation`);

        // Collect text from all tool results across steps
        const toolTexts: string[] = [];
        for (const step of result.steps) {
          for (const toolResult of step.toolResults) {
            const text = typeof toolResult.output === 'string'
              ? toolResult.output
              : JSON.stringify(toolResult.output);
            if (text && text.length > 0) {
              toolTexts.push(`[${toolResult.toolName}]: ${text.slice(0, 8000)}`);
            }
          }
        }

        console.log(`[Agent] Collected ${toolTexts.length} tool results for forced generation`);

        const followUp = await generateText({
          model: this.model,
          system: SYSTEM_PROMPT,
          messages: [
            ...messages,
            { role: 'user', content: `Here is the information gathered from tool searches:\n\n${toolTexts.join('\n\n')}\n\nBased on this information, answer the original question. If the information is not relevant, say you couldn't find the answer.` },
          ],
        });

        if (followUp.text) {
          return followUp.text;
        }
        console.warn('[Agent] Forced generation also empty, finishReason:', followUp.steps[followUp.steps.length - 1]?.finishReason);
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
