import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import type { LLMConfig } from '@agentic/shared';
import { endpointFailoverManager, createFailoverFetch } from './failover.js';
// import { createLoggingFetch } from './fetch-interceptor.js';

/**
 * Parse comma-separated string into array, or return single value/array as-is
 */
function parseCommaSeparated(value: string | string[] | undefined): string[] | string | undefined {
    if (!value) return undefined;
    if (Array.isArray(value)) return value;

    // Check if it contains commas (failover list)
    if (value.includes(',')) {
        const items = value.split(',').map(s => s.trim()).filter(s => s.length > 0);
        return items.length > 1 ? items : items[0];
    }

    return value;
}

/**
 * Create a stable config ID based on endpoint URLs
 * This ensures health state persists across provider recreations
 */
function createStableConfigId(baseUrls: string[]): string {
    // Use a hash of the URLs to create a stable, unique ID
    const urlString = baseUrls.join('|');
    let hash = 0;
    for (let i = 0; i < urlString.length; i++) {
        const char = urlString.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash = hash & hash; // Convert to 32-bit integer
    }
    return `openai-${Math.abs(hash)}`;
}

export function createLLMProvider(config: LLMConfig, context?: { requestId?: string }) {

    switch (config.provider) {
        case 'gemini': {
            // Validate API key exists
            if (!process.env.GOOGLE_API_KEY) {
                const error = new Error('GOOGLE_API_KEY environment variable is not set');
                console.error('[Provider] Gemini API key missing');
                throw error;
            }

            // Validate model name
            if (!config.model || config.model.trim() === '') {
                const error = new Error('Model name is required for Gemini provider');
                console.error('[Provider] Invalid model configuration:', config);
                throw error;
            }

            try {
                console.log('[Provider] Initializing Gemini with model:', config.model);
                const google = createGoogleGenerativeAI({
                    apiKey: process.env.GOOGLE_API_KEY,
                    // enable for debugging raw responses from llm
                    // fetch: context ? createLoggingFetch(context) : undefined,
                });
                const model = google(config.model);
                return model;
            } catch (error) {
                console.error('[Provider] Failed to create Gemini provider:', error);
                console.error('[Provider] Config:', JSON.stringify(config));
                throw error;
            }
        }
        case 'openai-compatible': {
            // Validate base URL
            if (!config.baseUrl) {
                const error = new Error('baseUrl is required for openai-compatible provider');
                console.error('[Provider] Missing baseUrl in config:', config);
                throw error;
            }

            // Validate model name
            if (!config.model || config.model.trim() === '') {
                const error = new Error('Model name is required for OpenAI-compatible provider');
                console.error('[Provider] Invalid model configuration:', config);
                throw error;
            }

            try {
                // Parse comma-separated values into arrays if needed
                const parsedBaseUrl = parseCommaSeparated(config.baseUrl);
                const parsedApiKey = parseCommaSeparated(config.apiKey);

                // Handle single endpoint or multiple endpoints for failover
                const baseUrls = Array.isArray(parsedBaseUrl) ? parsedBaseUrl : [parsedBaseUrl || 'https://api.openai.com/v1'];
                const apiKeys = Array.isArray(parsedApiKey) ? parsedApiKey : [parsedApiKey];

                // Validate array lengths match if both are arrays
                if (Array.isArray(parsedBaseUrl) && Array.isArray(parsedApiKey)) {
                    if (baseUrls.length !== apiKeys.length) {
                        const error = new Error('baseUrl and apiKey arrays must have the same length');
                        console.error('[Provider] Array length mismatch:', { baseUrls: baseUrls.length, apiKeys: apiKeys.length });
                        throw error;
                    }
                }

                // Setup failover if multiple endpoints are provided
                let customFetch: typeof fetch | undefined;
                const primaryBaseUrl = baseUrls[0];
                const primaryApiKey = apiKeys[0];

                if (baseUrls.length > 1) {
                    // Create stable config ID based on URLs so health state persists
                    const configId = createStableConfigId(baseUrls);
                    const endpoints = baseUrls.map((url, i) => ({
                        url,
                        apiKey: apiKeys[i],
                    }));

                    console.log(`[Provider] Registering ${endpoints.length} failover endpoints with ID ${configId}`);
                    endpointFailoverManager.registerEndpoints(configId, endpoints);

                    // Use failover fetch wrapper with primary base URL for origin replacement
                    customFetch = createFailoverFetch(configId, primaryBaseUrl);
                } else {
                    console.log('[Provider] Initializing OpenAI-compatible provider:', primaryBaseUrl);
                }

                const provider = createOpenAICompatible({
                    baseURL: primaryBaseUrl,
                    apiKey: primaryApiKey || 'not-needed',
                    name: 'custom-llm',
                    fetch: customFetch,
                    // fetch: context ? createLoggingFetch(context) : undefined,
                });
                const model = provider.chatModel(config.model);
                return model;
            } catch (error) {
                console.error('[Provider] Failed to create OpenAI-compatible provider:', error);
                console.error('[Provider] Config:', JSON.stringify(config));
                throw error;
            }
        }
        default: {
            const error = new Error(`Unknown LLM provider: ${config.provider}`);
            console.error('[Provider] Invalid provider configuration:', config);
            throw error;
        }
    }
}
