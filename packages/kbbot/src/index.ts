import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { serve } from '@hono/node-server';
import { loadConfig } from './config.js';
import { McpToolManager } from './mcp-client.js';
import { KBBotAgent } from './agent.js';
import { KBBot } from './bot.js';

async function main() {
  const config = loadConfig();
  console.log('[KBBot] Starting with config:', {
    port: config.port,
    network: config.network,
    botNametag: config.botNametag,
    llmModel: config.llmModel,
    mcpRagUrl: config.mcpRagUrl,
    mcpWebUrl: config.mcpWebUrl,
  });

  // MCP tool manager — connections are lazy (established on first DM)
  const toolManager = new McpToolManager();
  toolManager.addServer('rag', config.mcpRagUrl);
  toolManager.addServer('web', config.mcpWebUrl);

  // Create agent and bot
  const agent = new KBBotAgent(config, toolManager);
  const bot = new KBBot(config, agent);
  await bot.start();

  // HTTP server
  const app = new Hono();
  app.use('*', logger());

  const corsOrigins = config.corsOrigin.split(',').map(o => o.trim());
  app.use('*', cors({
    origin: (origin) => {
      if (!origin) return corsOrigins[0];
      return corsOrigins.includes(origin) ? origin : corsOrigins[0];
    },
  }));

  app.get('/health', (c) => {
    const identity = bot.identity;
    return c.json({
      status: 'ok',
      nametag: identity?.nametag ?? null,
      directAddress: identity?.directAddress ?? null,
    });
  });

  app.post('/api/notify', async (c) => {
    try {
      const body = await c.req.json() as { pubkey?: string; nametag?: string };
      if (!body.pubkey || typeof body.pubkey !== 'string') {
        return c.json({ error: 'pubkey is required' }, 400);
      }
      await bot.notifyNewUser(body.pubkey, body.nametag);
      return c.json({ ok: true });
    } catch (error) {
      console.error('[HTTP] Error in /api/notify:', error);
      return c.json({ error: 'Internal server error' }, 500);
    }
  });

  serve({ fetch: app.fetch, port: config.port });
  console.log(`[KBBot] HTTP server listening on http://localhost:${config.port}`);

  // Graceful shutdown
  const shutdown = async () => {
    console.log('[KBBot] Shutting down...');
    await bot.destroy();
    await toolManager.disconnect();
    process.exit(0);
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

main().catch((error) => {
  console.error('[KBBot] Fatal error:', error);
  process.exit(1);
});
