#!/usr/bin/env bash
# install.sh — install the Anya Native Messaging host on macOS / Linux /
# Windows (Git Bash, MSYS2, Cygwin).
#
# Bash equivalent of install.ps1. Per-OS targets:
#
#   Windows  -> HKCU registry: HKCU\Software\<vendor>\<browser>\NativeMessagingHosts\com.anya.bridge
#               (manifest written once to %LOCALAPPDATA%\Anya\com.anya.bridge.json)
#   macOS    -> ~/Library/Application Support/<vendor>/<browser>/NativeMessagingHosts/com.anya.bridge.json
#   Linux    -> ~/.config/<vendor>/<browser>/NativeMessagingHosts/com.anya.bridge.json
#
# WSL note: inside WSL, `uname -s` returns "Linux", so this script will
# install for Linux Chromium browsers running INSIDE WSL. To install for
# Windows-host browsers from WSL, run setup.ps1 via cmd.exe interop or
# pwsh.exe.
#
# Usage:
#   ./install.sh [--browsers edge,chrome,...] [--quiet]
#
# Without --browsers (or with --browsers all) auto-detects every supported
# Chromium browser installed on the machine and registers for each.

set -euo pipefail

HOST_NAME="com.anya.bridge"
EXTENSION_ID="oopdnihjfloclgnbbkebgeiipfadebid"
BRIDGE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)"
TEMPLATE_PATH="$BRIDGE_DIR/manifest.template.json"
LAUNCHER_SH="$BRIDGE_DIR/launcher.sh"
LAUNCHER_CMD="$BRIDGE_DIR/launcher.cmd"

# --- OS detection ---------------------------------------------------------
case "$(uname -s)" in
    Darwin)               OS="darwin"  ;;
    Linux)                OS="linux"   ;;
    MINGW*|MSYS*|CYGWIN*) OS="windows" ;;
    *)
        echo "[error] install.sh: unsupported OS '$(uname -s)'." >&2
        echo "        Supported: macOS, Linux, Windows (Git Bash / MSYS2 / Cygwin)." >&2
        exit 1
        ;;
esac

# --- Path helpers (Windows) -----------------------------------------------
# Convert between unix-style (/c/Foo/Bar) and Windows-style (C:\Foo\Bar)
# paths. Prefer cygpath when available (Git Bash, Cygwin, MSYS2 all ship it).
to_winpath() {
    if command -v cygpath >/dev/null 2>&1; then
        cygpath -w "$1"
    else
        local p="$1"
        case "$p" in
            /[A-Za-z]/*)
                p="${p#/}"
                printf '%s:\\%s\n' "${p:0:1}" "${p:2}" | tr '/' '\\'
                ;;
            *) printf '%s\n' "$p" | tr '/' '\\' ;;
        esac
    fi
}

to_unixpath() {
    if command -v cygpath >/dev/null 2>&1; then
        cygpath -u "$1"
    else
        local p="${1//\\//}"
        case "$p" in
            [A-Za-z]:/*) printf '/%s%s\n' "$(echo "${p:0:1}" | tr 'A-Z' 'a-z')" "${p:2}" ;;
            *) printf '%s\n' "$p" ;;
        esac
    fi
}

# JSON-escape backslashes in a Windows path so it survives JSON encoding.
json_escape_winpath() {
    local p="$1"
    printf '%s' "${p//\\/\\\\}"
}

# --- Args -----------------------------------------------------------------
BROWSERS_ARG="all"
QUIET=0
while [ $# -gt 0 ]; do
    case "$1" in
        --browsers) BROWSERS_ARG="${2:-all}"; shift 2 ;;
        --browsers=*) BROWSERS_ARG="${1#*=}"; shift ;;
        --quiet) QUIET=1; shift ;;
        -h|--help)
            sed -n '2,20p' "$0" | sed 's/^# *//'
            exit 0
            ;;
        *) echo "[error] Unknown arg: $1" >&2; exit 1 ;;
    esac
done

# --- Browser catalog ------------------------------------------------------
# Parallel arrays. Index N across these arrays describes one browser.
BROWSER_IDS=(edge chrome chromium brave vivaldi arc)
BROWSER_NAMES=("Microsoft Edge" "Google Chrome" "Chromium" "Brave" "Vivaldi" "Arc")

manifest_dir_for() {
    # $1=browser_id $2=os  →  echo path to NativeMessagingHosts dir, or empty.
    # On Windows we don't drop per-browser files; instead the shared manifest
    # lives in ANYA_DATA_DIR (handled separately) and registry points at it.
    case "$2" in
        darwin)
            case "$1" in
                edge)     echo "$HOME/Library/Application Support/Microsoft Edge/NativeMessagingHosts" ;;
                chrome)   echo "$HOME/Library/Application Support/Google/Chrome/NativeMessagingHosts" ;;
                chromium) echo "$HOME/Library/Application Support/Chromium/NativeMessagingHosts" ;;
                brave)    echo "$HOME/Library/Application Support/BraveSoftware/Brave-Browser/NativeMessagingHosts" ;;
                vivaldi)  echo "$HOME/Library/Application Support/Vivaldi/NativeMessagingHosts" ;;
                arc)      echo "$HOME/Library/Application Support/Arc/User Data/NativeMessagingHosts" ;;
            esac
            ;;
        linux)
            case "$1" in
                edge)     echo "$HOME/.config/microsoft-edge/NativeMessagingHosts" ;;
                chrome)   echo "$HOME/.config/google-chrome/NativeMessagingHosts" ;;
                chromium) echo "$HOME/.config/chromium/NativeMessagingHosts" ;;
                brave)    echo "$HOME/.config/BraveSoftware/Brave-Browser/NativeMessagingHosts" ;;
                vivaldi)  echo "$HOME/.config/vivaldi/NativeMessagingHosts" ;;
                arc)      echo "" ;;  # No Arc on Linux
            esac
            ;;
        windows) echo "" ;;  # Not used on Windows; registry-based.
    esac
}

# Windows registry root for each browser (HKCU). Parallel to manifest_dir_for.
win_regroot_for() {
    case "$1" in
        edge)     echo 'HKCU\Software\Microsoft\Edge\NativeMessagingHosts' ;;
        chrome)   echo 'HKCU\Software\Google\Chrome\NativeMessagingHosts' ;;
        chromium) echo 'HKCU\Software\Chromium\NativeMessagingHosts' ;;
        brave)    echo 'HKCU\Software\BraveSoftware\Brave-Browser\NativeMessagingHosts' ;;
        vivaldi)  echo 'HKCU\Software\Vivaldi\NativeMessagingHosts' ;;
        arc)      echo 'HKCU\Software\TheBrowserCompany\Arc\NativeMessagingHosts' ;;
    esac
}

ext_url_for() {
    case "$1" in
        edge|brave|vivaldi|arc) echo "$1://extensions" ;;
        chrome|chromium)        echo "chrome://extensions" ;;
    esac
}

# Anya data dir (Windows) — mirrors bridge/src/paths.ts.
anya_data_dir_win() {
    local lad="${LOCALAPPDATA:-}"
    if [ -z "$lad" ]; then
        echo "[error] LOCALAPPDATA not set; cannot locate Anya data dir." >&2
        exit 1
    fi
    to_unixpath "$lad/Anya"
}

is_installed() {
    # $1=browser_id $2=os  →  exit 0 if browser appears installed, else 1.
    local b="$1" os="$2"
    case "$os" in
        darwin)
            case "$b" in
                edge)     [ -d "/Applications/Microsoft Edge.app" ]    || [ -d "$HOME/Applications/Microsoft Edge.app" ] && return 0 ;;
                chrome)   [ -d "/Applications/Google Chrome.app" ]      || [ -d "$HOME/Applications/Google Chrome.app" ] && return 0 ;;
                chromium) [ -d "/Applications/Chromium.app" ]           || [ -d "$HOME/Applications/Chromium.app" ] && return 0 ;;
                brave)    [ -d "/Applications/Brave Browser.app" ]      || [ -d "$HOME/Applications/Brave Browser.app" ] && return 0 ;;
                vivaldi)  [ -d "/Applications/Vivaldi.app" ]            || [ -d "$HOME/Applications/Vivaldi.app" ] && return 0 ;;
                arc)      [ -d "/Applications/Arc.app" ]                || [ -d "$HOME/Applications/Arc.app" ] && return 0 ;;
            esac
            local d
            d="$(manifest_dir_for "$b" "$os")"
            [ -n "$d" ] && [ -d "$(dirname "$d")" ]
            ;;
        linux)
            case "$b" in
                edge)     command -v microsoft-edge >/dev/null 2>&1 || command -v microsoft-edge-stable >/dev/null 2>&1 || command -v microsoft-edge-beta >/dev/null 2>&1 || command -v microsoft-edge-dev >/dev/null 2>&1 ;;
                chrome)   command -v google-chrome >/dev/null 2>&1 || command -v google-chrome-stable >/dev/null 2>&1 ;;
                chromium) command -v chromium >/dev/null 2>&1 || command -v chromium-browser >/dev/null 2>&1 ;;
                brave)    command -v brave-browser >/dev/null 2>&1 || command -v brave >/dev/null 2>&1 ;;
                vivaldi)  command -v vivaldi >/dev/null 2>&1 || command -v vivaldi-stable >/dev/null 2>&1 || command -v vivaldi-snapshot >/dev/null 2>&1 ;;
                arc)      return 1 ;;
            esac
            ;;
        windows)
            local pf="${PROGRAMFILES:-C:\\Program Files}"
            # ProgramFiles(x86) has parens, which bash can't reference via ${...}.
            # Use printenv when available; otherwise fall back to the standard path.
            local pf86=""
            if command -v printenv >/dev/null 2>&1; then
                pf86="$(printenv 'ProgramFiles(x86)' 2>/dev/null || true)"
            fi
            [ -z "$pf86" ] && pf86="C:\\Program Files (x86)"
            local lad="${LOCALAPPDATA:-}"
            local upf upf86 ulad
            upf="$(to_unixpath "$pf")"
            upf86="$(to_unixpath "$pf86")"
            [ -n "$lad" ] && ulad="$(to_unixpath "$lad")" || ulad=""
            case "$b" in
                edge)
                    [ -f "$upf/Microsoft/Edge/Application/msedge.exe" ] && return 0
                    [ -f "$upf86/Microsoft/Edge/Application/msedge.exe" ] && return 0
                    return 1
                    ;;
                chrome)
                    [ -f "$upf/Google/Chrome/Application/chrome.exe" ] && return 0
                    [ -f "$upf86/Google/Chrome/Application/chrome.exe" ] && return 0
                    [ -n "$ulad" ] && [ -f "$ulad/Google/Chrome/Application/chrome.exe" ] && return 0
                    return 1
                    ;;
                chromium)
                    [ -n "$ulad" ] && [ -f "$ulad/Chromium/Application/chrome.exe" ] && return 0
                    return 1
                    ;;
                brave)
                    [ -f "$upf/BraveSoftware/Brave-Browser/Application/brave.exe" ] && return 0
                    [ -f "$upf86/BraveSoftware/Brave-Browser/Application/brave.exe" ] && return 0
                    return 1
                    ;;
                vivaldi)
                    [ -n "$ulad" ] && [ -f "$ulad/Vivaldi/Application/vivaldi.exe" ] && return 0
                    [ -f "$upf/Vivaldi/Application/vivaldi.exe" ] && return 0
                    return 1
                    ;;
                arc)
                    [ -n "$ulad" ] && [ -f "$ulad/Programs/Arc/Arc.exe" ] && return 0
                    [ -f "$upf/Arc/Arc.exe" ] && return 0
                    return 1
                    ;;
            esac
            ;;
    esac
    return 1
}

# --- Sanity ---------------------------------------------------------------
[ -f "$TEMPLATE_PATH" ] || { echo "[error] manifest.template.json not found at $TEMPLATE_PATH" >&2; exit 1; }
if [ "$OS" = "windows" ]; then
    [ -f "$LAUNCHER_CMD" ] || { echo "[error] launcher.cmd not found at $LAUNCHER_CMD" >&2; exit 1; }
else
    [ -f "$LAUNCHER_SH" ] || { echo "[error] launcher.sh not found at $LAUNCHER_SH" >&2; exit 1; }
    chmod +x "$LAUNCHER_SH"
fi

# --- Resolve targets ------------------------------------------------------
TARGETS=()
TARGET_NAMES=()
if echo ",$BROWSERS_ARG," | grep -q ',all,' || [ -z "$BROWSERS_ARG" ]; then
    for i in "${!BROWSER_IDS[@]}"; do
        if is_installed "${BROWSER_IDS[$i]}" "$OS"; then
            TARGETS+=("${BROWSER_IDS[$i]}")
            TARGET_NAMES+=("${BROWSER_NAMES[$i]}")
        fi
    done
    if [ ${#TARGETS[@]} -eq 0 ]; then
        echo "[warn] No supported Chromium browser detected. Defaulting to chrome." >&2
        TARGETS=("chrome")
        TARGET_NAMES=("Google Chrome")
    fi
    if [ ${#TARGETS[@]} -gt 1 ] && [ "$QUIET" -eq 0 ] && [ -t 0 ]; then
        echo
        echo "Detected the following Chromium browsers:"
        for i in "${!TARGETS[@]}"; do
            printf "  [%d] %s\n" $((i + 1)) "${TARGET_NAMES[$i]}"
        done
        echo
        printf 'Install Anya for [a]ll detected, or pick numbers (e.g. 1,3) — Enter = all: '
        read -r ans
        if [ -n "$ans" ] && [ "$ans" != "a" ] && [ "$ans" != "A" ]; then
            PICKED=()
            PICKED_NAMES=()
            for tok in $(echo "$ans" | tr ',' ' '); do
                case "$tok" in
                    ''|*[!0-9]*) continue ;;
                esac
                idx=$((tok - 1))
                if [ "$idx" -ge 0 ] && [ "$idx" -lt "${#TARGETS[@]}" ]; then
                    PICKED+=("${TARGETS[$idx]}")
                    PICKED_NAMES+=("${TARGET_NAMES[$idx]}")
                fi
            done
            if [ ${#PICKED[@]} -gt 0 ]; then
                TARGETS=("${PICKED[@]}")
                TARGET_NAMES=("${PICKED_NAMES[@]}")
            fi
        fi
    fi
else
    for tok in $(echo "$BROWSERS_ARG" | tr ',' ' '); do
        found=0
        for i in "${!BROWSER_IDS[@]}"; do
            if [ "${BROWSER_IDS[$i]}" = "$tok" ]; then
                if [ "$OS" = "linux" ] && [ "$tok" = "arc" ]; then
                    echo "[error] Browser 'arc' is not supported on Linux." >&2
                    exit 1
                fi
                TARGETS+=("$tok")
                TARGET_NAMES+=("${BROWSER_NAMES[$i]}")
                found=1
                break
            fi
        done
        if [ "$found" -eq 0 ]; then
            echo "[error] Unknown browser '$tok'. Valid: edge, chrome, chromium, brave, vivaldi, arc, all." >&2
            exit 1
        fi
    done
fi

# --- Build manifest content ----------------------------------------------
# Bash's ${VAR/pat/rep} substitution mangles backslashes in the replacement
# string (each pass halves them), so for Windows we construct the JSON
# directly with a heredoc instead of doing template substitution.
TEMPLATE_CONTENT="$(cat "$TEMPLATE_PATH")"

if [ "$OS" = "windows" ]; then
    WIN_LAUNCHER="$(to_winpath "$LAUNCHER_CMD")"
    # Double every backslash for JSON. Done in a fresh local so the value
    # is never re-substituted (which would halve the backslashes again).
    JSON_LAUNCHER="${WIN_LAUNCHER//\\/\\\\}"
    MANIFEST_JSON="$(cat <<EOF
{
  "name": "$HOST_NAME",
  "description": "Anya bridge — connects the Anya browser sidebar to the Copilot SDK",
  "path": "$JSON_LAUNCHER",
  "type": "stdio",
  "allowed_origins": [
    "chrome-extension://$EXTENSION_ID/"
  ]
}
EOF
)"
else
    MANIFEST_JSON="${TEMPLATE_CONTENT//__LAUNCHER_PATH__/$LAUNCHER_SH}"
fi

# Optional JSON validity check via python if available.
if command -v python3 >/dev/null 2>&1; then
    printf '%s' "$MANIFEST_JSON" | python3 -c 'import json,sys; json.loads(sys.stdin.read())' \
        || { echo "[error] Generated manifest is not valid JSON" >&2; exit 1; }
fi

# --- Write manifest + register per browser -------------------------------
if [ "$OS" = "windows" ]; then
    # Single shared manifest in %LOCALAPPDATA%\Anya\.
    DATA_DIR="$(anya_data_dir_win)"
    mkdir -p "$DATA_DIR"
    MANIFEST_UNIX="$DATA_DIR/$HOST_NAME.json"
    printf '%s' "$MANIFEST_JSON" > "$MANIFEST_UNIX"
    MANIFEST_WIN="$(to_winpath "$MANIFEST_UNIX")"
    echo "[OK] Wrote shared manifest: $MANIFEST_WIN"

    if ! command -v reg.exe >/dev/null 2>&1 && ! command -v reg >/dev/null 2>&1; then
        echo "[error] reg.exe not found on PATH. This script requires Windows reg.exe." >&2
        exit 1
    fi
    REG_CMD="reg.exe"
    command -v reg.exe >/dev/null 2>&1 || REG_CMD="reg"

    for i in "${!TARGETS[@]}"; do
        b="${TARGETS[$i]}"
        name="${TARGET_NAMES[$i]}"
        regroot="$(win_regroot_for "$b")"
        regkey="$regroot\\$HOST_NAME"
        # MSYS_NO_PATHCONV=1 stops MSYS2/Git Bash from rewriting the
        # HKCU\... argument as if it were a unix path.
        # /ve = default value; /t REG_SZ; /d <data>; /f = no prompt.
        MSYS_NO_PATHCONV=1 "$REG_CMD" add "$regkey" /ve /t REG_SZ /d "$MANIFEST_WIN" /f >/dev/null
        printf '[OK] Registered for %-15s -> %s\n' "$name" "$regkey"
    done
else
    for i in "${!TARGETS[@]}"; do
        b="${TARGETS[$i]}"
        name="${TARGET_NAMES[$i]}"
        dir="$(manifest_dir_for "$b" "$OS")"
        if [ -z "$dir" ]; then
            echo "[skip] $name: no manifest dir for $OS"
            continue
        fi
        mkdir -p "$dir"
        out="$dir/$HOST_NAME.json"
        printf '%s' "$MANIFEST_JSON" > "$out"
        printf '[OK] Registered for %-15s -> %s\n' "$name" "$out"
    done
fi

# --- Summary -------------------------------------------------------------
echo
echo "=== Anya bridge installed ==="
echo "Host name             : $HOST_NAME"
echo "Extension ID (allowed): $EXTENSION_ID"
if [ "$OS" = "windows" ]; then
    echo "Launcher              : $(to_winpath "$LAUNCHER_CMD")"
else
    echo "Launcher              : $LAUNCHER_SH"
fi
echo
echo "Next steps — load the unpacked extension in each browser:"
for i in "${!TARGETS[@]}"; do
    printf '  %-16s open %s -> Developer mode -> Load unpacked -> ./extension/dist\n' \
        "${TARGET_NAMES[$i]}" "$(ext_url_for "${TARGETS[$i]}")"
done
echo "  Confirm extension ID matches: $EXTENSION_ID"
