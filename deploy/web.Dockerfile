# The web server: the wizard's client edition, built from this repo, served
# by Caddy (HTTPS from Let's Encrypt, the team login, /api to the API).
FROM node:22-alpine AS build
WORKDIR /src
COPY . .
RUN node scripts/build.mjs --client --out /site

FROM caddy:2-alpine
COPY --from=build /site /srv
COPY deploy/Caddyfile /etc/caddy/Caddyfile
