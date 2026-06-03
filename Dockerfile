# Neoclassical Habitat — elko server + pushserver.
#
# Single-stage on CentOS Stream 9 because the `run` script invokes
# `mvn package` at every container start (a holdover — see follow-up note
# at the bottom). Once that's fixed, this can become a multi-stage build
# with just a JRE in the runtime layer.
#
# The Habitat protocol bridge (bridge_v2) runs as a host systemd service
# (ansible/roles/bridge_host/) and is not part of this image.

FROM quay.io/centos/centos:stream9

# ── OS deps ──────────────────────────────────────────────────────────
# NodeSource sets up the dnf repo for Node 20.
RUN curl -fsSL https://rpm.nodesource.com/setup_20.x | bash -

RUN dnf -y install \
      --setopt=install_weak_deps=False \
      --setopt=tsflags=nodocs \
      cronie \
      git \
      java-21-openjdk \
      make \
      maven \
      nc \
      net-tools \
      nodejs \
      procps \
      vim \
      wget \
 && dnf clean all \
 && rm -rf /var/cache/dnf

# `supervisor` (the file-watcher) restarts node services on source changes
# in dev. Pure JS, no native deps.
RUN npm install -g supervisor

WORKDIR /neohabitat

# ── Dependency layers (cached when source-only changes happen) ───────
# Maven first: copy the POM and prime the local repo. The actual `mvn package`
# runs after source is in place.
COPY pom.xml ./
RUN mvn -B -q dependency:go-offline || true

# npm deps for the subdirs the runtime actually uses.
# (habibots/ has its own image; test/ is CI-only — neither installed here.)
COPY pushserver/package.json pushserver/package-lock.json pushserver/
RUN npm --prefix pushserver ci --omit=dev

COPY db/package.json db/package-lock.json db/
RUN npm --prefix db ci --omit=dev

# ── Source + final build ─────────────────────────────────────────────
COPY . .

# Build the elko jar.
RUN rm -rf lib && mvn -B -q clean package -DskipTests

# Log-tailer convenience: `docker exec ... habitail`.
RUN printf '#!/bin/bash\nexec tail -f /neohabitat/elko_server.log\n' > /usr/bin/habitail \
 && chmod +x /usr/bin/habitail

# Hall of Records refresh — runs every 5 minutes via cron inside the container
# (only when NEOHABITAT_SHOULD_ENABLE_CRON=true; the run script starts crond).
RUN printf '*/5 * * * * root /bin/bash -c "cd /neohabitat/db && NEOHABITAT_MONGO_HOST=neohabitatmongo:27017 make book" >> /var/log/hallofrecords.log\n' \
      > /etc/cron.d/hall-of-records

# ── Ports ────────────────────────────────────────────────────────────
# 1701 — pushserver HTTP (also reachable as host :80 in compose)
# 1986 — qlink TCP (bridge_v2 host service connects to elko via this)
# 1987 — pushserver SSE
# 2018 — elko admin
# 3000 — pushserver dev
# 5005 — JDWP debugger (when NEOHABITAT_SHOULD_ENABLE_DEBUGGER=true)
# 9000 — elko native (bridge_v2 host service connects to this)
EXPOSE 1701 1986 1987 2018 3000 5005 9000

ENTRYPOINT ["/neohabitat/run"]

# ── Follow-ups (out of scope for this Dockerfile) ────────────────────
# - The `run` script's `mvn package` at startup is redundant — we already
#   built the jar above. Once removed, this Dockerfile can become a
#   multi-stage build with `eclipse-temurin:21-jre` (or similar) for the
#   runtime layer, dropping ~600MB of mvn + JDK from the final image.
