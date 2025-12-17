/**
 * Failover mechanism for OpenAI-compatible LLM endpoints
 *
 * Implements primary-preferred failover with health tracking:
 * - Always tries primary (first) endpoint first
 * - Fails over to secondary endpoints only on fatal errors (5xx, connection errors)
 * - Does NOT failover on 4xx errors (client errors)
 * - Periodically attempts to recover to primary endpoint
 */

interface EndpointHealth {
    url: string;
    apiKey?: string;
    healthy: boolean;
    lastFailure?: number;
    consecutiveFailures: number;
    failureCount: number; // Total failures for exponential backoff
}

interface FailoverConfig {
    endpoints: Array<{ url: string; apiKey?: string }>;
}

class EndpointFailoverManager {
    private configs = new Map<string, FailoverConfig>();
    private health = new Map<string, EndpointHealth[]>();

    // Configuration
    private readonly BASE_RECOVERY_INTERVAL_MS = 60000; // Base interval: 60s
    private readonly MAX_RECOVERY_INTERVAL_MS = 1800000; // Max interval: 30 minutes
    private readonly MAX_CONSECUTIVE_FAILURES = 1; // Mark unhealthy after 1 failure

    /**
     * Register a set of failover endpoints
     * Only registers if not already registered (preserves existing health state)
     */
    registerEndpoints(configId: string, endpoints: Array<{ url: string; apiKey?: string }>) {
        // Check if already registered - if so, preserve health state
        if (this.configs.has(configId)) {
            console.log(`[Failover] Config ${configId} already registered, preserving health state`);
            return;
        }

        this.configs.set(configId, { endpoints });

        // Initialize health tracking
        this.health.set(configId, endpoints.map(ep => ({
            url: ep.url,
            apiKey: ep.apiKey,
            healthy: true,
            consecutiveFailures: 0,
            failureCount: 0,
        })));

        console.log(`[Failover] Registered ${endpoints.length} endpoints for config ${configId}`);
    }

    /**
     * Calculate recovery interval using exponential backoff
     */
    private getRecoveryInterval(failureCount: number): number {
        // Exponential backoff: 60s, 120s, 240s, 480s, ... up to 30 minutes
        const interval = this.BASE_RECOVERY_INTERVAL_MS * Math.pow(2, failureCount);
        return Math.min(interval, this.MAX_RECOVERY_INTERVAL_MS);
    }

    /**
     * Get the current active endpoint (primary if healthy, otherwise first healthy fallback)
     */
    getActiveEndpoint(configId: string): { url: string; apiKey?: string; index: number } | null {
        const config = this.configs.get(configId);
        const health = this.health.get(configId);

        if (!config || !health) {
            console.error(`[Failover] No config found for ${configId}`);
            return null;
        }

        const now = Date.now();

        // Check if primary should be retried (recovery attempt with exponential backoff)
        if (health[0] && !health[0].healthy && health[0].lastFailure) {
            const recoveryInterval = this.getRecoveryInterval(health[0].failureCount);
            const timeSinceFailure = now - health[0].lastFailure;

            if (timeSinceFailure >= recoveryInterval) {
                const nextInterval = this.getRecoveryInterval(health[0].failureCount + 1);
                console.log(`[Failover] Attempting recovery to primary endpoint (last failure: ${Math.round(timeSinceFailure / 1000)}s ago, backoff: ${Math.round(recoveryInterval / 1000)}s, next: ${Math.round(nextInterval / 1000)}s)`);
                health[0].healthy = true;
                health[0].consecutiveFailures = 0;
            }
        }

        // Find first healthy endpoint (prefer primary)
        for (let i = 0; i < health.length; i++) {
            if (health[i].healthy) {
                const endpoint = config.endpoints[i];
                if (i > 0) {
                    console.log(`[Failover] Using fallback endpoint ${i}: ${endpoint.url}`);
                }
                return { ...endpoint, index: i };
            }
        }

        // All endpoints unhealthy - reset primary and try anyway
        console.warn(`[Failover] All endpoints unhealthy, resetting primary`);
        health[0].healthy = true;
        health[0].consecutiveFailures = 0;
        return { ...config.endpoints[0], index: 0 };
    }

    /**
     * Check if an error should trigger failover
     */
    private shouldFailover(error: any): boolean {
        const errorStr = String(error);
        const message = error?.message || errorStr;

        // Connection errors - failover
        if (message.includes('ECONNREFUSED') ||
            message.includes('ENOTFOUND') ||
            message.includes('ETIMEDOUT') ||
            message.includes('network') ||
            message.includes('fetch failed')) {
            console.log(`[Failover] Connection error detected: ${message}`);
            return true;
        }

        // 5xx server errors - failover
        if (message.includes('500') ||
            message.includes('502') ||
            message.includes('503') ||
            message.includes('504') ||
            message.includes('Internal Server Error') ||
            message.includes('Bad Gateway') ||
            message.includes('Service Unavailable')) {
            console.log(`[Failover] Server error detected: ${message}`);
            return true;
        }

        // 4xx client errors - do NOT failover
        if (message.includes('400') ||
            message.includes('401') ||
            message.includes('403') ||
            message.includes('404') ||
            message.includes('429')) {
            console.log(`[Failover] Client error (no failover): ${message}`);
            return false;
        }

        // Unknown error - be conservative, failover
        console.log(`[Failover] Unknown error type (will failover): ${message}`);
        return true;
    }

    /**
     * Mark an endpoint as failed
     */
    recordFailure(configId: string, endpointIndex: number, error: any) {
        const health = this.health.get(configId);
        if (!health || !health[endpointIndex]) return;

        const shouldFail = this.shouldFailover(error);
        if (!shouldFail) {
            console.log(`[Failover] Not marking endpoint ${endpointIndex} as failed (client error)`);
            return;
        }

        const endpoint = health[endpointIndex];
        endpoint.consecutiveFailures++;
        endpoint.failureCount++;
        endpoint.lastFailure = Date.now();

        if (endpoint.consecutiveFailures >= this.MAX_CONSECUTIVE_FAILURES) {
            endpoint.healthy = false;
            const nextRecovery = this.getRecoveryInterval(endpoint.failureCount);
            console.warn(`[Failover] Endpoint ${endpointIndex} marked unhealthy (failure count: ${endpoint.failureCount}, next retry in ${Math.round(nextRecovery / 1000)}s)`);
        } else {
            console.log(`[Failover] Endpoint ${endpointIndex} failure ${endpoint.consecutiveFailures}/${this.MAX_CONSECUTIVE_FAILURES}`);
        }
    }

    /**
     * Mark an endpoint as successful
     */
    recordSuccess(configId: string, endpointIndex: number) {
        const health = this.health.get(configId);
        if (!health || !health[endpointIndex]) return;

        const endpoint = health[endpointIndex];
        const wasUnhealthy = !endpoint.healthy || endpoint.consecutiveFailures > 0;

        endpoint.healthy = true;
        endpoint.consecutiveFailures = 0;
        // Reset failure count on successful recovery to restore fast retries
        endpoint.failureCount = 0;

        if (wasUnhealthy) {
            console.log(`[Failover] Endpoint ${endpointIndex} recovered (failure count reset)`);
        }
    }
}

// Global singleton
export const endpointFailoverManager = new EndpointFailoverManager();

/**
 * Create a fetch wrapper that implements failover logic
 */
export function createFailoverFetch(configId: string, primaryBaseUrl: string): typeof fetch {
    // Normalize the primary base URL (remove trailing slash)
    const normalizedPrimaryBase = primaryBaseUrl.replace(/\/$/, '');

    return async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
        const endpoint = endpointFailoverManager.getActiveEndpoint(configId);

        if (!endpoint) {
            throw new Error(`No active endpoint available for config ${configId}`);
        }

        const originalUrl = typeof input === 'string' ? input : input.toString();

        // Extract the path that the AI SDK appended to the base URL
        // For example: if primary base is "https://primary.com/v1" and original URL is
        // "https://primary.com/v1/chat/completions", we extract "/chat/completions"
        let url: string;
        if (originalUrl.startsWith(normalizedPrimaryBase)) {
            // Extract the SDK-appended path
            const sdkPath = originalUrl.substring(normalizedPrimaryBase.length);
            // Construct new URL with the active endpoint's base URL
            const normalizedEndpointUrl = endpoint.url.replace(/\/$/, '');
            url = normalizedEndpointUrl + sdkPath;
        } else {
            // Fallback: if URL doesn't match expected pattern, use as-is
            console.warn(`[Failover] URL ${originalUrl} doesn't start with expected base ${normalizedPrimaryBase}`);
            url = originalUrl;
        }

        // Add API key if provided
        const headers = new Headers(init?.headers);
        if (endpoint.apiKey) {
            headers.set('Authorization', `Bearer ${endpoint.apiKey}`);
        }

        try {
            const response = await fetch(url, { ...init, headers });

            // Record success
            endpointFailoverManager.recordSuccess(configId, endpoint.index);

            return response;
        } catch (error) {
            console.error(`[Failover] Request failed on endpoint ${endpoint.index}:`, error);

            // Record failure
            endpointFailoverManager.recordFailure(configId, endpoint.index, error);

            // Retry with next endpoint
            const nextEndpoint = endpointFailoverManager.getActiveEndpoint(configId);
            if (nextEndpoint && nextEndpoint.index !== endpoint.index) {
                console.log(`[Failover] Retrying with endpoint ${nextEndpoint.index}`);

                // Construct retry URL with the next endpoint's base
                let retryUrl: string;
                if (originalUrl.startsWith(normalizedPrimaryBase)) {
                    const sdkPath = originalUrl.substring(normalizedPrimaryBase.length);
                    const normalizedNextUrl = nextEndpoint.url.replace(/\/$/, '');
                    retryUrl = normalizedNextUrl + sdkPath;
                } else {
                    retryUrl = originalUrl;
                }

                const retryHeaders = new Headers(init?.headers);
                if (nextEndpoint.apiKey) {
                    retryHeaders.set('Authorization', `Bearer ${nextEndpoint.apiKey}`);
                }

                try {
                    const retryResponse = await fetch(retryUrl, { ...init, headers: retryHeaders });
                    endpointFailoverManager.recordSuccess(configId, nextEndpoint.index);
                    return retryResponse;
                } catch (retryError) {
                    endpointFailoverManager.recordFailure(configId, nextEndpoint.index, retryError);
                    throw retryError;
                }
            }

            throw error;
        }
    };
}
