#!/usr/bin/env bash
# scripts/build-offline-bundle.sh — assemble the self-contained web bundle that
# runs VoltLab without server.js: the editor + the in-page engine (local mode).
# Layout mirrors the server root so absolute paths (/js/main.js, /sim/…,
# /circuits/…) resolve identically. This same tree becomes the Capacitor www/.
#
# Usage: scripts/build-offline-bundle.sh [output-dir]   (default dist/offline)
set -euo pipefail

REPO="$(cd "$(dirname "$0")/.." && pwd)"
OUT="${1:-$REPO/dist/offline}"

node "$REPO/scripts/gen-circuit-index.mjs"

rm -rf "$OUT"
mkdir -p "$OUT/sim" "$OUT/circuits"

# app shell (index.html, css/, js/, icon.svg)
cp -r "$REPO"/app/* "$OUT/"
rm -rf "$OUT"/.DS_Store

# browser-safe sim core (engine + devices + shared dispatcher; NOT sim/api.js,
# which imports node:fs — the offline host is app/js/local-api.js)
cp "$REPO"/sim/engine.js "$REPO"/sim/devices.js "$REPO"/sim/tools.js "$OUT/sim/"

# circuit library + manifest
cp "$REPO"/circuits/*.json "$OUT/circuits/"

echo "offline bundle → $OUT ($(du -sh "$OUT" | cut -f1))"
