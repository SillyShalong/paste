#!/bin/zsh
# Post-process a tauri-built dmg: inject a visible install-guide file into
# the volume. The DMG window background comes from bundle config, but the
# bundler's Finder AppleScript silently no-ops on headless CI runners, so
# the text guide is the reliable, always-visible instruction.
#
# Uses an explicit -mountpoint temp dir: no hdiutil output parsing, no
# /Volumes name collisions, deterministic on headless CI.
#
# Usage: scripts/patch-dmg.sh [path/to/Paste_x.y.z_aarch64.dmg] [guide.txt]
set -euo pipefail

DMG="${1:?usage: patch-dmg.sh <dmg> [guide.txt]}"
GUIDE="${2:-src-tauri/dmg-install-guide.txt}"
WORK=$(mktemp -d)
RW="$WORK/patch-rw.dmg"

hdiutil convert "$DMG" -format UDRW -o "$RW"

MNT="$WORK/mnt"
mkdir -p "$MNT"
hdiutil attach "$RW" -readwrite -nobrowse -mountpoint "$MNT"

cp "$GUIDE" "$MNT/! 请先阅读 - 安装指南.txt"

# Re-sign the app INSIDE the dmg with the identifier-based requirement.
# Without this the dmg ships the bundler's ad-hoc (cdhash-bound) signature,
# and the TCC accessibility grant dies on every update. codesign is
# available on CI runners.
codesign --force --sign - \
  --requirements '=designated => identifier "com.pasteclone.app"' \
  "$MNT/Paste.app"

hdiutil detach "$MNT"

# hdiutil convert refuses to overwrite an existing -o target; write to a
# fresh temp name and move over the original.
FINAL="$WORK/final"
hdiutil convert "$RW" -format UDZO -o "$FINAL"
mv -f "$FINAL.dmg" "$DMG"

rm -rf "$WORK"
echo "patched $DMG with the install guide"
