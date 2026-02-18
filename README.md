# Agentic Chatbot

A modular, agentic chatbot platform built with React, Node.js, and the Model Context Protocol (MCP). Features multiple AI-powered "activities" (personalities/agents) that can use custom tools via MCP servers, plus a standalone knowledge base bot that communicates via Nostr DMs.

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                       Frontend (React)                          │
│  - Activity Selector    - Chat with streaming                   │
│  - Markdown rendering   - Thinking/reasoning display            │
└─────────────────┬───────────────────────────────────────────────┘
                  │ HTTP/SSE
┌─────────────────▼───────────────────────────────────────────────┐
│                  Agent Server (Node.js)                          │
│  - Activity routing     - LLM orchestration (Gemini, OpenAI)    │
│  - Agent loop           - Local tools (memory)                  │
│  - MCP client manager                                           │
└─────────┬───────────┬───────────┬───────────────────────────────┘
          │           │           │  MCP over HTTP
┌─────────▼──┐ ┌──────▼──┐ ┌─────▼──────┐
│ MCP Trivia │ │ MCP Web │ │  MCP RAG   │
│            │ │         │ │            │
│ Questions  │ │ Search  │ │ Semantic   │
│ Scoring    │ │ Fetch   │ │ search     │
└────────────┘ └─────┬───┘ └─────┬──────┘
                     │           │  MCP over HTTP
              ┌──────┴───────────┴──────┐
              │     KBBot (Node.js)     │
              │                         │
              │  Sphere SDK wallet      │
              │  Nostr DM listener      │
              │  Gemini LLM agent       │
              └─────────────────────────┘
```

### Key Technologies

- **Frontend**: React + TypeScript, Vite, Tailwind CSS, Zustand
- **Backend**: Hono, Vercel AI SDK v6, MCP SDK
- **LLM Providers**: Google Gemini, OpenAI-compatible APIs
- **MCP**: Model Context Protocol for modular tool servers
- **KBBot**: Sphere SDK (Nostr DMs), standalone Node.js service

## Packages

| Package | Port | Description |
|---------|------|-------------|
| `packages/ui` | 5173 | React frontend with activity selector and chat UI |
| `packages/agent-server` | 3000 | Main backend — LLM orchestration, MCP client, streaming |
| `packages/mcp-trivia` | 3001 | MCP server for trivia game (questions, scoring, payments) |
| `packages/mcp-web-py` | 3002 | MCP server for web search and page fetching (Python) |
| `packages/mcp-rag` | 3003 | MCP server for RAG semantic search over docs (Python/ChromaDB) |
| `packages/kbbot` | 3004 | Knowledge base bot — answers questions via Nostr DMs |
| `packages/shared` | — | Shared TypeScript types |

## Quick Start

### Prerequisites

- Node.js 20+
- pnpm 8+
- Docker & Docker Compose

### Setup

```bash
git clone <repository>
cd agentic-chatbot
pnpm install
cp .env.example .env
# Edit .env with your API keys
```

### Run with Docker Compose

```bash
docker compose up --build
```

Services:
- Frontend: http://localhost:5173
- Agent Server: http://localhost:3000
- Trivia MCP: http://localhost:3001
- Web MCP: http://localhost:3002
- RAG MCP: http://localhost:3003
- KBBot: http://localhost:3004

### Local Development (without Docker)

```bash
# MCP Trivia Server
cd packages/mcp-trivia && pnpm dev

# MCP Web Server (Python)
cd packages/mcp-web-py
python -m venv venv && source venv/bin/activate
pip install -e . && python -m src.server

# MCP RAG Server (Python)
cd packages/mcp-rag
python -m venv venv && source venv/bin/activate
pip install -e . && python -m src.server

# Agent Server
cd packages/agent-server && pnpm dev

# KBBot
cd packages/kbbot && pnpm dev

# Frontend
cd packages/ui && pnpm dev
```

## Core Concepts

### Activities

Each activity represents a distinct agent/personality with:
- Unique system prompt and personality
- Specific LLM model and configuration
- Access to specific MCP servers (tools)
- Optional local tools (e.g., memory)
- Theme and UI customization

### MCP Servers

Standalone HTTP services that expose tools via the Model Context Protocol:
- Built using `@modelcontextprotocol/sdk`
- Provide tools via JSON schema
- Run as separate Docker containers
- Stateless or stateful (using userId from metadata)

### Agent Loop

The main execution flow in `agent-server/src/agent/loop.ts`:
1. Receives user message and chat history
2. Converts to LLM-compatible format
3. Streams LLM response with tool calls
4. Executes tools via MCP or local handlers
5. Yields text deltas, reasoning, and tool-call events to frontend

### KBBot

A standalone knowledge base bot that participates in Sphere's DM chat:
- Creates a Sphere wallet on first boot (persisted via Docker volumes)
- Listens for incoming Nostr DMs via Sphere SDK
- Answers questions using Gemini LLM + RAG and web search tools
- Sends welcome DMs to new wallet users (via `/api/notify` webhook)
- Sends composing indicators while generating responses
- In-memory conversation history (lost on restart)

**Tool usage priority:**
1. Search local knowledge base (RAG) — answer if sufficient
2. Search the web — answer if snippets suffice
3. Fetch one web page — answer from full content
4. Force text generation if step limit reached

### RAG Knowledge Base

The `mcp-rag` server provides semantic search over markdown documentation:
- Documents go in the `rag/` directory at project root
- Index is rebuilt from scratch on every container restart
- Uses ChromaDB for vector storage
- Section-aware chunking preserves markdown structure with header context

To update the knowledge base:
```bash
# Add/edit .md files in rag/
docker compose restart mcp-rag
```

## Environment Variables

### Agent Server

| Variable | Default | Description |
|----------|---------|-------------|
| `GOOGLE_API_KEY` | *required* | Gemini API key |
| `AMA_API_KEY` | — | OpenAI-compatible API key (supports comma-separated failover) |
| `AMA_API_URL` | — | OpenAI-compatible base URL (supports comma-separated failover) |
| `CORS_ORIGIN` | `http://localhost:5173` | Allowed origins (comma-separated) |
| `API_BASE_URL` | `http://localhost:5173` | Base URL for image proxying |
| `MCP_TRIVIA_URL` | `http://mcp-trivia:3001/mcp` | Trivia MCP server URL |
| `MCP_WEB_URL` | `http://mcp-web:3002/mcp` | Web MCP server URL |
| `MCP_RAG_URL` | `http://mcp-rag:3003/mcp` | RAG MCP server URL |
| `DEBUG_PROMPTS` | `false` | Log system prompts |
| `DEBUG_MCP` | `false` | Log MCP tool calls |
| `ENABLE_TOOL_RETRY` | `true` | LLM retry on tool errors |
| `MAX_TOOL_RETRIES` | `2` | Max identical retries |

### KBBot

| Variable | Default | Description |
|----------|---------|-------------|
| `KBBOT_LLM_API_KEY` | *required* | Gemini API key |
| `KBBOT_LLM_MODEL` | `gemini-3-flash-preview` | LLM model name |
| `KBBOT_LLM_BASE_URL` | — | Custom LLM endpoint URL |
| `KBBOT_NAMETAG` | `kbbot` | Bot's nametag on Sphere |
| `KBBOT_NETWORK` | `testnet` | Sphere network (`mainnet`/`testnet`/`dev`) |
| `KBBOT_WELCOME_DELAY_MS` | `4000` | Delay before sending welcome DM |
| `KBBOT_MAX_HISTORY_MESSAGES` | `20` | Max conversation turns per user |
| `MCP_RAG_URL` | `http://mcp-rag:3003/mcp` | RAG MCP server URL |
| `MCP_WEB_URL` | `http://mcp-web:3002/mcp` | Web MCP server URL |

### Build-Time Variables

`VITE_API_URL` is a build-time variable for the frontend:
```bash
# Default
VITE_API_URL=http://localhost:3000

# Production — set before building
VITE_API_URL=https://api.yourdomain.com docker compose build ui
```

## Adding New Activities

### 1. Create Activity Configuration

```typescript
// packages/agent-server/src/config/activities/my-activity.ts
import type { ActivityConfig } from '@agentic/shared';

export const myActivity: ActivityConfig = {
    id: 'my-activity',
    name: 'My Custom Agent',
    description: 'A helpful agent that does X',
    greetingMessage: "Hello! I can help you with X.",

    systemPrompt: `You are a helpful AI assistant specialized in X.
...`,

    llm: {
        provider: 'gemini',              // or 'openai-compatible'
        model: 'gemini-2.5-flash',
        temperature: 0.7,
    },

    mcpServers: [
        {
            name: 'my-mcp-server',
            url: process.env.MY_MCP_URL || 'http://localhost:3003/mcp',
        },
    ],

    localTools: ['memory'],

    theme: {
        primaryColor: '#3b82f6',
        name: 'my-activity',
    },

    persistChatHistory: true,
};
```

### 2. Register Activity

```typescript
// packages/agent-server/src/config/activities/index.ts
import { myActivity } from './my-activity.js';

const activities: Record<string, ActivityConfig> = {
    // ... existing activities
    'my-activity': myActivity,
};
```

### 3. Rebuild

```bash
docker compose up --build agent-server
```

### LLM Provider Options

**Gemini:**
```typescript
llm: {
    provider: 'gemini',
    model: 'gemini-2.5-flash',
    temperature: 0.7,
}
```

**OpenAI-compatible** (local or remote, supports failover with comma-separated URLs/keys):
```typescript
llm: {
    provider: 'openai-compatible',
    model: 'gpt-4',
    baseUrl: 'http://localhost:8000/v1',
    apiKey: process.env.OPENAI_API_KEY,
    temperature: 0.7,
}
```

## System Prompt Templating

Activities support dynamic template tags in system prompts:

| Variable | Example | Description |
|----------|---------|-------------|
| `{{userId}}` | `user_abc12345` | User identifier |
| `{{serverTime}}` | `2025-12-02T14:30:00Z` | Server time (UTC) |
| `{{userTimezone}}` | `Europe/Tallinn` | User's timezone |
| `{{localTime}}` | `12/02/2025, 16:30:00` | User's local time |
| `{{userCountry}}` | `EE` | Country code |
| `{{userLocale}}` | `et-EE` | Locale |
| `{{userLanguage}}` | `et` | Language code |

Supports conditional blocks:
```
{{#if userTimezone}}
User's timezone: {{userTimezone}}
{{else}}
Timezone unknown — using UTC.
{{/if}}
```

## Creating MCP Servers

### 1. Create Package

```bash
mkdir -p packages/mcp-myservice/src
```

### 2. Implement Server

```typescript
// packages/mcp-myservice/src/server.ts
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';

const server = new McpServer({ name: 'myservice', version: '1.0.0' });

server.tool(
    'my_tool',
    'Description of what this tool does',
    { input: z.string().describe('Input parameter') },
    async ({ input }) => ({
        content: [{ type: 'text', text: JSON.stringify({ result: input }) }],
    })
);

async function main() {
    const port = parseInt(process.env.PORT || '3003');
    const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
    });
    await server.connect(transport);

    createServer((req, res) => {
        if (req.url === '/mcp') transport.handleRequest(req, res);
        else { res.writeHead(404); res.end('Not Found'); }
    }).listen(port, () => console.log(`MCP server on port ${port}`));
}

main().catch(console.error);
```

### 3. Add to Docker Compose and Activity Config

See existing services in `docker-compose.yml` for Dockerfile patterns.

## KBBot Operations

### Exporting wallet keys to a new machine

KBBot's wallet identity is stored in Docker volumes. To migrate:

```bash
# Export (on source machine)
docker run --rm -v agentic-chatbot_kbbot-data:/data -v $(pwd):/backup alpine \
  tar czf /backup/kbbot-data.tar.gz -C /data .
docker run --rm -v agentic-chatbot_kbbot-tokens:/data -v $(pwd):/backup alpine \
  tar czf /backup/kbbot-tokens.tar.gz -C /data .

# Import (on target machine)
docker volume create agentic-chatbot_kbbot-data
docker volume create agentic-chatbot_kbbot-tokens
docker run --rm -v agentic-chatbot_kbbot-data:/data -v $(pwd):/backup alpine \
  tar xzf /backup/kbbot-data.tar.gz -C /data
docker run --rm -v agentic-chatbot_kbbot-tokens:/data -v $(pwd):/backup alpine \
  tar xzf /backup/kbbot-tokens.tar.gz -C /data
```

### Health check

```bash
curl http://localhost:3004/health
# {"status":"ok","nametag":"kbbot","directAddress":"DIRECT://..."}
```

### Notify endpoint (called by Sphere frontend on wallet creation)

```bash
curl -X POST http://localhost:3004/api/notify \
  -H 'Content-Type: application/json' \
  -d '{"pubkey":"02...", "nametag":"alice"}'
```

## Troubleshooting

### MCP Connection Errors

**"Server already initialized"** — Restart the agent-server container. The MCP manager uses persistent connections that may stale.

### CORS Errors

Verify `CORS_ORIGIN` in `.env` matches your frontend URL exactly. For multiple origins:
```
CORS_ORIGIN=http://localhost:5173,https://yourdomain.com
```

### KBBot not responding to DMs

1. Check `docker compose logs kbbot` for connection errors
2. Verify `KBBOT_LLM_API_KEY` is set
3. Check MCP server connectivity: `docker compose logs mcp-rag mcp-web`
4. Health check: `curl http://localhost:3004/health`

### Build Errors

**"pnpm lockfile out of date":**
```bash
pnpm install && docker compose build
```

**`VITE_API_URL` not defined** — it's a build-time variable, set it before building the UI.

## Additional Resources

- [Model Context Protocol Documentation](https://modelcontextprotocol.io/)
- [Vercel AI SDK Documentation](https://sdk.vercel.ai/docs)
- [Sphere SDK Documentation](https://github.com/unicity-sphere/sphere-sdk)
- [Hono Documentation](https://hono.dev/)
