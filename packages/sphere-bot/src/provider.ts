import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import type { LanguageModel } from 'ai';
import type { SphereBotConfig } from './types.js';

export function createModel(config: SphereBotConfig): LanguageModel {
  const { llm } = config;

  switch (llm.provider) {
    case 'google': {
      const google = createGoogleGenerativeAI({
        apiKey: llm.apiKey,
        ...(llm.baseUrl ? { baseURL: llm.baseUrl } : {}),
      });
      return google(llm.model);
    }
    case 'openai-compatible': {
      if (!llm.baseUrl) {
        throw new Error('baseUrl is required for openai-compatible provider');
      }
      const provider = createOpenAICompatible({
        baseURL: llm.baseUrl,
        apiKey: llm.apiKey || 'not-needed',
        name: `${config.name}-llm`,
      });
      return provider.chatModel(llm.model);
    }
    default:
      throw new Error(`Unknown LLM provider: ${(llm as any).provider}`);
  }
}
