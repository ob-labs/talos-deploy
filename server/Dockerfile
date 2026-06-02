FROM node:20-bookworm AS builder
WORKDIR /app/server
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src/ ./src/
RUN npm run build

# Web dashboard build
WORKDIR /app/server/web
COPY web/package.json web/package-lock.json ./
RUN npm ci
COPY web/ ./
RUN npx vite build --outDir /app/server/dist/web

FROM node:20-bookworm-slim
WORKDIR /app/server
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY --from=builder /app/server/dist ./dist
RUN mkdir -p /app/data
ENV DB_PATH=/app/data/talos.db
EXPOSE 8080
CMD ["node", "dist/index.js"]
