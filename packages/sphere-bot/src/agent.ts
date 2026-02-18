import { generateText, stepCountIs, type ModelMessage, type LanguageModel } from 'ai';
import type { SphereBotConfig } from './types.js';
import type { McpToolManager } from './mcp-client.js';
import { createModel } from './provider.js';

export class SphereBotAgent {
  private model: LanguageModel;
  private toolManager: McpToolManager;
  private config: SphereBotConfig;
  private prefix: string;

  constructor(config: SphereBotConfig, toolManager: McpToolManager) {
    this.config = config;
    this.model = createModel(config);
    this.toolManager = toolManager;
    this.prefix = `[Agent:${config.name}]`;
    console.log(`${this.prefix} LLM provider=${config.llm.provider} model=${config.llm.model} baseUrl=${config.llm.baseUrl || '(default)'}`);
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
        console.warn(`${this.prefix} No tools available — answering from LLM knowledge only`);
      } else {
        console.log(`${this.prefix} Using ${toolNames.length} tools: ${toolNames.join(', ')}`);
      }

      const result = await generateText({
        model: this.model,
        system: this.config.systemPrompt,
        messages,
        tools,
        stopWhen: stepCountIs(this.config.maxSteps),
        ...(this.config.llm.temperature !== undefined ? { temperature: this.config.llm.temperature } : {}),
      });

      const lastStep = result.steps[result.steps.length - 1];
      if (lastStep?.finishReason === 'error') {
        console.error(`${this.prefix} LLM finished with error:`, {
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
        console.warn(`${this.prefix} Exhausted ${result.steps.length} steps on tool calls, forcing text generation`);

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

        console.log(`${this.prefix} Collected ${toolTexts.length} tool results for forced generation`);

        const followUp = await generateText({
          model: this.model,
          system: this.config.systemPrompt,
          messages: [
            ...messages,
            { role: 'user', content: `Here is the information gathered from tool searches:\n\n${toolTexts.join('\n\n')}\n\nBased on this information, answer the original question. If the information is not relevant, say you couldn't find the answer.` },
          ],
          ...(this.config.llm.temperature !== undefined ? { temperature: this.config.llm.temperature } : {}),
        });

        if (followUp.text) {
          return followUp.text;
        }
        console.warn(`${this.prefix} Forced generation also empty, finishReason:`, followUp.steps[followUp.steps.length - 1]?.finishReason);
      }

      console.warn(`${this.prefix} Empty response, finishReason:`, lastStep?.finishReason);
      return "I wasn't able to generate a response. Please try again.";
    } catch (error) {
      console.error(`${this.prefix} Error generating response:`, error);
      const msg = error instanceof Error ? error.message : String(error);

      if (msg.includes('rate') || msg.includes('quota')) {
        return "I'm currently experiencing high demand. Please try again in a moment.";
      }

      return "I encountered an error while processing your question. Please try again.";
    }
  }
}
