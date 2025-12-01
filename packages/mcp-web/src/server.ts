import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { webFetch, webFetchSchema } from './tools/web-fetch.js';
import { jsonFetch, jsonFetchSchema } from './tools/json-fetch.js';
import { webSearch, webSearchSchema } from './tools/web-search.js';

const server = new McpServer({
  name: 'web',
  version: '2.0.0',
});

// Tool 1: Web Fetch
server.tool(
  'fetch',
  'Fetch and extract clean content from web pages. Returns markdown, HTML, or plain text.',
  webFetchSchema,
  webFetch
);

// Tool 2: JSON Fetch
server.tool(
  'json_fetch',
  'Fetch JSON data from remote APIs. Supports custom headers and all HTTP methods.',
  jsonFetchSchema,
  jsonFetch
);

// Tool 3: Web Search - with metadata support
server.tool(
  'search',
  'Search the web using DuckDuckGo. Returns titles, URLs, and descriptions.',
  webSearchSchema,
  async (args: any, extra?: { _meta?: any }) => {
    // Extract user metadata if provided
    const meta = extra?._meta ? {
      userId: extra._meta.userId,
      userIp: extra._meta.userIp,
      userCountry: extra._meta.userCountry,
    } : undefined;

    return webSearch(args, meta);
  }
);

// Start HTTP server
async function main() {
  const port = parseInt(process.env.PORT || '3002');

  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: () => randomUUID(),
  });

  await server.connect(transport);

  const httpServer = createServer((req, res) => {
    if (req.url === '/mcp') {
      transport.handleRequest(req, res);
    } else {
      res.writeHead(404);
      res.end('Not Found');
    }
  });

  httpServer.listen(port, () => {
    console.log(`Enhanced web MCP server running on port ${port}`);
    console.log('Tools: fetch, json_fetch, search');
  });
}

main().catch(console.error);
