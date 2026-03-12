# Agentic Chatbot

A modular, agentic chatbot platform built with React, Node.js, and the Model Context Protocol (MCP). Features a standalone knowledge base bot that communicates via Nostr DMs.

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

### Local Development (without Docker)

```bash
# MCP Web Server (Python)
cd packages/mcp-web-py
python -m venv venv && source venv/bin/activate
pip install -e . && python -m src.server

# MCP RAG Server (Python)
cd packages/mcp-rag
python -m venv venv && source venv/bin/activate
pip install -e . && python -m src.server

# KBBot
cd packages/kbbot && pnpm dev

```

## Core Concepts

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
- Creates a Sphere wallet on first boot (persisted in `data/kbbot/`)
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
| `KBBOT_MAX_HISTORY_MESSAGES` | `20` | Max conversation turns per user |
| `MCP_RAG_URL` | `http://mcp-rag:3003/mcp` | RAG MCP server URL |
| `MCP_WEB_URL` | `http://mcp-web:3002/mcp` | Web MCP server URL |

### Other bots

See Viktor etc.

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

## Bot Data & Backup

Bot wallets and tokens are stored in local folders (bind-mounted into containers):

```
data/
├── kbbot/
│   ├── data/       # wallet.json
│   └── tokens/     # token state
└── viktor/
    ├── data/       # wallet.json
    └── tokens/     # token state
```

The `data/` directory is gitignored. Use the backup/restore script to migrate between machines:

```bash
# Backup
./scripts/bot-backup.sh backup kbbot    # creates kbbot-backup.tar.gz
./scripts/bot-backup.sh backup viktor   # creates viktor-backup.tar.gz

# Restore
./scripts/bot-backup.sh restore kbbot   # extracts into data/kbbot/
./scripts/bot-backup.sh restore viktor  # extracts into data/viktor/
```

## Additional Resources

- [Model Context Protocol Documentation](https://modelcontextprotocol.io/)
- [Vercel AI SDK Documentation](https://sdk.vercel.ai/docs)
- [Sphere SDK Documentation](https://github.com/unicity-sphere/sphere-sdk)
- [Hono Documentation](https://hono.dev/)
