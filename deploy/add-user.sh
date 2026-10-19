#!/bin/sh
# Add (or replace) a team login: deploy/add-user.sh <username>
# Prompts for the password, stores a bcrypt hash in deploy/users.caddy and,
# if the site is running, reloads Caddy.
set -eu
cd "$(dirname "$0")"
user="${1:-}"
case "$user" in
  ''|*[!A-Za-z0-9._-]*) echo "usage: $0 <username>  (letters, digits, . _ -)" >&2; exit 1 ;;
esac
stty -echo; printf 'Password for %s: ' "$user"; read -r pw; stty echo; echo
[ ${#pw} -ge 12 ] || { echo "Use at least 12 characters." >&2; exit 1; }
# The password goes in on stdin, not the command line.
hash=$(printf '%s\n' "$pw" | docker run --rm -i caddy:2-alpine caddy hash-password)
# Keep the other users; drop any earlier line for this one.
others=$( [ -f users.caddy ] && grep -E '^\s+[A-Za-z0-9._-]+ \$2' users.caddy | grep -vE "^\s+$user " || true )
{
  echo "basic_auth {"
  [ -n "$others" ] && echo "$others"
  printf '\t%s %s\n' "$user" "$hash"
  echo "}"
} > users.caddy.new
mv users.caddy.new users.caddy
chmod 600 users.caddy
echo "Saved $user in deploy/users.caddy."
if docker compose ps --status running web 2>/dev/null | grep -q web; then
  docker compose exec web caddy reload --config /etc/caddy/Caddyfile && echo "Caddy reloaded."
fi
