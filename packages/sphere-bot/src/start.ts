import WebSocket from 'ws';
import { McpToolManager } from './mcp-client.js';
import { SphereBotAgent } from './agent.js';
import { SphereBot } from './bot.js';
import type { SphereBotConfig } from './types.js';

// Polyfill WebSocket for Node.js — sphere-sdk uses the browser global in some code paths
if (typeof globalThis.WebSocket === 'undefined') {
  (globalThis as any).WebSocket = WebSocket;
}

export async function startSphereBot(config: SphereBotConfig): Promise<void> {
  console.log(`[${config.name}] Starting with config:`, {
    network: config.network,
    nametag: config.nametag,
    llmProvider: config.llm.provider,
    llmModel: config.llm.model,
    mcpServers: config.mcpServers.map(s => s.name),
  });

  // MCP tool manager — connections are lazy (established on first DM)
  const toolManager = new McpToolManager(config.name, config.maxToolResultChars);
  for (const server of config.mcpServers) {
    toolManager.addServer(server.name, server.url);
  }

  // Agent + Bot
  const agent = new SphereBotAgent(config, toolManager);
  const bot = new SphereBot(config, agent);
  await bot.start();

  // Graceful shutdown
  const shutdown = async () => {
    console.log(`[${config.name}] Shutting down...`);
    await bot.destroy();
    await toolManager.disconnect();
    process.exit(0);
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}
