#!/usr/bin/env python3
"""
MCP RAG Server - Semantic search over Unicity knowledge base.

Read-only vector search via ChromaDB. Reindexes from the data directory
on every startup, so the admin workflow is:
  1. Edit / add / remove markdown files in the mounted docs folder
  2. docker compose restart mcp-rag
"""

import base64
import json
import mimetypes
import os
from glob import glob

from mcp.server import Server
from mcp.types import Tool, TextContent, ImageContent
from starlette.applications import Starlette
from starlette.routing import Route
from starlette.requests import Request
from starlette.responses import JSONResponse
import uvicorn
import chromadb

from src.chunker import chunk_markdown

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------
DATA_DIR = os.environ.get("DATA_DIR", "/data/docs")
DB_DIR = os.environ.get("DB_DIR", "/data/chromadb")
COLLECTION_NAME = "unicity_kb"

# ---------------------------------------------------------------------------
# ChromaDB setup
# ---------------------------------------------------------------------------
chroma_client = chromadb.PersistentClient(path=DB_DIR)

# ---------------------------------------------------------------------------
# MCP server
# ---------------------------------------------------------------------------
mcp_server = Server("rag")

# ---------------------------------------------------------------------------
# Image loading
# ---------------------------------------------------------------------------

def _load_image(filename: str) -> tuple[str, str] | None:
    """Load an image by filename. Returns (base64_data, mimeType) or None."""
    filepath = os.path.join(DATA_DIR, "pic", filename)
    if not os.path.isfile(filepath):
        return None

    mime = mimetypes.guess_type(filepath)[0] or "image/png"
    with open(filepath, "rb") as f:
        data = base64.b64encode(f.read()).decode("ascii")
    return data, mime


# ---------------------------------------------------------------------------
# Ingestion (runs once at startup)
# ---------------------------------------------------------------------------

def reindex(directory: str) -> dict:
    """Drop the collection and re-ingest every *.md file from *directory*."""
    try:
        chroma_client.delete_collection(COLLECTION_NAME)
    except Exception:
        pass

    coll = chroma_client.get_or_create_collection(
        name=COLLECTION_NAME,
        metadata={"hnsw:space": "cosine"},
    )

    md_files = sorted(glob(os.path.join(directory, "*.md")))
    total_chunks = 0
    ingested: list[dict] = []

    for filepath in md_files:
        filename = os.path.basename(filepath)
        with open(filepath, "r", encoding="utf-8") as fh:
            content = fh.read()

        chunks = chunk_markdown(content, source=filename)
        if not chunks:
            continue

        ids = [f"{filename}:{i}" for i in range(len(chunks))]
        documents = [c.text for c in chunks]
        metadatas = [c.metadata for c in chunks]

        coll.add(ids=ids, documents=documents, metadatas=metadatas)
        total_chunks += len(chunks)
        sizes = [len(c.text) for c in chunks]
        ingested.append({"file": filename, "chunks": len(chunks), "sizes": sizes})

    return {"collection": coll, "files": len(ingested), "chunks": total_chunks, "details": ingested}


def startup_ingest():
    """Reindex docs directory on every startup."""
    global collection
    if not os.path.isdir(DATA_DIR):
        print(f"[RAG] WARNING: data dir {DATA_DIR} does not exist", flush=True)
        collection = chroma_client.get_or_create_collection(
            name=COLLECTION_NAME,
            metadata={"hnsw:space": "cosine"},
        )
        return

    print(f"[RAG] Indexing {DATA_DIR} …", flush=True)
    result = reindex(DATA_DIR)
    collection = result["collection"]
    print(f"[RAG] Indexed {result['files']} files, {result['chunks']} chunks", flush=True)
    for d in result["details"]:
        sizes = d.get("sizes", [])
        avg = sum(sizes) // len(sizes) if sizes else 0
        lo, hi = (min(sizes), max(sizes)) if sizes else (0, 0)
        print(f"[RAG]   {d['file']}: {d['chunks']} chunks (avg {avg}, range {lo}-{hi} chars)", flush=True)


# will be set by startup_ingest()
collection = None  # type: ignore[assignment]


# ---------------------------------------------------------------------------
# Tool definitions (read-only)
# ---------------------------------------------------------------------------

@mcp_server.list_tools()
async def list_tools() -> list[Tool]:
    return [
        Tool(
            name="unicity_search",
            description=(
                "Search the Unicity knowledge base using semantic search. "
                "Use this for any questions about Unicity protocol, architecture, "
                "tokens, agents, consensus, aggregation layer, execution layer, "
                "prediction markets, BFT, sparse Merkle trees, or related topics."
            ),
            inputSchema={
                "type": "object",
                "properties": {
                    "query": {
                        "type": "string",
                        "description": "Search query about Unicity",
                        "minLength": 1,
                    },
                    "n_results": {
                        "type": "integer",
                        "description": "Number of results to return (1-10)",
                        "minimum": 1,
                        "maximum": 10,
                        "default": 4,
                    },
                },
                "required": ["query"],
            },
        ),
        Tool(
            name="list_documents",
            description="List all documents currently in the Unicity knowledge base.",
            inputSchema={"type": "object", "properties": {}},
        ),
    ]


# ---------------------------------------------------------------------------
# Tool execution
# ---------------------------------------------------------------------------

@mcp_server.call_tool()
async def call_tool(name: str, arguments: dict) -> list[TextContent | ImageContent]:
    try:
        if name == "unicity_search":
            return _tool_search(arguments)
        elif name == "list_documents":
            return _tool_list()
        else:
            raise ValueError(f"Unknown tool: {name}")

    except Exception as exc:
        import traceback
        traceback.print_exc()
        return [TextContent(type="text", text=json.dumps({"error": str(exc), "tool": name}))]


def _text(obj: dict) -> list[TextContent]:
    return [TextContent(type="text", text=json.dumps(obj, ensure_ascii=False))]


def _tool_search(args: dict) -> list[TextContent | ImageContent]:
    query = args["query"]
    n = min(args.get("n_results", 5), collection.count() or 1)

    results = collection.query(query_texts=[query], n_results=n)

    if not results["documents"] or not results["documents"][0]:
        return _text({"results": [], "message": "No results found."})

    formatted = []
    seen_images: set[str] = set()
    image_items: list[ImageContent] = []

    for i, (doc, meta, dist) in enumerate(
        zip(results["documents"][0], results["metadatas"][0], results["distances"][0])
    ):
        formatted.append(
            {
                "rank": i + 1,
                "source": meta.get("source", ""),
                "section": meta.get("section", ""),
                "relevance": round(1 - dist, 3),
                "content": doc,
            }
        )

        # Collect image refs from metadata
        images_str = meta.get("images", "")
        if images_str:
            for img_name in images_str.split(","):
                img_name = img_name.strip()
                if img_name and img_name not in seen_images:
                    seen_images.add(img_name)
                    loaded = _load_image(img_name)
                    if loaded:
                        b64_data, mime = loaded
                        image_items.append(
                            ImageContent(type="image", data=b64_data, mimeType=mime)
                        )

    content: list[TextContent | ImageContent] = _text({"results": formatted})
    content.extend(image_items)
    return content


def _tool_list() -> list[TextContent]:
    all_meta = collection.get()
    sources: dict[str, int] = {}
    for meta in all_meta["metadatas"]:
        src = meta.get("source", "unknown")
        sources[src] = sources.get(src, 0) + 1

    docs = [{"source": s, "chunks": c} for s, c in sorted(sources.items())]
    return _text({"documents": docs, "total_chunks": collection.count()})


# ---------------------------------------------------------------------------
# HTTP / JSON-RPC transport  (mirrors mcp-web-py)
# ---------------------------------------------------------------------------

def _serialize_content_item(r) -> dict:
    """Serialize a TextContent or ImageContent to JSON-RPC dict."""
    if r.type == "image":
        return {"type": "image", "data": r.data, "mimeType": r.mimeType}
    return {"type": "text", "text": r.text}


async def handle_messages(request: Request):
    """POST /mcp – MCP protocol over HTTP (JSON-RPC 2.0)."""
    body = None
    try:
        body = await request.json()
        method = body.get("method")
        params = body.get("params", {})
        request_id = body.get("id")

        print(f"[MCP] {method} (id={request_id})", flush=True)

        def ok(result):
            return JSONResponse({"jsonrpc": "2.0", "id": request_id, "result": result})

        def err(code: int, msg: str):
            return JSONResponse(
                {"jsonrpc": "2.0", "id": request_id, "error": {"code": code, "message": msg}},
                status_code=400,
            )

        if method == "initialize":
            return ok({
                "protocolVersion": "2024-11-05",
                "capabilities": {"tools": {}},
                "serverInfo": {"name": "rag", "version": "1.0.0"},
            })

        if method == "notifications/initialized":
            return JSONResponse({})

        if method == "ping":
            return ok({})

        if method == "tools/list":
            tools = await list_tools()
            return ok({
                "tools": [
                    {"name": t.name, "description": t.description, "inputSchema": t.inputSchema}
                    for t in tools
                ]
            })

        if method == "tools/call":
            tool_name = params.get("name")
            arguments = params.get("arguments", {})
            print(f"[MCP] Calling tool: {tool_name}", flush=True)
            result = await call_tool(tool_name, arguments)
            return ok({"content": [_serialize_content_item(r) for r in result]})

        return err(-32601, f"Method not found: {method}")

    except Exception as exc:
        import traceback
        traceback.print_exc()
        try:
            return JSONResponse(
                {"jsonrpc": "2.0", "id": body.get("id") if body else None,
                 "error": {"code": -32603, "message": str(exc)}},
                status_code=500,
            )
        except Exception:
            return JSONResponse({"error": str(exc)}, status_code=500)


# ---------------------------------------------------------------------------
# App
# ---------------------------------------------------------------------------

app = Starlette(
    debug=True,
    routes=[Route("/mcp", handle_messages, methods=["POST"])],
)


def main():
    port = int(os.environ.get("PORT", 3003))

    print(f"Starting MCP RAG Server on port {port} …", flush=True)
    print(f"  Data dir : {DATA_DIR}", flush=True)
    print(f"  DB dir   : {DB_DIR}", flush=True)

    startup_ingest()

    print(f"  Endpoint : http://0.0.0.0:{port}/mcp", flush=True)
    uvicorn.run(app, host="0.0.0.0", port=port, log_level="info")


if __name__ == "__main__":
    main()
