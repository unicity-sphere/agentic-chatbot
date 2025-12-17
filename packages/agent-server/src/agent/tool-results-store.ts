/**
 * In-memory store for tool results across conversation turns
 * Allows LLM to reference sources from previous turns
 */

import type { ToolResult } from './references.js';

interface SessionData {
    toolResults: Map<string, ToolResult>;
    lastAccessed: number;
}

class ToolResultsStore {
    private sessions = new Map<string, SessionData>();
    private readonly SESSION_TIMEOUT = 60 * 60 * 1000; // 1 hour
    private cleanupInterval: NodeJS.Timeout | null = null;

    constructor() {
        // Start cleanup interval
        this.startCleanup();
    }

    /**
     * Get session key from userId and activityId
     */
    private getSessionKey(userId: string, activityId: string): string {
        return `${userId}:${activityId}`;
    }

    /**
     * Get tool results for a session
     */
    getToolResults(userId: string, activityId: string): Map<string, ToolResult> {
        const key = this.getSessionKey(userId, activityId);
        const session = this.sessions.get(key);

        if (session) {
            // Update last accessed time
            session.lastAccessed = Date.now();
            return session.toolResults;
        }

        // Create new session
        const newSession: SessionData = {
            toolResults: new Map(),
            lastAccessed: Date.now()
        };
        this.sessions.set(key, newSession);
        return newSession.toolResults;
    }

    /**
     * Add tool results to a session
     */
    addToolResults(userId: string, activityId: string, results: Map<string, ToolResult>): void {
        const toolResults = this.getToolResults(userId, activityId);

        // Merge new results
        for (const [id, result] of results) {
            toolResults.set(id, result);
        }

        console.log(`[ToolResultsStore] Session ${userId}:${activityId} now has ${toolResults.size} tool results`);
    }

    /**
     * Clear tool results for a session
     */
    clearSession(userId: string, activityId: string): void {
        const key = this.getSessionKey(userId, activityId);
        this.sessions.delete(key);
        console.log(`[ToolResultsStore] Cleared session ${key}`);
    }

    /**
     * Start periodic cleanup of expired sessions
     */
    private startCleanup(): void {
        // Run cleanup every 15 minutes
        this.cleanupInterval = setInterval(() => {
            this.cleanup();
        }, 15 * 60 * 1000);
    }

    /**
     * Remove expired sessions
     */
    private cleanup(): void {
        const now = Date.now();
        let expiredCount = 0;

        for (const [key, session] of this.sessions.entries()) {
            if (now - session.lastAccessed > this.SESSION_TIMEOUT) {
                this.sessions.delete(key);
                expiredCount++;
            }
        }

        if (expiredCount > 0) {
            console.log(`[ToolResultsStore] Cleaned up ${expiredCount} expired sessions. Active sessions: ${this.sessions.size}`);
        }
    }

    /**
     * Get stats about the store
     */
    getStats(): { sessionCount: number; totalResults: number } {
        let totalResults = 0;
        for (const session of this.sessions.values()) {
            totalResults += session.toolResults.size;
        }
        return {
            sessionCount: this.sessions.size,
            totalResults
        };
    }

    /**
     * Stop cleanup interval (for graceful shutdown)
     */
    destroy(): void {
        if (this.cleanupInterval) {
            clearInterval(this.cleanupInterval);
            this.cleanupInterval = null;
        }
    }
}

// Global singleton instance
export const toolResultsStore = new ToolResultsStore();
