# syntax=docker/dockerfile:1
# 本番のイメージ（第16章、docs/architecture.md）。1 つの Dockerfile から 3 つを作る：
#   docker build --target web     -t flowdesk-web .     # Next.js（ECS の Web サービス）
#   docker build --target worker  -t flowdesk-worker .  # Worker（ECS の Worker サービス）
#   docker build --target migrate -t flowdesk-migrate . # prisma migrate deploy（デプロイ時に 1 回だけ実行するタスク）
#
# - web・worker には開発用の依存（prisma の CLI と、それが引き込む effect。
#   第14章の npm audit の指摘）を入れない。prisma の CLI は migrate だけが持つ
# - どれも非 root（node イメージの node ユーザー、UID 1000）で動かす
# - 秘密情報はイメージに入れない（.dockerignore で .env* を除く。実行時に
#   ECS が Secrets Manager から環境変数として渡す）

ARG NODE_IMAGE=node:24.13.0-bookworm-slim

# ---- 依存（開発用を含む）と Prisma Client の生成 -------------------------
FROM ${NODE_IMAGE} AS deps
WORKDIR /app
COPY package.json package-lock.json .npmrc ./
# postinstall（prisma generate）と prepare（git config）はここでは動かさない
RUN npm ci --ignore-scripts
COPY prisma ./prisma
COPY prisma7.config.ts ./
RUN npx prisma generate

# ---- ビルド ---------------------------------------------------------------
FROM deps AS build
COPY . .
# 環境変数（DATABASE_URL など）なしでビルドできる（第8章）。
# standalone は .next/standalone に実行に要るファイルだけを集める
ENV NEXT_TELEMETRY_DISABLED=1 NEXT_OUTPUT=standalone
RUN npm run build

# ---- 本番の依存だけ（Worker 用） -----------------------------------------
FROM ${NODE_IMAGE} AS prod-deps
WORKDIR /app
COPY package.json package-lock.json .npmrc ./
COPY docker/prune-dev-optional.mjs /tmp/
# prisma（CLI）は任意の peer 依存として --omit=dev でも入るので、
# lockfile で devOptional のものを消す。残っていたら失敗する
RUN npm ci --omit=dev --ignore-scripts \
  && node /tmp/prune-dev-optional.mjs \
  && npm cache clean --force

# ---- 実行用の土台：npm・yarn・corepack を外す（実行時に使わない） -------
FROM ${NODE_IMAGE} AS runtime
RUN rm -rf /usr/local/lib/node_modules /usr/local/bin/npm \
    /usr/local/bin/npx /usr/local/bin/corepack /usr/local/bin/yarn \
    /usr/local/bin/yarnpkg /opt/yarn-*
WORKDIR /app

# ---- Web（Next.js の standalone の server.js） ---------------------------
FROM runtime AS web
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 \
    HOSTNAME=0.0.0.0 PORT=3000
COPY --from=build --chown=root:root /app/.next/standalone ./
COPY --from=build --chown=root:root /app/.next/static ./.next/static
COPY --from=build --chown=root:root /app/public ./public
# アプリのファイルは root の持ち物のまま（実行ユーザーは書き換えられない）。
# 書き込むのは Next.js のキャッシュだけ。ECS ではルートを読み取り専用にし、
# ここにボリュームを付ける
RUN mkdir -p .next/cache && chown node:node .next/cache
USER node
EXPOSE 3000
# DB を使わない画面で確かめる（DB の障害でタスクを入れ替え続けない）
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:3000/login').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"]
CMD ["node", "server.js"]

# ---- Worker（tsx で src/worker/index.ts を動かす） -----------------------
FROM runtime AS worker
ENV NODE_ENV=production
COPY --from=prod-deps --chown=root:root /app/node_modules ./node_modules
COPY --chown=root:root package.json tsconfig.json ./
COPY --chown=root:root src/worker ./src/worker
COPY --chown=root:root src/server ./src/server
COPY --chown=root:root src/lib ./src/lib
COPY --from=deps --chown=root:root /app/src/generated ./src/generated
USER node
# tsx は変換の結果を os.tmpdir() に置く（ECS では /tmp にボリュームを付ける）
CMD ["node_modules/.bin/tsx", "src/worker/index.ts"]

# ---- マイグレーション（prisma migrate deploy） --------------------------
# 開発用の依存を含むが、常駐しない（デプロイのたびに 1 回だけ実行して終わる）
FROM deps AS migrate
ENV NODE_ENV=production
# Prisma の CLI（スキーマエンジン）は OpenSSL を探し、slim のイメージには
# ないので警告を出す。migrate だけに入れる（web・worker は使わない）。
# deps は --ignore-scripts なのでエンジンが取得されていない。OpenSSL を
# 入れた後に、ビルド時（root）に取得しておく（実行ユーザーは書き込めない）
RUN apt-get update && apt-get install -y --no-install-recommends openssl \
  && rm -rf /var/lib/apt/lists/* \
  && npm rebuild prisma @prisma/engines
ENV NPM_CONFIG_UPDATE_NOTIFIER=false
USER node
CMD ["npx", "--no-install", "prisma", "migrate", "deploy"]
