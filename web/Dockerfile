# Browser client of Ovrilo (ADR-0019): the desktop app's React UI, served as static files.
# Build from the repository root:
#   docker build -f web/Dockerfile \
#     --build-arg OVRILO_API_URL=https://api.example.com \
#     --build-arg OVRILO_MEDIA_URL=https://media.example.com \
#     --build-arg OVRILO_VOICE_URL=wss://voice.example.com .
FROM node:22-alpine AS build
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY . .
ARG OVRILO_API_URL
ARG OVRILO_MEDIA_URL
ARG OVRILO_VOICE_URL
RUN test -n "$OVRILO_API_URL" && test -n "$OVRILO_MEDIA_URL" && test -n "$OVRILO_VOICE_URL" \
    || { echo "Set the OVRILO_API_URL, OVRILO_MEDIA_URL and OVRILO_VOICE_URL build arguments." >&2; exit 1; }
RUN pnpm exec tsc && VITE_OVRILO_API_URL="$OVRILO_API_URL" pnpm exec vite build
RUN csp="$(node scripts/web-csp.mjs "$OVRILO_API_URL" "$OVRILO_MEDIA_URL" "$OVRILO_VOICE_URL")" \
    && sed "s|__CSP__|$csp|g" web/nginx.conf > /app/nginx.conf

FROM nginx:1.29-alpine
COPY --from=build /app/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
HEALTHCHECK --interval=30s --timeout=3s CMD wget -q -O /dev/null http://127.0.0.1/healthz || exit 1
