# Local HAOS add-on: Telegram + OpenRouter capture service for Actual (Node/TS).
# Build context is addons/actual_capture/ (staged by scripts/deploy_addon.sh).
FROM node:22-slim

# @actual-app/api pulls better-sqlite3, whose prebuilt binary is fetched at
# install time. Build tools are a fallback in case a prebuild is unavailable.
RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Dependencies first (layer cache): only manifests.
COPY package.json package-lock.json ./
RUN npm ci

# Sources + build.
COPY tsconfig.json ./
COPY src/ ./src/
RUN npm run build

COPY run.sh /run.sh
RUN chmod +x /run.sh

CMD ["/run.sh"]
