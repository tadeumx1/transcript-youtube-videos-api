# syntax=docker/dockerfile:1

FROM node:22-bookworm-slim AS build

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json tsconfig.build.json biome.json vitest.config.ts ./
COPY src ./src
RUN npm run build

FROM node:22-bookworm-slim AS runtime

ARG YT_DLP_VERSION=2026.8.19

RUN apt-get update \
  && apt-get install --yes --no-install-recommends ca-certificates ffmpeg python3 python3-pip \
  && python3 -m pip install --break-system-packages --no-cache-dir "yt-dlp[default]==${YT_DLP_VERSION}" \
  && apt-get clean \
  && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production \
  HOST=0.0.0.0 \
  PORT=3000

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts \
  && npm cache clean --force
COPY --from=build /app/dist ./dist

USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:3000/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"]

CMD ["node", "dist/server.js"]
