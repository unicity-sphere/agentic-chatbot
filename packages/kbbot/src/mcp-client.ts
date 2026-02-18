import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { tool, type Tool } from 'ai';
import { z } from 'zod';

interface McpServer {
  name: string;
  url: string;
  client: Client | null;
  cachedTools: Record<string, Tool> | null;
  connecting: Promise<void> | null;
}

export class McpToolManager {
  private servers: McpServer[] = [];

  /** Register an MCP server. Connection is lazy — happens on first getTools(). */
  addServer(name: string, url: string): void {
    this.servers.push({ name, url, client: null, cachedTools: null, connecting: null });
  }

  /** Get all tools from all registered servers, connecting lazily as needed. */
  async getTools(): Promise<Record<string, Tool>> {
    const allTools: Record<string, Tool> = {};

    for (const server of this.servers) {
      const tools = await this.getServerTools(server);
      Object.assign(allTools, tools);
    }

    return allTools;
  }

  private async getServerTools(server: McpServer): Promise<Record<string, Tool>> {
    if (server.cachedTools) return server.cachedTools;

    const connected = await this.ensureConnected(server);
    if (!connected || !server.client) return {};

    try {
      const result = await server.client.listTools();
      const tools: Record<string, Tool> = {};
      const client = server.client;

      for (const mcpTool of result.tools) {
        // Prefix tool names with server name to avoid collisions
        const toolName = `${server.name}_${mcpTool.name}`;

        tools[toolName] = tool({
          description: mcpTool.description || '',
          inputSchema: this.jsonSchemaToZod(mcpTool.inputSchema),
          execute: async (args) => {
            console.log(`[MCP:${server.name}] ${mcpTool.name}`, JSON.stringify(args));
            try {
              const callResult = await client.callTool({
                name: mcpTool.name,
                arguments: args,
              });

              if (callResult.isError) {
                const errorMsg = Array.isArray(callResult.content)
                  ? callResult.content.map((c: any) => c.text || c).join('\n')
                  : JSON.stringify(callResult.content);
                return `Error: ${errorMsg}`;
              }

              const content = callResult.content as any[];
              const resultText = content.map((item: any) => item.text || JSON.stringify(item)).join('\n');

              // Log result summary
              try {
                const parsed = JSON.parse(resultText);
                if (Array.isArray(parsed?.results)) {
                  // RAG search results
                  console.log(`[MCP:${server.name}] ${mcpTool.name} → ${parsed.results.length} results`);
                  for (const r of parsed.results.slice(0, 5)) {
                    const preview = (r.content || r.text || '').slice(0, 200).replace(/\n/g, ' ');
                    console.log(`  - [${(r.score ?? r.relevance ?? '').toString().slice(0, 5)}] ${r.source || r.title || r.id || '?'}: ${preview}`);
                  }
                } else if (parsed?.content) {
                  // Web fetch result
                  console.log(`[MCP:${server.name}] ${mcpTool.name} → ${parsed.title || parsed.url || '?'} (${(parsed.content || '').length} chars): ${(parsed.content || '').slice(0, 200).replace(/\n/g, ' ')}`);
                } else if (Array.isArray(parsed)) {
                  console.log(`[MCP:${server.name}] ${mcpTool.name} → ${parsed.length} items`);
                } else {
                  console.log(`[MCP:${server.name}] ${mcpTool.name} → ${resultText.length} chars`);
                }
              } catch {
                console.log(`[MCP:${server.name}] ${mcpTool.name} → ${resultText.length} chars`);
              }

              return resultText;
            } catch (error) {
              const msg = error instanceof Error ? error.message : String(error);
              console.error(`[MCP:${server.name}] Tool ${mcpTool.name} failed:`, msg);
              return `Tool execution failed: ${msg}`;
            }
          },
        });
      }

      const toolNames = Object.keys(tools);
      console.log(`[MCP:${server.name}] Loaded ${toolNames.length} tools: ${toolNames.join(', ')}`);
      server.cachedTools = tools;
      return tools;
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      console.error(`[MCP:${server.name}] Failed to list tools: ${msg}`);
      server.client = null;
      server.cachedTools = null;
      return {};
    }
  }

  private async ensureConnected(server: McpServer): Promise<boolean> {
    if (server.client) return true;

    if (server.connecting) {
      await server.connecting;
      return !!server.client;
    }

    server.connecting = (async () => {
      try {
        const client = new Client({ name: `kbbot-${server.name}`, version: '1.0.0' });
        const transport = new StreamableHTTPClientTransport(new URL(server.url));
        await client.connect(transport);
        server.client = client;
        server.cachedTools = null;
        console.log(`[MCP:${server.name}] Connected to ${server.url}`);
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        console.warn(`[MCP:${server.name}] Connection failed: ${msg}`);
        server.client = null;
      }
    })();

    try {
      await server.connecting;
    } finally {
      server.connecting = null;
    }

    return !!server.client;
  }

  private jsonSchemaToZod(schema: any): z.ZodType {
    if (!schema || schema.type !== 'object') {
      return z.object({}).passthrough();
    }

    const shape: Record<string, z.ZodType> = {};
    const properties = schema.properties || {};
    const required = new Set(schema.required || []);

    for (const [key, prop] of Object.entries(properties) as [string, any][]) {
      let zodType: z.ZodType;

      switch (prop.type) {
        case 'string':
          zodType = z.string();
          break;
        case 'number':
        case 'integer':
          zodType = z.number();
          break;
        case 'boolean':
          zodType = z.boolean();
          break;
        case 'array':
          zodType = z.array(z.any());
          break;
        default:
          zodType = z.any();
      }

      if (prop.description) {
        zodType = zodType.describe(prop.description);
      }

      shape[key] = required.has(key) ? zodType : zodType.optional();
    }

    return z.object(shape);
  }

  async disconnect(): Promise<void> {
    for (const server of this.servers) {
      if (server.client) {
        try {
          await server.client.close();
          console.log(`[MCP:${server.name}] Disconnected`);
        } catch (error) {
          console.error(`[MCP:${server.name}] Error disconnecting:`, error);
        }
        server.client = null;
        server.cachedTools = null;
      }
    }
  }
}
