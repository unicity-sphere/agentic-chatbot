import { ContentExtractor } from '../services/content-extractor.js';
import { z } from 'zod';

const schemaObj = z.object({
  url: z.string().url(),
  format: z.enum(['markdown', 'html', 'text']).default('markdown'),
  includeLinks: z.boolean().default(true).optional(),
  maxLength: z.number().max(100000).default(50000).optional(),
});

export const webFetchSchema = {
  url: z.string().url(),
  format: z.enum(['markdown', 'html', 'text']).default('markdown'),
  includeLinks: z.boolean().default(true).optional(),
  maxLength: z.number().max(100000).default(50000).optional(),
};

export async function webFetch(args: z.infer<typeof schemaObj>) {
  const { url, format, maxLength } = args;

  try {
    // Fetch HTML
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; AgenticBot/1.0)',
      },
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const html = await response.text();

    // Extract content
    const extractor = new ContentExtractor();
    const extracted = extractor.extract(html, url);

    if (!extracted) {
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({ error: 'Failed to extract content' }),
        }],
      };
    }

    // Convert to requested format
    let content: string;
    switch (format) {
      case 'markdown':
        content = extractor.toMarkdown(extracted.content);
        break;
      case 'text':
        content = extractor.toText(extracted.content);
        break;
      case 'html':
      default:
        content = extracted.content;
    }

    // Truncate if needed
    if (content.length > maxLength!) {
      content = content.slice(0, maxLength!) + '\n\n[Content truncated...]';
    }

    return {
      content: [{
        type: 'text' as const,
        text: JSON.stringify({
          url,
          title: extracted.title,
          content,
          excerpt: extracted.excerpt,
          byline: extracted.byline,
          length: content.length,
          format,
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
