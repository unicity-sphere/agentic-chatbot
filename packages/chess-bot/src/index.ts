import { ChessBot } from './chess-bot.js';
import { loadConfig } from './config.js';

const config = loadConfig();
const bot = new ChessBot(config);

bot.start().catch((error) => {
  console.error('[chess-bot] Fatal:', error);
  process.exit(1);
});

const shutdown = async () => {
  console.log('[chess-bot] Shutting down...');
  await bot.destroy();
  process.exit(0);
};

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
