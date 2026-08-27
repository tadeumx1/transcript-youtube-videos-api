# syntax=docker/dockerfile:1

FROM node:22-bookworm-slim AS build

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json tsconfig.build.json biome.json vitest.config.ts ./
COPY src ./src
RUN npm run build

FROM build AS rag-model

ENV RAG_MODEL_ROOT=/app/models

COPY scripts/fetch-rag-model.mjs ./scripts/fetch-rag-model.mjs
RUN npm run rag:model:fetch \
  && chmod -R a+rX /app/models

FROM node:22-bookworm-slim AS runtime-base

ARG YT_DLP_VERSION=2026.8.19

RUN apt-get update \
  && apt-get install --yes --no-install-recommends ca-certificates ffmpeg gosu python3 python3-pip \
  && python3 -m pip install --break-system-packages --no-cache-dir "yt-dlp[default]==${YT_DLP_VERSION}" \
  && apt-get clean \
  && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production \
  HOST=0.0.0.0 \
  PORT=3000 \
  RAG_DATA_ROOT=/data/lancedb \
  RAG_MODEL_ROOT=/app/models

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts \
  && rm -rf \
    node_modules/onnxruntime-node/bin/napi-v6/darwin \
    node_modules/onnxruntime-node/bin/napi-v6/win32 \
    node_modules/onnxruntime-node/bin/napi-v6/linux/arm64 \
  && test -f node_modules/onnxruntime-node/bin/napi-v6/linux/x64/onnxruntime_binding.node \
  && node --input-type=module -e "import('onnxruntime-node').then(() => process.stdout.write('ORT_LINUX_X64_OK\\n'))" \
  && npm cache clean --force
COPY --from=build /app/dist ./dist
COPY --from=rag-model /app/models /app/models
COPY scripts/rag-container-smoke.mjs ./scripts/rag-container-smoke.mjs
COPY --chmod=755 docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh

RUN mkdir -p /data \
  && chown node:node /data

EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD ["node", "-e", "const port=process.env.PORT??'3000';fetch(`http://127.0.0.1:${port}/health`).then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"]

ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
CMD ["node", "dist/server.js"]

FROM runtime-base AS runtime
