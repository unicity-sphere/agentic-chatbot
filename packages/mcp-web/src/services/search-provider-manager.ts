/**
 * Search Provider Manager
 *
 * Manages multiple search providers with health tracking and automatic failover.
 * Prioritizes paid APIs (when configured) over free ones, and remembers failing providers.
 */

interface ProviderHealth {
  name: string;
  consecutiveFailures: number;
  lastSuccess?: number;
  lastFailure?: number;
  isHealthy: boolean;
}

interface ProviderConfig {
  name: string;
  tier: 'paid' | 'free';
  priority: number; // Lower = higher priority
  requiresApiKey: boolean;
  configured: boolean;
}

export class SearchProviderManager {
  private healthMap: Map<string, ProviderHealth> = new Map();
  private readonly MAX_CONSECUTIVE_FAILURES = 3;
  private readonly RECOVERY_TIME_MS = 5 * 60 * 1000; // 5 minutes

  constructor() {
    // Initialize health tracking for all known providers
    this.initializeHealthTracking();
  }

  private initializeHealthTracking() {
    const providers = this.getAllProviders();
    providers.forEach(provider => {
      this.healthMap.set(provider.name, {
        name: provider.name,
        consecutiveFailures: 0,
        isHealthy: true,
      });
    });
  }

  /**
   * Get all configured providers in priority order
   */
  getAllProviders(): ProviderConfig[] {
    const providers: ProviderConfig[] = [];

    // Tier 1: Paid APIs (if configured)
    if (process.env.BRAVE_API_KEY) {
      providers.push({
        name: 'brave',
        tier: 'paid',
        priority: 1,
        requiresApiKey: true,
        configured: true,
      });
    }

    if (process.env.GOOGLE_API_KEY && process.env.GOOGLE_CSE_ID) {
      providers.push({
        name: 'google',
        tier: 'paid',
        priority: 2,
        requiresApiKey: true,
        configured: true,
      });
    }

    if (process.env.TAVILY_API_KEY) {
      providers.push({
        name: 'tavily',
        tier: 'paid',
        priority: 3,
        requiresApiKey: true,
        configured: true,
      });
    }

    if (process.env.SERP_API_KEY) {
      providers.push({
        name: 'serpapi',
        tier: 'paid',
        priority: 4,
        requiresApiKey: true,
        configured: true,
      });
    }

    if (process.env.EXA_API_KEY) {
      providers.push({
        name: 'exa',
        tier: 'paid',
        priority: 5,
        requiresApiKey: true,
        configured: true,
      });
    }

    // Tier 2: Free providers

    // DDGS (Python metasearch library) - Highest priority free provider
    // Searches multiple backends (bing, brave, duckduckgo, google) in parallel
    providers.push({
      name: 'ddgs',
      tier: 'free',
      priority: 50, // Higher priority than SearXNG, lower than paid APIs
      requiresApiKey: false,
      configured: true,
    });

    // SearXNG instances - Fallback if DDGS fails
    const searxngInstances = [
      'searxng:searx.be',
      'searxng:search.bus-hit.me',
      'searxng:searx.work',
      'searxng:priv.au',
      'searxng:search.sapti.me',
    ];

    searxngInstances.forEach((instance, index) => {
      providers.push({
        name: instance,
        tier: 'free',
        priority: 100 + index, // Lower priority than DDGS
        requiresApiKey: false,
        configured: true,
      });
    });

    // Tier 3: Arxiv (academic papers, no API key)
    providers.push({
      name: 'arxiv',
      tier: 'free',
      priority: 200,
      requiresApiKey: false,
      configured: true,
    });

    return providers.sort((a, b) => a.priority - b.priority);
  }

  /**
   * Get healthy providers in priority order
   */
  getHealthyProviders(): ProviderConfig[] {
    const allProviders = this.getAllProviders();
    const now = Date.now();

    return allProviders.filter(provider => {
      const health = this.healthMap.get(provider.name);
      if (!health) return true; // Unknown provider, assume healthy

      // If provider has too many consecutive failures
      if (health.consecutiveFailures >= this.MAX_CONSECUTIVE_FAILURES) {
        // Check if enough time has passed for recovery attempt
        if (health.lastFailure) {
          const timeSinceFailure = now - health.lastFailure;
          if (timeSinceFailure < this.RECOVERY_TIME_MS) {
            console.log(`[SearchManager] Skipping unhealthy provider: ${provider.name} (${health.consecutiveFailures} failures, recovery in ${Math.round((this.RECOVERY_TIME_MS - timeSinceFailure) / 1000)}s)`);
            return false; // Still in cooldown
          }
          console.log(`[SearchManager] Attempting recovery for: ${provider.name}`);
          // Reset failures to allow recovery attempt
          health.consecutiveFailures = this.MAX_CONSECUTIVE_FAILURES - 1;
        }
      }

      return true;
    });
  }

  /**
   * Record successful search
   */
  recordSuccess(providerName: string) {
    const health = this.healthMap.get(providerName);
    if (health) {
      health.consecutiveFailures = 0;
      health.lastSuccess = Date.now();
      health.isHealthy = true;
      console.log(`[SearchManager] ✓ ${providerName} successful`);
    }
  }

  /**
   * Record failed search
   */
  recordFailure(providerName: string, error: string) {
    const health = this.healthMap.get(providerName);
    if (health) {
      health.consecutiveFailures++;
      health.lastFailure = Date.now();
      health.isHealthy = health.consecutiveFailures < this.MAX_CONSECUTIVE_FAILURES;

      console.log(`[SearchManager] ✗ ${providerName} failed (${health.consecutiveFailures}/${this.MAX_CONSECUTIVE_FAILURES}): ${error}`);

      if (!health.isHealthy) {
        console.log(`[SearchManager] ⚠ ${providerName} marked unhealthy (will retry in ${this.RECOVERY_TIME_MS / 1000}s)`);
      }
    }
  }

  /**
   * Get health status summary
   */
  getHealthSummary(): Record<string, any> {
    const summary: Record<string, any> = {};

    this.healthMap.forEach((health, name) => {
      summary[name] = {
        healthy: health.isHealthy,
        failures: health.consecutiveFailures,
        lastSuccess: health.lastSuccess ? new Date(health.lastSuccess).toISOString() : 'never',
        lastFailure: health.lastFailure ? new Date(health.lastFailure).toISOString() : 'never',
      };
    });

    return summary;
  }
}

// Global singleton instance
export const searchProviderManager = new SearchProviderManager();
