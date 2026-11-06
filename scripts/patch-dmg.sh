#!/bin/zsh
# Post-process a tauri-built dmg: inject a visible install-guide file into
# the volume. The DMG window background comes from bundle config, but the
# bundler's Finder AppleScript silently no-ops on headless CI runners, so
# the text guide is the reliable, always-visible instruction.
#
# Usage: scripts/patch-dmg.sh [path/to/Paste_x.y.z_aarch64.dmg]
set -euo pipefail

DMG="${1:-src-tauri/target/aarch64-apple-darwin/release/bundle/dmg/Paste_0.7.0_aarch64.dmg}"
GUIDE="${2:-src-tauri/dmg-install-guide.txt}"
RW="${DMG%.dmg}-rw.dmg"
rm -f "$RW"

hdiutil convert "$DMG" -format UDRW -o "$RW"

MOUNT_OUTPUT=$(hdiutil attach "$RW" -readwrite -nobrowse)
# hdiutil output is TAB-separated; the mount point may itself contain spaces.
DEV=$(echo "$MOUNT_OUTPUT" | awk -F'\t' '/^\/dev\/disk[0-9]/{print $1; exit}')
MNT=$(echo "$MOUNT_OUTPUT" | awk -F'\t' '/\/Volumes\//{print $3; exit}')

if [[ -z "$DEV" || -z "$MNT" ]]; then
  echo "failed to resolve mount point" >&2
  exit 1
fi

cp "$GUIDE" "$MNT/! 请先阅读 - 安装指南.txt"

hdiutil detach "$DEV"
hdiutil convert "$RW" -format UDZO -o "$DMG"
rm -f "$RW"
echo "patched $DMG with the install guide"
