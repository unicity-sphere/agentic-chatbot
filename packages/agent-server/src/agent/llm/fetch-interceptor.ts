export function createLoggingFetch(context: { requestId?: string }): typeof fetch {
  return async (url, options) => {
    const startTime = Date.now();

    // Log outgoing request (sanitize auth headers)
    const method = options?.method || 'GET';
    console.log(`[HTTP ${context.requestId}] → ${method} ${url}`);

    const response = await fetch(url, options);
    const duration = Date.now() - startTime;

    // Extract critical headers
    const headers = {
      'x-request-id': response.headers.get('x-request-id'),
      'x-ratelimit-limit': response.headers.get('x-ratelimit-limit'),
      'x-ratelimit-remaining': response.headers.get('x-ratelimit-remaining'),
      'x-ratelimit-reset': response.headers.get('x-ratelimit-reset'),
      'retry-after': response.headers.get('retry-after'),
      'content-type': response.headers.get('content-type'),
    };

    // Log response metadata
    console.log(`[HTTP ${context.requestId}] ← ${response.status} ${response.statusText} (${duration}ms)`);
    console.log(`[HTTP ${context.requestId}] Headers:`, JSON.stringify(headers, null, 2));

    // Log non-200 responses with body
    if (!response.ok) {
      console.error(`[HTTP ${context.requestId}] HTTP Error ${response.status}: ${response.statusText}`);
      const cloned = response.clone();
      try {
        const text = await cloned.text();
        console.error(`[HTTP ${context.requestId}] Response body:`, text.substring(0, 500));
      } catch (e) {
        console.error(`[HTTP ${context.requestId}] Could not read response body`);
      }
    }

    // For SSE streams (text/event-stream), intercept and log the stream data
    const contentType = response.headers.get('content-type');
    if (contentType?.includes('text/event-stream')) {
      // Clone the response to read the body without consuming it
      const cloned = response.clone();

      // Read and log SSE data in the background (don't await to avoid blocking)
      (async () => {
        try {
          const reader = cloned.body?.getReader();
          const decoder = new TextDecoder();
          let sseEventCount = 0;
          let buffer = '';
          const allEvents: string[] = []; // Store all events for potential debugging

          if (!reader) {
            console.warn(`[HTTP ${context.requestId}] SSE stream has no body reader`);
            return;
          }

          console.log(`[HTTP ${context.requestId}] === BEGIN RAW SSE STREAM ===`);

          while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            const chunk = decoder.decode(value, { stream: true });
            buffer += chunk;

            // Log raw chunks for maximum visibility
            if (chunk.trim()) {
              console.log(`[HTTP ${context.requestId}] RAW CHUNK:`, chunk);
            }

            // Split by double newline (SSE event separator)
            const events = buffer.split('\n\n');
            buffer = events.pop() || ''; // Keep incomplete event in buffer

            for (const event of events) {
              if (!event.trim()) continue;

              sseEventCount++;
              allEvents.push(event);

              // Parse and log the event data
              console.log(`[HTTP ${context.requestId}] SSE Event #${sseEventCount}:`);
              console.log(`[HTTP ${context.requestId}]   Raw: ${event}`);

              // Try to parse JSON from "data:" lines
              const dataMatch = event.match(/^data:\s*(.+)$/m);
              if (dataMatch) {
                try {
                  const parsed = JSON.parse(dataMatch[1]);
                  console.log(`[HTTP ${context.requestId}]   Parsed:`, JSON.stringify(parsed, null, 2));

                  // Check for important fields
                  if (parsed.candidates) {
                    parsed.candidates.forEach((candidate: any, idx: number) => {
                      console.log(`[HTTP ${context.requestId}]   Candidate ${idx}:`, {
                        finishReason: candidate.finishReason,
                        safetyRatings: candidate.safetyRatings,
                        content: candidate.content,
                        groundingMetadata: candidate.groundingMetadata,
                      });

                      // Check if parts array is empty
                      if (candidate.content?.parts?.length === 0) {
                        console.warn(`[HTTP ${context.requestId}]   ⚠️  EMPTY PARTS ARRAY - No content generated!`);
                      }

                      // Check for safety blocks
                      if (candidate.safetyRatings) {
                        candidate.safetyRatings.forEach((rating: any) => {
                          if (rating.blocked || rating.probability === 'HIGH') {
                            console.warn(`[HTTP ${context.requestId}]   ⚠️  SAFETY ISSUE: ${rating.category} - ${rating.probability}`);
                          }
                        });
                      }
                    });
                  }

                  // Check for errors
                  if (parsed.error) {
                    console.error(`[HTTP ${context.requestId}]   ⚠️  ERROR IN SSE:`, parsed.error);
                  }
                } catch (parseError) {
                  console.log(`[HTTP ${context.requestId}]   (Could not parse as JSON)`);
                }
              }

              // Check for content filtering or blocks
              if (event.includes('blockReason') || event.includes('BLOCK_REASON') || event.includes('SAFETY')) {
                console.warn(`[HTTP ${context.requestId}]   ⚠️  Potential content filtering detected!`);
              }
            }
          }

          // Process any remaining buffered data
          if (buffer.trim()) {
            console.log(`[HTTP ${context.requestId}] FINAL BUFFER (not terminated with \\n\\n):`, buffer);
            sseEventCount++;
            allEvents.push(buffer);

            // Parse the final buffer
            const dataMatch = buffer.match(/^data:\s*(.+)$/m);
            if (dataMatch) {
              try {
                const parsed = JSON.parse(dataMatch[1]);
                console.log(`[HTTP ${context.requestId}]   Final event parsed:`, JSON.stringify(parsed, null, 2));

                if (parsed.candidates) {
                  parsed.candidates.forEach((candidate: any, idx: number) => {
                    console.log(`[HTTP ${context.requestId}]   Candidate ${idx}:`, {
                      finishReason: candidate.finishReason,
                      safetyRatings: candidate.safetyRatings,
                      content: candidate.content,
                    });

                    // Check if parts field is missing or empty
                    if (!candidate.content?.parts) {
                      console.warn(`[HTTP ${context.requestId}]   ⚠️  MISSING PARTS FIELD - Gemini returned no content!`);
                      console.warn(`[HTTP ${context.requestId}]   This usually means:`);
                      console.warn(`[HTTP ${context.requestId}]     - Model couldn't generate a response`);
                      console.warn(`[HTTP ${context.requestId}]     - Prompt is too large (${parsed.usageMetadata?.promptTokenCount} tokens)`);
                      console.warn(`[HTTP ${context.requestId}]     - Tool schema issues preventing generation`);
                    } else if (candidate.content.parts.length === 0) {
                      console.warn(`[HTTP ${context.requestId}]   ⚠️  EMPTY PARTS ARRAY - No content generated!`);
                    }
                  });
                }
              } catch (e) {
                console.log(`[HTTP ${context.requestId}]   (Could not parse final buffer as JSON)`);
              }
            }
          }

          console.log(`[HTTP ${context.requestId}] === END RAW SSE STREAM ===`);
          console.log(`[HTTP ${context.requestId}] SSE stream complete. Total events: ${sseEventCount}`);

          // If we got very few events, log all of them for debugging
          if (sseEventCount <= 5) {
            console.log(`[HTTP ${context.requestId}] Complete SSE event log (${sseEventCount} events):`);
            allEvents.forEach((evt, idx) => {
              console.log(`[HTTP ${context.requestId}] Event ${idx + 1}/${sseEventCount}:`, evt);
            });
          }
        } catch (e) {
          console.error(`[HTTP ${context.requestId}] Error reading SSE stream:`, e);
        }
      })();
    }

    return response;
  };
}
