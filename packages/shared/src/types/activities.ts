import { z } from 'zod';

export const LLMConfigSchema = z.object({
    provider: z.enum(['gemini', 'openai-compatible']),
    model: z.string(),
    // For OpenAI-compatible: supports single endpoint or array for failover
    baseUrl: z.union([z.string(), z.array(z.string())]).optional(),
    apiKey: z.union([z.string(), z.array(z.string())]).optional(),
    temperature: z.number().default(0.7),
});

export const McpServerConfigSchema = z.object({
    name: z.string(),
    url: z.string(),
    apiKey: z.string().optional(),
});

export const ActivityConfigSchema = z.object({
    id: z.string(),
    name: z.string(),
    description: z.string(),
    systemPrompt: z.string(),
    greetingMessage: z.string().optional(),
    llm: LLMConfigSchema,
    mcpServers: z.array(McpServerConfigSchema),
    localTools: z.array(z.string()),
    theme: z.object({
        primaryColor: z.string(),
        name: z.string(),
    }).optional(),
    persistChatHistory: z.boolean().default(true).optional(),
    // Message history limits (0 = no limit)
    maxHistoryBytes: z.number().default(30000).optional(), // Default ~7-8k tokens
    maxHistoryMessages: z.number().default(0).optional(), // 0 = no message count limit, 1 = only latest, etc.
});

export type ActivityConfig = z.infer<typeof ActivityConfigSchema>;
export type LLMConfig = z.infer<typeof LLMConfigSchema>;
export type McpServerConfig = z.infer<typeof McpServerConfigSchema>;
