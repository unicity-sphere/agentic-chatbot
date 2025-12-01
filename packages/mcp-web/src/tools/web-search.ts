import {
  searxng,
  brave,
  google,
  tavily,
  serpapi,
  exa,
  arxiv,
  webSearch as plusWebSearch
} from '@plust/search-sdk';
import { z } from 'zod';
import { searchProviderManager } from '../services/search-provider-manager.js';

const schemaObj = z.object({
  query: z.string().min(1).describe('Search query - supports exact phrases with quotes and site: operator'),
  maxResults: z.number().min(1).max(20).default(10).describe('Maximum number of results to return (1-20)'),
  region: z.enum(['us-en', 'uk-en', 'wt-wt']).default('wt-wt').describe('Search region: us-en (United States), uk-en (United Kingdom), wt-wt (worldwide)').optional(),
});

export const webSearchSchema = {
  query: z.string().min(1).describe('Search query - supports exact phrases with quotes and site: operator'),
  maxResults: z.number().min(1).max(20).default(10).describe('Maximum number of results to return (1-20)'),
  region: z.enum(['us-en', 'uk-en', 'wt-wt']).default('wt-wt').describe('Search region: us-en (United States), uk-en (United Kingdom), wt-wt (worldwide)').optional(),
};

// Map country codes to language preferences
function getLanguageFromCountry(countryCode?: string): string {
  if (!countryCode) return 'en';

  const normalized = countryCode.toUpperCase();
  const languageMap: Record<string, string> = {
    'US': 'en-US',
    'USA': 'en-US',
    'GB': 'en-GB',
    'UK': 'en-GB',
    'AE': 'en',
    'SA': 'ar',
    'QA': 'ar',
  };

  return languageMap[normalized] || 'en';
}

// Configure a search provider based on its name
function configureProvider(providerName: string, language: string, region: string) {
  // Handle SearXNG instances
  if (providerName.startsWith('searxng:')) {
    const instanceUrl = providerName.split(':')[1];
    return searxng.configure({
      baseUrl: `https://${instanceUrl}/search`,
      additionalParams: {
        categories: 'general',
        engines: 'google,bing,brave,duckduckgo',
        language,
      },
    });
  }

  // Configure paid/free providers
  switch (providerName) {
    case 'brave':
      return brave.configure({
        apiKey: process.env.BRAVE_API_KEY!,
        country: region === 'us-en' ? 'US' : region === 'uk-en' ? 'GB' : undefined,
      });

    case 'google':
      return google.configure({
        apiKey: process.env.GOOGLE_API_KEY!,
        cx: process.env.GOOGLE_CSE_ID!,
        gl: region === 'us-en' ? 'us' : region === 'uk-en' ? 'uk' : undefined,
      });

    case 'tavily':
      return tavily.configure({
        apiKey: process.env.TAVILY_API_KEY!,
      });

    case 'serpapi':
      return serpapi.configure({
        apiKey: process.env.SERP_API_KEY!,
        engine: 'google',
      });

    case 'exa':
      return exa.configure({
        apiKey: process.env.EXA_API_KEY!,
      });

    case 'arxiv':
      return arxiv.configure({
        sortBy: 'relevance',
        sortOrder: 'descending',
      });

    default:
      throw new Error(`Unknown provider: ${providerName}`);
  }
}

// Try providers with automatic failover and health tracking
async function searchWithFailover(
  query: string,
  maxResults: number,
  language: string,
  region: string
): Promise<{ results: any[]; provider: string }> {
  const healthyProviders = searchProviderManager.getHealthyProviders();

  if (healthyProviders.length === 0) {
    throw new Error('No healthy search providers available. All providers are currently failing.');
  }

  console.log(`[WebSearch] Available providers: ${healthyProviders.map(p => `${p.name}(${p.tier})`).join(', ')}`);

  for (const providerConfig of healthyProviders) {
    try {
      console.log(`[WebSearch] Trying ${providerConfig.name} (${providerConfig.tier})...`);

      const provider = configureProvider(providerConfig.name, language, region);

      // Add small random delay (100-300ms)
      const delay = Math.floor(Math.random() * 200) + 100;
      await new Promise(resolve => setTimeout(resolve, delay));

      const results = await plusWebSearch({
        query,
        maxResults,
        provider: [provider],
      });

      if (results && results.length > 0) {
        searchProviderManager.recordSuccess(providerConfig.name);
        console.log(`[WebSearch] ✓ Success with ${providerConfig.name}, found ${results.length} results`);
        return { results, provider: providerConfig.name };
      }

      console.log(`[WebSearch] No results from ${providerConfig.name}, trying next...`);
      // Not a failure, just no results - don't penalize
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      searchProviderManager.recordFailure(providerConfig.name, errorMsg);
      // Continue to next provider
    }
  }

  // All providers tried
  throw new Error('All available search providers failed or returned no results');
}

export async function webSearch(args: z.infer<typeof schemaObj>, meta?: { userId?: string; userIp?: string; userCountry?: string }) {
  const { query, maxResults = 10, region = 'wt-wt' } = args;

  // Determine language based on user country
  const language = getLanguageFromCountry(meta?.userCountry);

  console.log('[WebSearch] Query:', query, 'Region:', region, 'Language:', language, 'Country:', meta?.userCountry);

  try {
    const { results: searchResults, provider: usedProvider } = await searchWithFailover(
      query,
      maxResults,
      language,
      region
    );

    if (!searchResults || searchResults.length === 0) {
      console.log('[WebSearch] No results found for query:', query);
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            query,
            results: [],
            count: 0,
            message: 'No results found',
            provider: usedProvider,
          }),
        }],
      };
    }

    // Format results
    const results = searchResults.slice(0, maxResults).map((result, index) => ({
      title: result.title,
      url: result.url,
      description: result.snippet || result.title,
      position: index + 1,
      provider: result.provider || usedProvider,
    }));

    console.log(`[WebSearch] Returning ${results.length} results from ${usedProvider}`);

    return {
      content: [{
        type: 'text' as const,
        text: JSON.stringify({
          query,
          results,
          count: results.length,
          provider: usedProvider,
          language,
          region,
        }),
      }],
    };
  } catch (error) {
    console.error('[WebSearch] All providers failed:', error);

    // Log health summary for debugging
    const healthSummary = searchProviderManager.getHealthSummary();
    console.log('[WebSearch] Provider health summary:', JSON.stringify(healthSummary, null, 2));

    return {
      content: [{
        type: 'text' as const,
        text: JSON.stringify({
          error: error instanceof Error ? error.message : 'Search failed',
          query,
          message: 'Search service is currently unavailable. Please try again in a few minutes.',
          suggestion: 'Multiple search providers are experiencing issues. You can configure API keys in .env for more reliable paid providers (BRAVE_API_KEY, GOOGLE_API_KEY+GOOGLE_CSE_ID, TAVILY_API_KEY).',
        }),
      }],
    };
  }
}
