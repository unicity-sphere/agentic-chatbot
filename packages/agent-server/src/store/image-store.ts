import { randomUUID } from 'crypto';

interface StoredImage {
    data: string; // Base64 data
    mimeType: string;
    createdAt: number;
}

class ImageStore {
    private images: Map<string, StoredImage> = new Map();
    private readonly TTL_MS = 1000 * 60 * 60; // 1 hour TTL
    private readonly MAX_IMAGES = 100;

    constructor() {
        // Periodic cleanup
        setInterval(() => this.cleanup(), 1000 * 60 * 15); // Every 15 mins
    }

    store(data: string, mimeType: string): string {
        // Basic LRU-like protection: if full, delete oldest
        if (this.images.size >= this.MAX_IMAGES) {
            const oldest = this.images.keys().next().value;
            if (oldest) this.images.delete(oldest);
        }

        const id = randomUUID();
        this.images.set(id, {
            data,
            mimeType,
            createdAt: Date.now(),
        });
        return id;
    }

    get(id: string): StoredImage | undefined {
        return this.images.get(id);
    }

    private cleanup() {
        const now = Date.now();
        for (const [id, img] of this.images.entries()) {
            if (now - img.createdAt > this.TTL_MS) {
                this.images.delete(id);
            }
        }
    }
}

export const imageStore = new ImageStore();
