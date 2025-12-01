#!/usr/bin/env python3
"""
DDGS Search Wrapper
Provides a simple CLI interface to the DDGS metasearch library
"""
import sys
import json
from ddgs import DDGS

def search(query: str, max_results: int = 10, region: str = "wt-wt", backend: str = "auto"):
    """
    Search using DDGS metasearch library

    Args:
        query: Search query
        max_results: Maximum number of results
        region: Region code (e.g., us-en, uk-en, wt-wt)
        backend: Search backend (auto, duckduckgo, bing, brave, google, etc.)
    """
    try:
        # Initialize DDGS (creates new session each time)
        ddgs = DDGS()

        # Perform search
        # DDGS.text() searches multiple backends in parallel when backend="auto"
        results = ddgs.text(
            keywords=query,
            region=region,
            safesearch="off",
            max_results=max_results,
            backend=backend
        )

        # Convert generator to list
        results_list = list(results)

        # Return JSON response
        response = {
            "success": True,
            "query": query,
            "count": len(results_list),
            "backend": backend,
            "region": region,
            "results": [
                {
                    "title": r.get("title", ""),
                    "url": r.get("href", ""),
                    "description": r.get("body", ""),
                    "provider": r.get("source", backend)
                }
                for r in results_list
            ]
        }

        print(json.dumps(response))
        return 0

    except Exception as e:
        # Return error as JSON
        error_response = {
            "success": False,
            "error": str(e),
            "query": query
        }
        print(json.dumps(error_response))
        return 1

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(json.dumps({"success": False, "error": "Usage: ddgs_search.py <query> [max_results] [region] [backend]"}))
        sys.exit(1)

    query = sys.argv[1]
    max_results = int(sys.argv[2]) if len(sys.argv) > 2 else 10
    region = sys.argv[3] if len(sys.argv) > 3 else "wt-wt"
    backend = sys.argv[4] if len(sys.argv) > 4 else "auto"

    sys.exit(search(query, max_results, region, backend))
