#!/usr/bin/env bash
# POSIX wrapper used as the Native Messaging host's `path` on macOS/Linux.
# Mirrors launcher.cmd: cd to the bridge directory, exec node on dist/host.js.
#
# IMPORTANT (macOS): Chrome/Edge/Brave launch native-messaging hosts with a
# minimal environment — GUI apps do NOT inherit your login shell's PATH, so
# a bare `node` here often fails to resolve when Node was installed via
# nvm/volta/asdf/homebrew rather than the system installer (symptom: the
# extension shows "disconnected" even though `node` works fine from a
# terminal). To avoid re-guessing on every launch, install.sh/install.ps1
# write the exact `node` path they used at install time to `.node-path`
# next to this script; we prefer that, then fall back to a PATH search
# across common install locations, then bare `node` as a last resort.
set -e
BRIDGE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)"
cd "$BRIDGE_DIR"

NODE_BIN=""
if [ -f "$BRIDGE_DIR/.node-path" ]; then
    CACHED="$(cat "$BRIDGE_DIR/.node-path" 2>/dev/null || true)"
    if [ -n "$CACHED" ] && [ -x "$CACHED" ]; then
        NODE_BIN="$CACHED"
    fi
fi
if [ -z "$NODE_BIN" ]; then
    NODE_BIN="$(command -v node 2>/dev/null || true)"
fi
if [ -z "$NODE_BIN" ]; then
    for candidate in \
        /opt/homebrew/bin/node \
        /usr/local/bin/node \
        /usr/bin/node \
        "$HOME"/.volta/bin/node \
        "$HOME"/.asdf/shims/node \
        "$HOME"/.nvm/versions/node/*/bin/node
    do
        if [ -x "$candidate" ]; then NODE_BIN="$candidate"; break; fi
    done
fi
if [ -z "$NODE_BIN" ]; then
    echo "[anya-bridge] node not found (checked PATH, .node-path, and common install locations). Re-run setup.sh after installing Node, or add node to PATH." >&2
    exit 127
fi

exec "$NODE_BIN" "$BRIDGE_DIR/dist/host.js" "$@"
