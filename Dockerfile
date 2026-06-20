# Aegis — Multi-stage Dockerfile
#
# Builds all TypeScript services from the pnpm monorepo.
# The contract toolchain (Rust/cargo-odra) is NOT included here —
# contracts must be built locally and deployed manually (see DEPLOYMENT.md §5).
#
# Build args:
#   SERVICE  — which service to bake into this image:
#              oracle | agent | mcp-server | dashboard
#
# Usage:
#   docker build --build-arg SERVICE=oracle -t aegis-oracle .
#   docker build --build-arg SERVICE=agent -t aegis-agent .
#   docker build --build-arg SERVICE=mcp-server -t aegis-mcp .
#   docker build --build-arg SERVICE=dashboard -t aegis-dashboard .
#
# In practice, use docker-compose.yml which sets SERVICE automatically.

ARG SERVICE=oracle

# ── Stage 1: dependencies ────────────────────────────────────────────────────
FROM node:22-slim AS deps

WORKDIR /app

# Enable corepack for pnpm
RUN corepack enable && corepack prepare pnpm@9.15.9 --activate

# Copy workspace manifests first (layer cache)
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY packages/shared/package.json ./packages/shared/
COPY packages/oracle/package.json ./packages/oracle/
COPY packages/agent/package.json ./packages/agent/
COPY packages/mcp-server/package.json ./packages/mcp-server/
COPY packages/dashboard/package.json ./packages/dashboard/

# Install all workspace dependencies (frozen lockfile)
RUN pnpm install --frozen-lockfile


# ── Stage 2: build ───────────────────────────────────────────────────────────
FROM deps AS builder

ARG SERVICE

# Copy full source
COPY tsconfig.base.json ./
COPY packages/shared ./packages/shared
COPY packages/oracle ./packages/oracle
COPY packages/agent ./packages/agent
COPY packages/mcp-server ./packages/mcp-server
COPY packages/dashboard ./packages/dashboard

# Build shared first (all other packages depend on it), then the target service
RUN pnpm --filter @aegis/shared build

RUN if [ "$SERVICE" = "oracle" ]; then \
      pnpm --filter @aegis/oracle build; \
    elif [ "$SERVICE" = "agent" ]; then \
      pnpm --filter @aegis/agent build; \
    elif [ "$SERVICE" = "mcp-server" ]; then \
      pnpm --filter @aegis/agent build && pnpm --filter @aegis/mcp-server build; \
    elif [ "$SERVICE" = "dashboard" ]; then \
      pnpm --filter @aegis/dashboard build; \
    else \
      echo "Unknown SERVICE: $SERVICE" && exit 1; \
    fi


# ── Stage 3: runtime ─────────────────────────────────────────────────────────
FROM node:22-slim AS runtime

ARG SERVICE
ENV SERVICE=$SERVICE
ENV NODE_ENV=production

WORKDIR /app

RUN corepack enable && corepack prepare pnpm@9.15.9 --activate

# Copy workspace root manifests
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./

# Copy only the packages needed for this service at runtime
COPY packages/shared/package.json ./packages/shared/
COPY --from=builder /app/packages/shared/dist ./packages/shared/dist

COPY packages/${SERVICE}/package.json ./packages/${SERVICE}/
COPY --from=builder /app/packages/${SERVICE}/dist ./packages/${SERVICE}/dist

# mcp-server depends on agent at runtime
RUN if [ "$SERVICE" = "mcp-server" ]; then \
      mkdir -p ./packages/agent; \
    fi
COPY packages/agent/package.json ./packages/agent/ 2>/dev/null || true
COPY --from=builder /app/packages/agent/dist ./packages/agent/dist 2>/dev/null || true

# Install production dependencies only
RUN pnpm install --frozen-lockfile --prod

# Create logs directory with appropriate permissions
RUN mkdir -p /app/logs && chown node:node /app/logs

# Dashboard: include .next build output
COPY --from=builder /app/packages/dashboard/.next ./packages/dashboard/.next 2>/dev/null || true
COPY --from=builder /app/packages/dashboard/public ./packages/dashboard/public 2>/dev/null || true

# Run as non-root
USER node

# Expose ports based on service
EXPOSE 4021
EXPOSE 3000
EXPOSE 4022

# Health check varies by service
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD if [ "$SERVICE" = "oracle" ]; then \
        wget -qO- http://localhost:4021/api/health || exit 1; \
      elif [ "$SERVICE" = "dashboard" ]; then \
        wget -qO- http://localhost:3000/ || exit 1; \
      else \
        exit 0; \
      fi

CMD if [ "$SERVICE" = "oracle" ]; then \
      node packages/oracle/dist/server.js; \
    elif [ "$SERVICE" = "agent" ]; then \
      node packages/agent/dist/run.js; \
    elif [ "$SERVICE" = "mcp-server" ]; then \
      node packages/mcp-server/dist/server.js; \
    elif [ "$SERVICE" = "dashboard" ]; then \
      node packages/dashboard/node_modules/.bin/next start --dir packages/dashboard; \
    else \
      echo "Unknown SERVICE: $SERVICE" && exit 1; \
    fi
