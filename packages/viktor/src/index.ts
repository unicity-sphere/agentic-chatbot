import { startSphereBot } from '@agentic/sphere-bot';
import { loadConfig } from './config.js';

startSphereBot(loadConfig()).catch((error) => {
  console.error('[viktor] Fatal:', error);
  process.exit(1);
});
