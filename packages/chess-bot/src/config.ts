export interface ChessBotConfig {
  /** Bot's nametag on Sphere (e.g. "chess-bot") */
  nametag: string;
  /** Network: mainnet, testnet, or dev */
  network: string;
  /** Directory for wallet persistence */
  dataDir: string;
  /** Directory for token state */
  tokensDir: string;
  /** UCT coin identifier (full hash) */
  uctCoinId: string;
  /** UCT decimal places for amount conversion */
  uctDecimals: number;
  /** Max number of simultaneous games */
  maxConcurrentGames: number;
  /** Faucet URL for auto-top-up (testnet only) */
  faucetUrl: string;
  /** Amount of UCT to request from faucet when balance is low */
  faucetTopUpAmount: number;
  /** Group chat ID for posting game results (optional) */
  groupId?: string;
}

export function loadConfig(): ChessBotConfig {
  return {
    nametag: process.env.BOT_NAMETAG || 'chess-bot',
    network: process.env.NETWORK || 'testnet',
    dataDir: process.env.DATA_DIR || './data/chess-bot/data',
    tokensDir: process.env.TOKENS_DIR || './data/chess-bot/tokens',
    uctCoinId:
      process.env.UCT_COIN_ID ||
      '455ad8720656b08e8dbd5bac1f3c73eeea5431565f6c1c3af742b1aa12d41d89',
    uctDecimals: parseInt(process.env.UCT_DECIMALS || '8', 10),
    maxConcurrentGames: parseInt(process.env.MAX_CONCURRENT_GAMES || '10', 10),
    faucetUrl:
      process.env.FAUCET_URL ||
      'https://faucet.unicity.network/api/v1/faucet/request',
    faucetTopUpAmount: parseInt(process.env.FAUCET_TOPUP_AMOUNT || '100', 10),
    groupId: process.env.GROUP_ID || undefined,
  };
}
