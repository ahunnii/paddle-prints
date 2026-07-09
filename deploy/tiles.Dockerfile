# Tiles server image: Caddy with the repo Caddyfile baked in. Built (rather than
# bind-mounting ./Caddyfile) because Coolify's compose runtime dir doesn't reliably
# contain repo files at container start, which breaks file bind mounts.
FROM caddy:2-alpine
COPY Caddyfile /etc/caddy/Caddyfile
