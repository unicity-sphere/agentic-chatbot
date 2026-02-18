import { McpToolManager } from './mcp-client.js';
import { SphereBotAgent } from './agent.js';
import { SphereBot } from './bot.js';
import { createApp, startServer } from './server.js';
import type { SphereBotConfig } from './types.js';

export async function startSphereBot(config: SphereBotConfig): Promise<void> {
  console.log(`[${config.name}] Starting with config:`, {
    port: config.port,
    network: config.network,
    nametag: config.nametag,
    llmProvider: config.llm.provider,
    llmModel: config.llm.model,
    mcpServers: config.mcpServers.map(s => s.name),
  });

  // MCP tool manager — connections are lazy (established on first DM)
  const toolManager = new McpToolManager(config.name);
  for (const server of config.mcpServers) {
    toolManager.addServer(server.name, server.url);
  }

  // Agent + Bot
  const agent = new SphereBotAgent(config, toolManager);
  const bot = new SphereBot(config, agent);
  await bot.start();

  // HTTP server
  const app = createApp(config, bot);
  startServer(app, config);

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
