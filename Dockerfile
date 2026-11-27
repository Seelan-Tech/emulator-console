# The JavaScript build is platform independent, so it always runs on the builder's own architecture
# (no QEMU); only the small runtime stage is built per target architecture.
FROM --platform=$BUILDPLATFORM node:24-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM --platform=$BUILDPLATFORM node:24-slim AS build
WORKDIR /app
COPY --from=deps /app/node_modules node_modules
COPY . .
# Which commit this is, and whether it is the tagged release: shown in the About dialog (see next.config.ts).
ARG GIT_SHA=""
ARG RELEASE_BUILD=""
ENV GIT_SHA=$GIT_SHA RELEASE_BUILD=$RELEASE_BUILD
RUN npm run build

FROM node:24-slim
LABEL org.opencontainers.image.source="https://github.com/Seelan-Tech/emulator-console" \
      org.opencontainers.image.description="A local web console for use with the AWS Emulator" \
      org.opencontainers.image.licenses="MIT"
WORKDIR /app
# Debian has fixed CVE-2025-6020 (linux-pam) in 1.5.2-6+deb12u3, but node:24-slim has not been rebuilt with it, and the
# image scan fails on it. Delete this layer once `docker run --rm node:24-slim dpkg -l libpam0g` shows that version or newer
# (`scripts/check-base-image.sh` checks that; the daily "Base image watch" workflow opens an issue when it is true).
# On a network that cannot reach the Debian mirrors the upgrade is skipped (a local build still works; the image scan in
# CI is what checks that it took effect), and the short timeout keeps that from stalling the build.
RUN apt-get -o Acquire::http::Timeout=15 -o Acquire::Retries=1 update \
 && apt-get install -y --no-install-recommends --only-upgrade libpam-modules libpam-modules-bin libpam-runtime libpam0g \
 && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production PORT=3000 HOSTNAME=0.0.0.0
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
COPY --from=build /app/public ./public
# The console applies db/migrations itself when it first opens its SQLite database.
COPY --from=build /app/db ./db
COPY --from=build /app/LICENSE /app/THIRD_PARTY_NOTICES.md ./
# next traces an optional image-optimisation binary for the build machine; the app does not use it.
RUN rm -rf /app/node_modules/@img
# Nothing at runtime needs npm or corepack, so ship neither: less to patch and to scan.
RUN rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack \
    /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack
# The SQLite database lives in /data; mount a volume there to keep it. Created here so a new volume is writable.
RUN mkdir /data && chown node:node /data
ENV DATA_DIR=/data
USER node
VOLUME /data
EXPOSE 3000
# The slim image has no curl: use Node itself. An unusable database makes /api/health answer 503.
HEALTHCHECK --interval=10s --timeout=3s --start-period=20s --retries=5 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/health').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"
CMD ["node", "server.js"]
