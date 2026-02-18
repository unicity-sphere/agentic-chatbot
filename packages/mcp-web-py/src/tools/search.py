"""Web Search Tool — SearXNG (primary) + DDGS (fallback)"""
import asyncio
import os
from pydantic import BaseModel, Field
from typing import Literal
from curl_cffi.requests import AsyncSession, RequestsError
from ddgs import DDGS

SEARXNG_URL = os.environ.get("SEARXNG_URL", "http://localhost:8888")
SEARXNG_KEY = os.environ.get("SEARXNG_KEY", "")


class SearchInput(BaseModel):
    """Input schema for web search"""
    query: str = Field(..., min_length=1, description="Search query")
    max_results: int = Field(10, ge=1, le=20, description="Maximum number of results (1-20)")
    region: str = Field("wt-wt", description="Region code (us-en, uk-en, wt-wt for worldwide)")
    source: Literal["auto", "searxng", "ddgs"] = Field("auto", description="Search source: auto (SearXNG with DDGS fallback), searxng, or ddgs")


async def _search_searxng(query: str, max_results: int, region: str) -> list[dict]:
    """Search using SearXNG instance."""
    params = {
        "q": query,
        "format": "json",
        "categories": "general",
        "language": region if region != "wt-wt" else "all",
    }
    headers = {}
    if SEARXNG_KEY:
        headers["Authorization"] = f"Bearer {SEARXNG_KEY}"
    async with AsyncSession() as session:
        response = await session.get(
            f"{SEARXNG_URL}/search",
            params=params,
            headers=headers,
            timeout=10,
        )
        response.raise_for_status()
        data = response.json()

    results = []
    for r in data.get("results", [])[:max_results]:
        results.append({
            "title": r.get("title", ""),
            "url": r.get("url", ""),
            "description": r.get("content", ""),
            "engine": r.get("engine", "searxng"),
        })
    return results


async def _search_ddgs(query: str, max_results: int, region: str) -> list[dict]:
    """Search using DDGS (DuckDuckGo) — runs sync call in thread."""
    def _run():
        with DDGS() as ddgs:
            return list(ddgs.text(
                query=query,
                region=region,
                safesearch="off",
                max_results=max_results,
                backend="auto",
            ))

    raw = await asyncio.to_thread(_run)
    results = []
    for r in raw:
        results.append({
            "title": r.get("title", ""),
            "url": r.get("href", ""),
            "description": r.get("body", ""),
            "engine": r.get("source", "ddgs"),
        })
    return results


async def search_tool(input: SearchInput) -> dict:
    """
    Search the web using SearXNG (primary) with DDGS as fallback.

    In 'auto' mode, tries SearXNG first. If it fails, falls back to DDGS.
    """
    source_used = input.source
    results = []

    try:
        if input.source == "searxng":
            print(f"[Search] SearXNG query: {input.query}", flush=True)
            results = await _search_searxng(input.query, input.max_results, input.region)
            source_used = "searxng"

        elif input.source == "ddgs":
            print(f"[Search] DDGS query: {input.query}", flush=True)
            results = await _search_ddgs(input.query, input.max_results, input.region)
            source_used = "ddgs"

        else:  # auto
            try:
                print(f"[Search] SearXNG query (auto): {input.query}", flush=True)
                results = await _search_searxng(input.query, input.max_results, input.region)
                source_used = "searxng"
            except Exception as searx_err:
                print(f"[Search] SearXNG failed ({searx_err}), falling back to DDGS", flush=True)
                results = await _search_ddgs(input.query, input.max_results, input.region)
                source_used = "ddgs"

        # Add position numbers
        for idx, r in enumerate(results):
            r["position"] = idx + 1

        print(f"[Search] Found {len(results)} results via {source_used}", flush=True)

        return {
            "query": input.query,
            "results": results,
            "count": len(results),
            "source": source_used,
            "region": input.region,
        }

    except Exception as e:
        error_msg = str(e)
        print(f"[Search] Error: {error_msg}", flush=True)
        return {
            "error": error_msg,
            "query": input.query,
            "message": "Search failed. Please try again.",
        }
