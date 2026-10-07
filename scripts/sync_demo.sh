#!/usr/bin/env bash
# Refresh the vendored copies behind the GitHub Pages live demo (docs/demo/).
# The demo runs the REAL engine + renderer client-side, so after changing
# sim/, app/js or app/css, re-run this to keep the published demo in sync.
set -euo pipefail
cd "$(dirname "$0")/.."

mkdir -p docs/demo/circuits
cp sim/engine.js sim/devices.js docs/demo/
cp app/js/render.js app/js/symbols.js docs/demo/
cp app/css/app.css docs/demo/
cp build/icon.svg docs/demo/
cp circuits/*.json docs/demo/circuits/

# render.js imports the device registry by absolute app path (/sim/devices.js);
# the Pages site lives under a repo subpath, so make the copy relative.
sed -i "s#from '/sim/devices.js'#from './devices.js'#" docs/demo/render.js

echo "docs/demo refreshed: engine, devices, render, symbols, app.css, icon, $(ls circuits/*.json | wc -l) circuits"
