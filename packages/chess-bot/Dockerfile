FROM node:22-alpine AS builder
WORKDIR /app
RUN corepack enable pnpm

COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY packages/chess-bot/package.json ./packages/chess-bot/

RUN pnpm install --frozen-lockfile

COPY packages/chess-bot ./packages/chess-bot
RUN pnpm --filter @agentic/chess-bot build

FROM node:22-alpine
WORKDIR /app
RUN corepack enable pnpm

# Copy workspace configuration
COPY --from=builder /app/pnpm-workspace.yaml ./pnpm-workspace.yaml
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/pnpm-lock.yaml ./pnpm-lock.yaml

# Copy chess-bot built files
COPY --from=builder /app/packages/chess-bot/dist ./packages/chess-bot/dist
COPY --from=builder /app/packages/chess-bot/package.json ./packages/chess-bot/package.json

# Install production dependencies only
RUN pnpm install --frozen-lockfile --prod --filter @agentic/chess-bot...

WORKDIR /app/packages/chess-bot
CMD ["pnpm", "start"]
