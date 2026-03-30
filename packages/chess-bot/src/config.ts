export interface ChessBotConfig {
  /** Bot's nametag on Sphere (e.g. "chess-bot") */
  nametag: string;
  /** Network: mainnet, testnet, or dev */
  network: string;
  /** Directory for wallet persistence */
  dataDir: string;
  /** Directory for token state */
  tokensDir: string;
  /** Max number of simultaneous games */
  maxConcurrentGames: number;
  /** Group chat ID for posting game results (optional) */
  groupId?: string;
}

export function loadConfig(): ChessBotConfig {
  return {
    nametag: process.env.BOT_NAMETAG || 'chess-bot',
    network: process.env.NETWORK || 'testnet',
    dataDir: process.env.DATA_DIR || './data/chess-bot/data',
    tokensDir: process.env.TOKENS_DIR || './data/chess-bot/tokens',
    maxConcurrentGames: parseInt(process.env.MAX_CONCURRENT_GAMES || '10', 10),
    groupId: process.env.GROUP_ID || undefined,
  };
}
