export interface KBBotConfig {
  port: number;
  corsOrigin: string;
  network: 'mainnet' | 'testnet' | 'dev';
  dataDir: string;
  tokensDir: string;
  botNametag: string;
  llmApiKey: string;
  llmModel: string;
  llmBaseUrl?: string;
  mcpRagUrl: string;
  mcpWebUrl: string;
  welcomeDelayMs: number;
  maxHistoryMessages: number;
}

export function loadConfig(): KBBotConfig {
  const llmApiKey = process.env.KBBOT_LLM_API_KEY;
  if (!llmApiKey) {
    throw new Error('KBBOT_LLM_API_KEY environment variable is required');
  }

  return {
    port: parseInt(process.env.PORT || '3004', 10),
    corsOrigin: process.env.CORS_ORIGIN || 'http://localhost:5173',
    network: (process.env.NETWORK || 'testnet') as KBBotConfig['network'],
    dataDir: process.env.DATA_DIR || '/app/data',
    tokensDir: process.env.TOKENS_DIR || '/app/tokens',
    botNametag: process.env.BOT_NAMETAG || 'kbbot',
    llmApiKey,
    llmModel: process.env.KBBOT_LLM_MODEL || 'gemini-2.0-flash',
    llmBaseUrl: process.env.KBBOT_LLM_BASE_URL || undefined,
    mcpRagUrl: process.env.MCP_RAG_URL || 'http://mcp-rag:3003/mcp',
    mcpWebUrl: process.env.MCP_WEB_URL || 'http://mcp-web:3002/mcp',
    welcomeDelayMs: parseInt(process.env.WELCOME_DELAY_MS || '4000', 10),
    maxHistoryMessages: parseInt(process.env.MAX_HISTORY_MESSAGES || '20', 10),
  };
}
