#!/bin/sh
#
# Fixes ownership of the session directory, then drops to the unprivileged user.
#
# The worker caches its LinkedIn session under SCRAPER_SESSION_DIR so a restart
# does not force a fresh sign-in — a fresh sign-in is what triggers LinkedIn's
# verification challenges. Two things get in the way of writing it:
#
#   1. `mkdir` in the Dockerfile runs as root, so the directory is root-owned
#      at mode 755 and the pwuser process cannot create files in it.
#   2. A persistent disk mounted over /data (Render, Fly, `docker run -v`)
#      masks the image's directory entirely and arrives owned by root.
#
# Neither is fixable from inside a container that has already dropped to
# pwuser, so the image stays root just long enough to chown the directory and
# then hands off. The scrape itself never runs as root.

set -e

SESSION_DIR="${SCRAPER_SESSION_DIR:-/data/session}"

if [ "$(id -u)" = "0" ]; then
  mkdir -p "$SESSION_DIR"
  chown -R pwuser:pwuser "$SESSION_DIR"

  # setpriv is the clean handoff: it replaces this shell, so the worker keeps
  # PID 1 and receives SIGTERM directly. gosu and su are fallbacks for base
  # images that lack it.
  if command -v setpriv >/dev/null 2>&1; then
    exec setpriv --reuid=pwuser --regid=pwuser --init-groups "$@"
  elif command -v gosu >/dev/null 2>&1; then
    exec gosu pwuser "$@"
  else
    exec su -s /bin/sh pwuser -c 'exec "$0" "$@"' -- "$@"
  fi
fi

# Already unprivileged (docker-compose sets `user:`, or a host that pins one).
exec "$@"
