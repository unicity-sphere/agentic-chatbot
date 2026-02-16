FROM node:20-alpine AS builder
WORKDIR /app
RUN corepack enable pnpm

COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY packages/kbbot/package.json ./packages/kbbot/

RUN pnpm install --frozen-lockfile

COPY packages/kbbot ./packages/kbbot

RUN pnpm --filter @agentic/kbbot build

FROM node:20-alpine
WORKDIR /app
RUN corepack enable pnpm

# Copy workspace configuration files
COPY --from=builder /app/pnpm-workspace.yaml ./pnpm-workspace.yaml
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/pnpm-lock.yaml ./pnpm-lock.yaml

# Copy kbbot built files
COPY --from=builder /app/packages/kbbot/dist ./packages/kbbot/dist
COPY --from=builder /app/packages/kbbot/package.json ./packages/kbbot/package.json

# Install production dependencies only
RUN pnpm install --frozen-lockfile --prod --filter @agentic/kbbot

WORKDIR /app/packages/kbbot
EXPOSE 3004
CMD ["pnpm", "start"]
