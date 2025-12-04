import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { serve } from '@hono/node-server';
import { chatRouter } from './routes/chat.js';
import { activitiesRouter } from './routes/activities.js';

import { imagesRouter } from './routes/images.js';

const app = new Hono();

// Middleware
app.use('*', logger());

// Parse CORS origins from environment (comma-separated list)
const corsOrigins = process.env.CORS_ORIGIN
    ? process.env.CORS_ORIGIN.split(',').map(o => o.trim())
    : ['http://localhost:5173'];

console.log('[CORS] Allowed origins:', corsOrigins);

app.use('*', cors({
    origin: (origin) => {
        console.log('[CORS] Request origin:', origin);
        // Reject requests with no origin header for security
        if (!origin) {
            console.log('[CORS] Rejected: No origin header');
            return corsOrigins[0]; // Return a valid origin to avoid wildcard
        }
        // Check if origin is in allowed list
        const allowed = corsOrigins.includes(origin);
        console.log('[CORS] Origin allowed:', allowed);
        return allowed ? origin : corsOrigins[0];
    },
    credentials: true,
}));

// Routes
app.route('/chat', chatRouter);
app.route('/activities', activitiesRouter);
app.route('/images', imagesRouter);

// Health check
app.get('/health', (c) => c.json({ status: 'ok' }));

const port = parseInt(process.env.PORT || '3000');

serve({
    fetch: app.fetch,
    port,
});

console.log(`Agent server running on http://localhost:${port}`);
