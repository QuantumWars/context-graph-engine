#!/usr/bin/env bash
# Build a .dmg from the packaged .app.
#
# `hdiutil` ships with macOS, so the disk image costs no dependency — DEC-021 rejected
# electron-builder for exactly that reason. `electron-packager` produces the .app; this wraps it.
set -euo pipefail

here="$(cd "$(dirname "$0")/.." && pwd)"
app="$here/dist/Context Graph-darwin-arm64/Context Graph.app"
out="$here/dist/Context Graph.dmg"

[ -d "$app" ] || { echo "no .app at $app — run 'bun run pack' first" >&2; exit 2; }

staging="$(mktemp -d)"
cp -R "$app" "$staging/"
ln -s /Applications "$staging/Applications"     # the drag-to-install affordance

rm -f "$out"
hdiutil create -volname "Context Graph" -srcfolder "$staging" -ov -format UDZO "$out" >/dev/null
rm -rf "$staging"

echo "built $out"
ls -lh "$out" | awk '{print "  size:", $5}'
