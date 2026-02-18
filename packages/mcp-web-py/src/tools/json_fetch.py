"""JSON Fetch Tool using curl_cffi"""
from typing import Literal, Optional
from pydantic import BaseModel, Field, HttpUrl
from curl_cffi.requests import AsyncSession, RequestsError
import time


class JsonFetchInput(BaseModel):
    """Input schema for JSON fetch"""
    url: HttpUrl = Field(..., description="API endpoint URL")
    method: Literal["GET", "POST", "PUT", "DELETE"] = Field("GET", description="HTTP method")
    headers: Optional[dict[str, str]] = Field(None, description="Custom headers (e.g., Authorization)")
    body: Optional[str] = Field(None, description="Request body as JSON string")


async def json_fetch_tool(input: JsonFetchInput) -> dict:
    """
    Fetch JSON data from remote APIs.

    Uses curl_cffi with Chrome TLS impersonation.
    Supports all HTTP methods, custom headers for authentication,
    and handles non-JSON responses gracefully.
    """
    try:
        print(f"[JSONFetch] {input.method} {input.url}", flush=True)

        start_time = time.time()

        # Prepare headers
        headers = {
            "Content-Type": "application/json",
            "Accept": "application/json"
        }
        if input.headers:
            headers.update(input.headers)

        async with AsyncSession() as session:
            response = await session.request(
                method=input.method,
                url=str(input.url),
                headers=headers,
                data=input.body if input.body else None,
                impersonate="chrome",
                timeout=10,
            )

        response_time = (time.time() - start_time) * 1000

        print(f"[JSONFetch] Status: {response.status_code}, Time: {response_time:.2f}ms", flush=True)

        # Check for HTTP errors
        if response.status_code >= 400:
            error_message = response.reason if hasattr(response, 'reason') else "Error"
            resp_headers = dict(response.headers) if hasattr(response, 'headers') else {}
            if 'X-Error-Message' in resp_headers:
                error_message = resp_headers['X-Error-Message']
            elif 'X-Error' in resp_headers:
                error_message = resp_headers['X-Error']

            print(f"[JSONFetch] HTTP Error {response.status_code}: {error_message}", flush=True)
            return {
                "error": f"HTTP {response.status_code}: {error_message}",
                "status_code": response.status_code,
                "url": str(input.url),
                "message": f"The API returned an error. Status: {response.status_code} {error_message}",
                "response_time": round(response_time, 2)
            }

        # Try to parse as JSON
        try:
            data = response.json()
        except (ValueError, TypeError):
            data = {"_raw": response.text, "_note": "Response was not valid JSON"}

        return {
            "url": str(input.url),
            "status_code": response.status_code,
            "status_text": response.reason if hasattr(response, 'reason') else "OK",
            "headers": dict(response.headers),
            "data": data,
            "response_time": round(response_time, 2)
        }

    except RequestsError as e:
        err_str = str(e).lower()
        if "timeout" in err_str:
            error_msg = "Request timed out after 10 seconds"
            message = "The API request timed out. The server may be slow or unreachable."
        else:
            error_msg = f"HTTP request failed: {str(e)}"
            message = "Failed to connect to the API endpoint."
        print(f"[JSONFetch] Error: {error_msg}", flush=True)
        return {
            "error": error_msg,
            "url": str(input.url),
            "message": message
        }
    except Exception as e:
        error_msg = str(e)
        print(f"[JSONFetch] Error: {error_msg}", flush=True)
        return {
            "error": error_msg,
            "url": str(input.url),
            "message": "An unexpected error occurred while fetching JSON data."
        }
