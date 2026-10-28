# ============================================================================
# XIANGQI ENTERPRISE PLATFORM - PRODUCTION BACKEND DOCKERFILE
# ============================================================================

FROM node:20-alpine AS builder
WORKDIR /app

# Copy workspace manifests
COPY package.json tsconfig.base.json ./
COPY shared/package.json ./shared/
COPY server/package.json ./server/

RUN npm install

# Copy shared & server source code
COPY shared ./shared
COPY server ./server

# Build shared core engine, generate Prisma client, and compile server TypeScript
RUN npm --workspace=shared run build
RUN npx --workspace=server prisma generate
RUN npm --workspace=server run build

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production

COPY --from=builder /app/package.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/shared/package.json ./shared/
COPY --from=builder /app/shared/dist ./shared/dist
COPY --from=builder /app/server/package.json ./server/
COPY --from=builder /app/server/prisma ./server/prisma
COPY --from=builder /app/server/dist ./server/dist

WORKDIR /app/server
EXPOSE 4000

CMD ["sh", "-c", "npx prisma db push && node dist/index.js"]
