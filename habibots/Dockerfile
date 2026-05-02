# In-world bots for Neohabitat.

FROM node:20-bookworm-slim

# `run` uses `netcat -z` to wait for the elko/bridge host before launching
# any bot, so netcat-openbsd is a runtime dep, not just a build-time one.
RUN apt-get update \
 && apt-get install -y --no-install-recommends netcat-openbsd \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /habibots

# Install deps first so the npm layer is cached when only source changes.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# `supervisor` (the file-watcher, not the process manager) restarts each
# bot on source change. Pure-JS, installs cleanly on Node 20.
RUN npm install -g supervisor

COPY . .

# Compose overrides this with `entrypoint: ['/habibots/run']` and
# `command: ['hatchery', 'eliza', ...]`. Setting exec form here so direct
# `docker run` works the same way and signals propagate to PID 1.
ENTRYPOINT ["/habibots/run"]
