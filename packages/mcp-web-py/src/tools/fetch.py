"""Web Fetch Tool using curl_cffi + trafilatura/readability"""
from typing import Literal
from pydantic import BaseModel, Field, HttpUrl
import trafilatura
from readability import Document
import html2text
from curl_cffi.requests import AsyncSession, RequestsError


class FetchInput(BaseModel):
    """Input schema for web fetch"""
    url: HttpUrl = Field(..., description="URL to fetch")
    format: Literal["markdown", "html", "text"] = Field("markdown", description="Output format")
    max_length: int = Field(50000, le=100000, description="Maximum content length in characters")


async def fetch_tool(input: FetchInput) -> dict:
    """
    Fetch and extract clean content from web pages.

    Uses curl_cffi with Chrome TLS impersonation to avoid bot detection.
    trafilatura (F1: 0.958) as primary extraction, readability-lxml as fallback.
    """
    try:
        print(f"[Fetch] URL: {input.url}, Format: {input.format}", flush=True)

        # Fetch HTML using curl_cffi with browser impersonation
        async with AsyncSession() as session:
            try:
                response = await session.get(
                    str(input.url),
                    impersonate="chrome",
                    timeout=15,
                )
            except RequestsError as e:
                err_str = str(e).lower()
                if "ssl" in err_str or "certificate" in err_str or "tls" in err_str:
                    print(f"[Fetch] SSL error, retrying without verification: {e}", flush=True)
                    response = await session.get(
                        str(input.url),
                        impersonate="chrome",
                        timeout=15,
                        verify=False,
                    )
                else:
                    raise

        # Check for HTTP errors
        if response.status_code >= 400:
            error_message = response.reason if hasattr(response, 'reason') else "Error"
            headers = dict(response.headers) if hasattr(response, 'headers') else {}
            if 'X-Error-Message' in headers:
                error_message = headers['X-Error-Message']
            elif 'X-Error' in headers:
                error_message = headers['X-Error']

            print(f"[Fetch] HTTP Error {response.status_code}: {error_message}", flush=True)
            return {
                "error": f"HTTP {response.status_code}: {error_message}",
                "status_code": response.status_code,
                "url": str(input.url),
                "message": f"The server returned an error. Status: {response.status_code} {error_message}"
            }

        html = response.text

        # Try trafilatura first (best quality)
        content = trafilatura.extract(
            html,
            include_comments=False,
            include_tables=True,
            no_fallback=False
        )

        if content:
            metadata = trafilatura.extract_metadata(html)
            title = metadata.title if metadata and metadata.title else "Untitled"
            author = metadata.author if metadata and metadata.author else None

            if input.format == "markdown":
                h = html2text.HTML2Text()
                h.ignore_links = False
                h.body_width = 0
                html_content = trafilatura.extract(html, include_comments=False, include_tables=True, output_format="xml")
                if html_content:
                    content = h.handle(html_content)
                else:
                    content = h.handle(content)
            elif input.format == "text":
                content = trafilatura.extract(html, no_fallback=False, output_format="txt")

            print(f"[Fetch] Extracted {len(content)} chars using trafilatura", flush=True)

        else:
            # Fallback to readability
            print("[Fetch] Trafilatura failed, falling back to readability", flush=True)
            doc = Document(html)
            title = doc.title()
            content_html = doc.summary()
            author = None

            if input.format == "markdown":
                h = html2text.HTML2Text()
                h.ignore_links = False
                h.body_width = 0
                content = h.handle(content_html)
            elif input.format == "text":
                h = html2text.HTML2Text()
                h.ignore_links = True
                h.ignore_images = True
                content = h.handle(content_html)
            else:  # html
                content = content_html

            print(f"[Fetch] Extracted {len(content)} chars using readability", flush=True)

        # Truncate if needed
        if len(content) > input.max_length:
            content = content[:input.max_length] + "\n\n[Content truncated...]"
            print(f"[Fetch] Truncated to {input.max_length} chars", flush=True)

        return {
            "url": str(input.url),
            "title": title,
            "content": content,
            "excerpt": content[:200] + "..." if len(content) > 200 else content,
            "author": author,
            "length": len(content),
            "format": input.format
        }

    except RequestsError as e:
        error_msg = f"HTTP request failed: {str(e)}"
        print(f"[Fetch] Error: {error_msg}", flush=True)
        return {
            "error": error_msg,
            "url": str(input.url),
            "message": "Failed to fetch the URL. Please check if the URL is accessible."
        }
    except Exception as e:
        error_msg = str(e)
        print(f"[Fetch] Error: {error_msg}", flush=True)
        return {
            "error": error_msg,
            "url": str(input.url),
            "message": "Content extraction failed. The page format may not be supported."
        }
