#!/usr/bin/env bash
# install.sh — One-line bootstrap installer for Anya.
#
# Clones (or updates) the Anya repo into $INSTALL_DIR, then runs setup.sh
# to build the bridge + extension and register the native-messaging host.
#
# Designed to be run with:
#   curl -fsSL https://raw.githubusercontent.com/aasis21/Anya/main/install.sh | bash
#
# Or with options:
#   curl -fsSL https://raw.githubusercontent.com/aasis21/Anya/main/install.sh | bash -s -- --branch dev --browsers edge,chrome
#
# Options:
#   --install-dir <path>   Where to clone the repo (default: $HOME/Anya)
#   --branch <name>        Git branch to check out (default: main)
#   --browsers <list>      Forwarded to setup.sh (default: all detected)

set -euo pipefail

INSTALL_DIR="${HOME}/Anya"
BRANCH="main"
BROWSERS="all"
REPO="https://github.com/aasis21/Anya.git"

while [[ $# -gt 0 ]]; do
    case "$1" in
        --install-dir) INSTALL_DIR="$2"; shift 2 ;;
        --branch)      BRANCH="$2";      shift 2 ;;
        --browsers)    BROWSERS="$2";    shift 2 ;;
        -h|--help)
            sed -n '2,18p' "$0" | sed 's/^# \{0,1\}//'
            exit 0 ;;
        *) echo "[error] unknown option: $1" >&2; exit 1 ;;
    esac
done

step() { printf "\n\033[36m=== %s ===\033[0m\n" "$1"; }
ok()   { printf "  \033[32mOK\033[0m  %s\n" "$1"; }

step "Checking prerequisites"
for cmd in git node npm bash; do
    command -v "$cmd" >/dev/null 2>&1 || { echo "[error] $cmd not found on PATH. Install it first." >&2; exit 1; }
    ok "$cmd available"
done

if [[ -d "${INSTALL_DIR}/.git" ]]; then
    step "Updating existing checkout at ${INSTALL_DIR}"
    git -C "$INSTALL_DIR" fetch --quiet origin
    git -C "$INSTALL_DIR" checkout --quiet "$BRANCH"
    git -C "$INSTALL_DIR" pull --ff-only --quiet origin "$BRANCH"
    ok "synced to origin/${BRANCH}"
else
    step "Cloning ${REPO} into ${INSTALL_DIR}"
    git clone --quiet --branch "$BRANCH" "$REPO" "$INSTALL_DIR"
    ok "cloned"
fi

step "Running setup.sh"
cd "$INSTALL_DIR"
chmod +x ./setup.sh 2>/dev/null || true
./setup.sh --browsers "$BROWSERS" --quiet
