# ---- Build stage ----------------------------------------------------------
# Node 24 on Alpine, matching the version CI and the workflows use.
FROM node:24-alpine AS build

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
