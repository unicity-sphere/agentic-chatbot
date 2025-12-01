import { z } from 'zod';

const schemaObj = z.object({
  url: z.string().url(),
  method: z.enum(['GET', 'POST', 'PUT', 'DELETE']).default('GET'),
  headers: z.record(z.string()).optional(),
  body: z.string().optional(),
});

export const jsonFetchSchema = {
  url: z.string().url(),
  method: z.enum(['GET', 'POST', 'PUT', 'DELETE']).default('GET'),
  headers: z.record(z.string()).optional(),
  body: z.string().optional(),
};

export async function jsonFetch(args: z.infer<typeof schemaObj>) {
  const { url, method, headers, body } = args;

  try {
    const startTime = Date.now();

    const response = await fetch(url, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...headers,
      },
      body: body ? body : undefined,
    });

    const responseTime = Date.now() - startTime;

    // Try to parse as JSON
    let data: any;
    const contentType = response.headers.get('content-type');

    if (contentType?.includes('application/json')) {
      data = await response.json();
    } else {
      const text = await response.text();
      try {
        data = JSON.parse(text);
      } catch {
        data = { _raw: text };
      }
    }

    return {
      content: [{
        type: 'text' as const,
        text: JSON.stringify({
          url,
          statusCode: response.status,
          statusText: response.statusText,
          headers: Object.fromEntries(response.headers.entries()),
          data,
          responseTime,
        }),
      }],
    };
  } catch (error) {
    return {
      content: [{
        type: 'text' as const,
        text: JSON.stringify({
          error: error instanceof Error ? error.message : 'Unknown error',
        }),
      }],
    };
  }
}
