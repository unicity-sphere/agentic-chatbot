/**
 * Generate a UUID v4
 * Falls back to a simple implementation if crypto.randomUUID is not available
 * (e.g., in non-secure HTTP contexts)
 */
export function generateUUID(): string {
    // Try to use native crypto.randomUUID if available
    if (typeof crypto !== 'undefined' && crypto.randomUUID) {
        return crypto.randomUUID();
    }

    // Fallback implementation for non-secure contexts
    // This is a simple UUID v4 implementation
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
        const r = Math.random() * 16 | 0;
        const v = c === 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
    });
}
