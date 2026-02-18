import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { serve } from '@hono/node-server';
import type { SphereBotConfig } from './types.js';
import type { SphereBot } from './bot.js';

export function createApp(config: SphereBotConfig, bot: SphereBot): Hono {
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
      bot: config.name,
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
      console.error(`[HTTP:${config.name}] Error in /api/notify:`, error);
      return c.json({ error: 'Internal server error' }, 500);
    }
  });

  return app;
}

export function startServer(app: Hono, config: SphereBotConfig): void {
  serve({ fetch: app.fetch, port: config.port });
  console.log(`[${config.name}] HTTP server listening on http://localhost:${config.port}`);
}
