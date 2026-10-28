# ---- Build stage ----------------------------------------------------------
# Node 24.22.1 on Alpine, matching .nvmrc and the version CI installs.
#
# The patch is pinned, not the major: CVE-2026-111497 (an out-of-bounds write in
# the Brotli decoder bundled with Node, reachable through whatever decompresses
# request bodies) was fixed in the 24.x line at 24.22.1, and a floating
# `node:24-alpine` tag would keep resolving to a vulnerable build until the tag
# moved. See the Node.js October 2026 security release.
FROM node:24.22.1-alpine AS build

WORKDIR /app

# Copy manifests first so dependency installation is cached across source edits.
COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build

# ---- Runtime stage --------------------------------------------------------
# The build output is static, so a tiny nginx image is all that is needed.
FROM nginx:1.29-alpine AS runtime

COPY docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -qO- http://127.0.0.1/ >/dev/null || exit 1
