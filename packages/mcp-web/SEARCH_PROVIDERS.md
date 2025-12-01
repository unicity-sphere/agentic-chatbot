# Search Providers Configuration

The web search tool supports multiple search providers with automatic failover and health tracking.

## Provider Tiers

### Tier 1: Paid APIs (Optional, Higher Priority)

These providers require API keys but offer better reliability and higher rate limits. If configured, they will be tried first.

#### Brave Search API
- **Priority**: Highest (tried first if configured)
- **Cost**: Free tier: 2,000 queries/month, then $5 per 1,000 queries
- **Sign up**: https://brave.com/search/api/
- **Configuration**:
  ```bash
  BRAVE_API_KEY=your_brave_api_key_here
  ```

#### Google Custom Search API
- **Priority**: Second
- **Cost**: Free tier: 100 queries/day, then $5 per 1,000 queries (up to 10k/day)
- **Sign up**: https://developers.google.com/custom-search/v1/overview
- **Configuration**:
  ```bash
  GOOGLE_API_KEY=your_google_api_key_here
  GOOGLE_CSE_ID=your_custom_search_engine_id_here
  ```

#### Tavily Search API
- **Priority**: Third
- **Cost**: Free tier: 1,000 queries/month, then paid plans
- **Sign up**: https://tavily.com/
- **Configuration**:
  ```bash
  TAVILY_API_KEY=your_tavily_api_key_here
  ```

#### SerpAPI
- **Priority**: Fourth
- **Cost**: Free tier: 100 queries/month, then paid plans
- **Sign up**: https://serpapi.com/
- **Configuration**:
  ```bash
  SERP_API_KEY=your_serpapi_key_here
  ```

#### Exa (Semantic Search)
- **Priority**: Fifth
- **Cost**: Paid plans only
- **Sign up**: https://exa.ai/
- **Configuration**:
  ```bash
  EXA_API_KEY=your_exa_api_key_here
  ```

### Tier 2: Free Providers (No API Keys Required)

These are automatically used as fallback if paid providers aren't configured or fail.

#### SearXNG Instances
Multiple public SearXNG instances are configured for redundancy:
- searx.be
- search.bus-hit.me
- searx.work
- priv.au
- search.sapti.me

**Note**: SearXNG is a metasearch engine that aggregates results from Google, Bing, Brave, and DuckDuckGo.

#### Arxiv
Academic paper search (specialized use case).

## Health Tracking

The system automatically tracks provider health:

- **Success**: Provider is marked healthy
- **Failure**: Consecutive failures are tracked
- **Unhealthy**: After 3 consecutive failures, provider enters 5-minute cooldown
- **Recovery**: After cooldown, provider gets another chance

This ensures:
- Fast searches (skips failing providers)
- Automatic recovery (retries after cooldown)
- No wasted time on broken providers

## Search Flow

1. **Try paid providers first** (if configured) in priority order
2. **Fall back to SearXNG** instances if paid providers fail
3. **Try Arxiv** as last resort
4. **Skip unhealthy providers** (those with 3+ failures)
5. **Return results** from first successful provider

## Example Logs

```
[WebSearch] Available providers: brave(paid), google(paid), searxng:searx.be(free), searxng:search.bus-hit.me(free)
[WebSearch] Trying brave (paid)...
[SearchManager] ✓ brave successful
[WebSearch] ✓ Success with brave, found 10 results
```

If paid provider fails:
```
[WebSearch] Trying brave (paid)...
[SearchManager] ✗ brave failed (1/3): API rate limit exceeded
[WebSearch] Trying google (paid)...
[SearchManager] ✓ google successful
```

After 3 failures:
```
[SearchManager] ⚠ brave marked unhealthy (will retry in 300s)
[SearchManager] Skipping unhealthy provider: brave (3 failures, recovery in 298s)
```

## Best Practices

1. **For production**: Configure at least one paid API (Brave recommended for best free tier)
2. **For hobby projects**: Free SearXNG instances work well with automatic failover
3. **Monitor health**: Check logs for provider health status
4. **Mix tiers**: Configure 1-2 paid APIs + free fallbacks for best reliability
