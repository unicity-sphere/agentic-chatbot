import { Readability } from '@mozilla/readability';
import { JSDOM } from 'jsdom';
import TurndownService from 'turndown';
import { gfm } from 'turndown-plugin-gfm';

export interface ExtractedContent {
  title: string;
  content: string;
  excerpt: string;
  byline: string | null;
  textContent: string;
}

export class ContentExtractor {
  private turndown: TurndownService;

  constructor() {
    this.turndown = new TurndownService({
      headingStyle: 'atx',
      codeBlockStyle: 'fenced',
      emDelimiter: '*',
    });
    this.turndown.use(gfm);
  }

  extract(html: string, url: string): ExtractedContent | null {
    try {
      // Limit HTML size to prevent memory issues (1MB max)
      const maxSize = 1024 * 1024; // 1MB
      if (html.length > maxSize) {
        html = html.slice(0, maxSize);
      }

      // Parse HTML with jsdom
      const dom = new JSDOM(html, { url });
      const document = dom.window.document;

      // Extract content with Readability
      const reader = new Readability(document);
      const article = reader.parse();

      if (!article) {
        // Fallback: basic extraction
        return this.fallbackExtract(html, document);
      }

      return {
        title: article.title,
        content: article.content,
        excerpt: article.excerpt,
        byline: article.byline,
        textContent: article.textContent,
      };
    } catch (error) {
      console.error('[ContentExtractor] Error:', error);
      return null;
    }
  }

  toMarkdown(html: string): string {
    return this.turndown.turndown(html);
  }

  toText(html: string): string {
    // Strip all HTML tags
    return html.replace(/<[^>]*>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  private fallbackExtract(html: string, document: Document): ExtractedContent {
    // Fallback extraction logic
    const title = document.querySelector('title')?.textContent || 'Untitled';
    const body = document.body?.textContent || '';

    return {
      title,
      content: html,
      excerpt: body.slice(0, 200),
      byline: null,
      textContent: body,
    };
  }
}
