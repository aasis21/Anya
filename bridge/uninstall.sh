#!/usr/bin/env bash
# uninstall.sh — remove the Anya Native Messaging host registration on
# macOS / Linux / Windows (Git Bash, MSYS2, Cygwin). Mirrors uninstall.ps1.
#

#
# The bridge source folder, logs, and chat data are not touched.

set -euo pipefail

case "$(uname -s)" in
    Darwin)               OS="darwin"  ;;
    Linux)                OS="linux"   ;;
    MINGW*|MSYS*|CYGWIN*) OS="windows" ;;
    *)
        echo "[error] uninstall.sh: unsupported OS '$(uname -s)'." >&2
        exit 1
        ;;
esac

HOSTS=("com.anya.bridge")

if [ "$OS" = "windows" ]; then
    if ! command -v reg.exe >/dev/null 2>&1 && ! command -v reg >/dev/null 2>&1; then
        echo "[error] reg.exe not found on PATH. This script requires Windows reg.exe." >&2
        exit 1
    fi
    REG_CMD="reg.exe"
    command -v reg.exe >/dev/null 2>&1 || REG_CMD="reg"

    REG_ROOTS=(
        'HKCU\Software\Microsoft\Edge\NativeMessagingHosts'
        'HKCU\Software\Google\Chrome\NativeMessagingHosts'
        'HKCU\Software\Chromium\NativeMessagingHosts'
        'HKCU\Software\BraveSoftware\Brave-Browser\NativeMessagingHosts'
        'HKCU\Software\Vivaldi\NativeMessagingHosts'
        'HKCU\Software\TheBrowserCompany\Arc\NativeMessagingHosts'
    )
    for root in "${REG_ROOTS[@]}"; do
        for h in "${HOSTS[@]}"; do
            key="$root\\$h"
            # `reg query` returns nonzero if the key is absent. `set -e` would
            # abort the script there, so guard with `if`. MSYS_NO_PATHCONV=1
            # stops Git Bash from rewriting HKCU\... as a unix path.
            if MSYS_NO_PATHCONV=1 "$REG_CMD" query "$key" >/dev/null 2>&1; then
                MSYS_NO_PATHCONV=1 "$REG_CMD" delete "$key" /f >/dev/null
                echo "[OK]  Removed: $key"
            fi
        done
    done

    # Remove the shared manifest file under %LOCALAPPDATA%\Anya\.
    if [ -n "${LOCALAPPDATA:-}" ]; then
        if command -v cygpath >/dev/null 2>&1; then
            data_unix="$(cygpath -u "$LOCALAPPDATA")/Anya"
        else
            # Fallback assumes /c/Users/...
            data_unix="${LOCALAPPDATA//\\//}"
            data_unix="/${data_unix:0:1}${data_unix:2}/Anya"
        fi
        for h in "${HOSTS[@]}"; do
            mf="$data_unix/$h.json"
            if [ -f "$mf" ]; then
                rm -f "$mf"
                echo "[OK]  Removed manifest: $mf"
            fi
        done
    fi
elif [ "$OS" = "darwin" ]; then
    BASE="$HOME/Library/Application Support"
    DIRS=(
        "$BASE/Microsoft Edge/NativeMessagingHosts"
        "$BASE/Google/Chrome/NativeMessagingHosts"
        "$BASE/Chromium/NativeMessagingHosts"
        "$BASE/BraveSoftware/Brave-Browser/NativeMessagingHosts"
        "$BASE/Vivaldi/NativeMessagingHosts"
        "$BASE/Arc/User Data/NativeMessagingHosts"
    )
    for dir in "${DIRS[@]}"; do
        for h in "${HOSTS[@]}"; do
            mf="$dir/$h.json"
            if [ -f "$mf" ]; then
                rm -f "$mf"
                echo "[OK]  Removed manifest: $mf"
            fi
        done
    done
else
    BASE="$HOME/.config"
    DIRS=(
        "$BASE/microsoft-edge/NativeMessagingHosts"
        "$BASE/google-chrome/NativeMessagingHosts"
        "$BASE/chromium/NativeMessagingHosts"
        "$BASE/BraveSoftware/Brave-Browser/NativeMessagingHosts"
        "$BASE/vivaldi/NativeMessagingHosts"
    )
    for dir in "${DIRS[@]}"; do
        for h in "${HOSTS[@]}"; do
            mf="$dir/$h.json"
            if [ -f "$mf" ]; then
                rm -f "$mf"
                echo "[OK]  Removed manifest: $mf"
            fi
        done
    done
fi

echo
echo "Anya bridge unregistered from all detected Chromium browsers."
echo "The bridge source folder, logs, and chat data were not touched."
