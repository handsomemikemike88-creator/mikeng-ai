# syntax=docker/dockerfile:1
# mikeng_course course site (public pages + admin/CRM backend). SQLite DB, uploads and outbox live on the /data volume.
FROM node:22-bookworm-slim AS deps
WORKDIR /app
# native build deps for better-sqlite3 / bcrypt (used only if no prebuilt binary matches)
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund

FROM node:22-bookworm-slim
ENV NODE_ENV=production PORT=3000 \
    APP_DB=/data/app.db UPLOAD_DIR=/data/uploads OUTBOX_FILE=/data/outbox.jsonl SUBMISSIONS_FILE=/data/submissions.json
RUN apt-get update && apt-get install -y --no-install-recommends tini wget && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY package.json server.js ./
COPY lib ./lib
COPY data ./data
COPY assets ./assets
COPY scripts ./scripts
RUN mkdir -p /data/uploads && chown -R node:node /data && chown -R node:node /app/data
USER node
VOLUME ["/data"]
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 CMD wget -qO- http://127.0.0.1:3000/ >/dev/null || exit 1
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "server.js"]
