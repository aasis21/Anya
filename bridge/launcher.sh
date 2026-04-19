#!/usr/bin/env bash
# POSIX wrapper used as the Native Messaging host's `path` on macOS/Linux.
# Mirrors launcher.cmd: cd to the bridge directory, exec node on dist/host.js.
set -e
BRIDGE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)"
cd "$BRIDGE_DIR"
exec node "$BRIDGE_DIR/dist/host.js" "$@"
