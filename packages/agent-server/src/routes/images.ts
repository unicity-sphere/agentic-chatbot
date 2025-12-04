import { Hono } from 'hono';
import { imageStore } from '../store/image-store.js';

export const imagesRouter = new Hono();

imagesRouter.get('/:id', (c) => {
    const id = c.req.param('id');
    const image = imageStore.get(id);

    if (!image) {
        return c.text('Image not found', 404);
    }

    // Convert base64 to buffer
    const buffer = Buffer.from(image.data, 'base64');

    c.header('Content-Type', image.mimeType);
    c.header('Cache-Control', 'public, max-age=3600'); // Cache for 1 hour

    return c.body(buffer);
});
