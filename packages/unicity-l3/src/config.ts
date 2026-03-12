export interface L3Config {
  network: 'mainnet' | 'testnet' | 'dev';
  nametag: string;
  dataDir: string;
  tokensDir: string;
  aggregatorUrl: string;
  explorerBaseUrl: string;
  groupId: string;
  pollIntervalMs: number;
}

export function loadConfig(): L3Config {
  const groupId = process.env.GROUP_ID;
  if (!groupId) {
    throw new Error('GROUP_ID environment variable is required');
  }

  return {
    network: (process.env.NETWORK || 'testnet') as L3Config['network'],
    nametag: process.env.BOT_NAMETAG || 'unicity-l3',
    dataDir: process.env.DATA_DIR || '/app/data',
    tokensDir: process.env.TOKENS_DIR || '/app/tokens',
    aggregatorUrl: process.env.AGGREGATOR_URL || 'https://goggregator-test.unicity.network/',
    explorerBaseUrl: process.env.EXPLORER_BASE_URL || 'https://unicitynetwork.github.io/smt-explorer/',
    groupId,
    pollIntervalMs: parseInt(process.env.POLL_INTERVAL_MS || '10000', 10),
  };
}
