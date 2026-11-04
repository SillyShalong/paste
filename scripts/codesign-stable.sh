#!/bin/zsh
# Re-sign the built Paste.app with a stable designated requirement.
#
# Tauri's default ad-hoc signature binds the accessibility (TCC) grant to
# the exact binary cdhash, so every rebuild silently loses the user's
# "Privacy & Security → Accessibility" approval. Signing with a
# requirement keyed to the bundle identifier keeps the grant valid across
# rebuilds and app updates.
#
# Usage: scripts/codesign-stable.sh [path/to/Paste.app]
set -euo pipefail

APP="${1:-src-tauri/target/aarch64-apple-darwin/release/bundle/macos/Paste.app}"
BUNDLE_ID="com.pasteclone.app"

codesign --force --sign - \
  --requirements "=designated => identifier \"$BUNDLE_ID\"" \
  "$APP"

codesign --verify "$APP"
echo "signed $APP with identifier-based requirement ($BUNDLE_ID)"
