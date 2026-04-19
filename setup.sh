#!/usr/bin/env bash
# setup.sh — one-shot setup for Anya — GitHub Copilot for your browser.
#
# Bash equivalent of setup.ps1. Installs deps + builds both projects, runs
# the bridge ping smoke test, and registers the Native Messaging host for
# every detected Chromium browser (Edge, Chrome, Chromium, Brave, Vivaldi,
# plus Arc on Windows + macOS).
#
# Supports macOS, Linux, and Windows (Git Bash, MSYS2, Cygwin).
#
# WSL note: inside WSL2, `uname -s` returns "Linux" so this script will
# operate on the WSL Linux side. To install for Windows-host browsers
# from WSL, run setup.ps1 via cmd.exe interop or pwsh.exe instead.
#
# Usage:
#   ./setup.sh [--browsers edge,chrome,...] [--quiet] [--skip-test] [--uninstall]

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)"
cd "$ROOT"

case "$(uname -s)" in
    Darwin)               OS="darwin";  OS_LABEL="macOS"   ;;
    Linux)                OS="linux";   OS_LABEL="Linux"   ;;
    MINGW*|MSYS*|CYGWIN*) OS="windows"; OS_LABEL="Windows" ;;
    *)
        echo "[error] setup.sh: unsupported OS '$(uname -s)'." >&2
        echo "        Supported: macOS, Linux, Windows (Git Bash / MSYS2 / Cygwin)." >&2
        exit 1
        ;;
esac

# --- Args -----------------------------------------------------------------
BROWSERS_ARG="all"
QUIET=0
SKIP_TEST=0
UNINSTALL=0
while [ $# -gt 0 ]; do
    case "$1" in
        --browsers) BROWSERS_ARG="${2:-all}"; shift 2 ;;
        --browsers=*) BROWSERS_ARG="${1#*=}"; shift ;;
        --quiet)     QUIET=1; shift ;;
        --skip-test) SKIP_TEST=1; shift ;;
        --uninstall) UNINSTALL=1; shift ;;
        -h|--help)
            sed -n '2,18p' "$0" | sed 's/^# *//'
            exit 0
            ;;
        *) echo "[error] Unknown arg: $1" >&2; exit 1 ;;
    esac
done

step() { printf '\n=== %s ===\n' "$1"; }
ok()   { printf '  OK  %s\n' "$1"; }
info() { printf '      %s\n' "$1"; }

# Mirrors bridge/src/paths.ts so we can show the right log path in the summary.
data_dir() {
    case "$OS" in
        darwin) echo "$HOME/Library/Application Support/Anya" ;;
        linux)
            if [ -n "${XDG_DATA_HOME:-}" ]; then
                echo "$XDG_DATA_HOME/Anya"
            else
                echo "$HOME/.local/share/Anya"
            fi
            ;;
        windows)
            local lad="${LOCALAPPDATA:-}"
            if [ -z "$lad" ]; then
                echo "%LOCALAPPDATA%\\Anya"
                return
            fi
            if command -v cygpath >/dev/null 2>&1; then
                cygpath -w "$(cygpath -u "$lad")/Anya"
            else
                echo "$lad\\Anya"
            fi
            ;;
    esac
}

if [ "$UNINSTALL" -eq 1 ]; then
    step 'Uninstalling Anya bridge'
    ( cd "$ROOT/bridge" && bash ./uninstall.sh )
    ok 'Bridge unregistered. Remove the unpacked extension manually from your browser.'
    exit 0
fi

# --- 0. Prereq check -----------------------------------------------------
step 'Checking prerequisites'
if ! command -v node >/dev/null 2>&1; then
    echo '[error] Node.js not found on PATH. Install Node 20+.' >&2
    exit 1
fi
NODE_VER="$(node --version)"
NODE_MAJOR="$(echo "${NODE_VER#v}" | cut -d. -f1)"
if [ "$NODE_MAJOR" -lt 20 ]; then
    echo "[error] Node $NODE_VER is too old; need >= 20." >&2
    exit 1
fi
ok "Node $NODE_VER"
command -v npm >/dev/null 2>&1 || { echo '[error] npm not found on PATH.' >&2; exit 1; }
ok 'npm available'
ok "Detected OS: $OS_LABEL"

if [ "$OS" = "windows" ]; then
    if ! command -v reg.exe >/dev/null 2>&1 && ! command -v reg >/dev/null 2>&1; then
        echo '[error] reg.exe not found on PATH. Run from Git Bash, MSYS2, or Cygwin so Windows reg.exe is reachable.' >&2
        exit 1
    fi
fi

# --- 1. Bridge -----------------------------------------------------------
step 'Building bridge'
(
    cd "$ROOT/bridge"
    if [ ! -d node_modules ]; then
        info 'npm install (bridge)...'
        npm install --no-audit --no-fund
    fi
    npm run build
)
ok 'bridge built -> bridge/dist/host.js'

if [ "$SKIP_TEST" -eq 0 ]; then
    info 'Running ping/pong smoke test...'
    ( cd "$ROOT/bridge" && npm test )
    ok 'bridge ping/pong verified'
fi

step "Registering bridge with Chromium browsers"
INSTALL_ARGS=("--browsers" "$BROWSERS_ARG")
[ "$QUIET" -eq 1 ] && INSTALL_ARGS+=("--quiet")
( cd "$ROOT/bridge" && bash ./install.sh "${INSTALL_ARGS[@]}" )
ok 'bridge registered as com.anya.bridge'

# --- 2. Extension --------------------------------------------------------
step 'Building extension'
(
    cd "$ROOT/extension"
    if [ ! -d node_modules ]; then
        info 'npm install (extension)...'
        npm install --no-audit --no-fund
    fi
    npm run build
)
ok 'extension built -> extension/dist/'

# --- 3. Done -------------------------------------------------------------
EXT_ID=""
if [ -f "$ROOT/.extension-id.txt" ]; then
    EXT_ID="$(tr -d '[:space:]' < "$ROOT/.extension-id.txt")"
fi
DIST_PATH="$ROOT/extension/dist"
LOG_PATH="$(data_dir)/bridge.log"

echo
echo '========================================================='
echo ' Anya — github copilot for your browser. ready.'
echo '========================================================='
echo
echo ' Load the unpacked extension (one-time, in each browser):'
echo '   Edge      ->  edge://extensions'
echo '   Chrome    ->  chrome://extensions'
echo '   Brave     ->  brave://extensions'
echo '   Vivaldi   ->  vivaldi://extensions'
echo '   Chromium  ->  chrome://extensions'
if [ "$OS" = "darwin" ] || [ "$OS" = "windows" ]; then
    echo '   Arc       ->  arc://extensions'
fi
echo
echo '   1. Toggle  Developer mode  (top-right or bottom-left)'
echo "   2. Click  Load unpacked  ->  $DIST_PATH"
if [ -n "$EXT_ID" ]; then
    echo "   3. Confirm extension ID = $EXT_ID"
fi
echo '   4. Pin the action icon, click it -> sidebar opens'
echo
echo ' Smoke test in the sidebar:'
echo '   - Type  ping   -> should echo PONG  (bridge handshake)'
echo '   - Type a real prompt -> should stream Copilot output'
echo
echo " Logs:        $LOG_PATH"
echo ' Uninstall:   ./setup.sh --uninstall'
echo
