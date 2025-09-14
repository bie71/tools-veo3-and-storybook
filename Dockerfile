# Multi-stage build for Vite React app

# 1) Builder: install deps and build static assets
FROM node:20-alpine AS builder
WORKDIR /app

# Install dependencies first for better layer caching
COPY package*.json ./
RUN npm ci

# Copy static assets explicitly to ensure they're included in the build
COPY public ./public

# Copy the rest of the source and build
COPY . .
RUN npm run build

# 2) Runtime: serve static files with Nginx
FROM nginx:1.27-alpine AS runner

# Copy custom nginx config (SPA fallback)
COPY nginx.conf /etc/nginx/conf.d/default.conf

# Copy built assets
COPY --from=builder /app/dist /usr/share/nginx/html

EXPOSE 80
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://localhost/ || exit 1

CMD ["nginx", "-g", "daemon off;"]
