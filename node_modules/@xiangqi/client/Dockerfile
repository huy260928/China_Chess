# ============================================================================
# XIANGQI ENTERPRISE PLATFORM - PRODUCTION FRONTEND DOCKERFILE (NGINX)
# ============================================================================

FROM node:20-alpine AS builder
WORKDIR /app

COPY package.json tsconfig.base.json ./
COPY shared/package.json ./shared/
COPY client/package.json ./client/

RUN npm install

COPY shared ./shared
COPY client ./client

RUN npm --workspace=shared run build
RUN npm --workspace=client run build

FROM nginx:1.27-alpine AS runner
COPY client/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=builder /app/client/dist /usr/share/nginx/html

EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
