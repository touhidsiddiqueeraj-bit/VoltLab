# Changelog

All notable changes to VoltLab are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/) and the project adheres to
[Semantic Versioning](https://semver.org/).

## [1.1.0] — 2026-10-25

### Fixed

- **Elevator hoist motors never reversed.** Both example elevators wired their
  "down" contactor straight through (L1→L1, L2→L2, L3→L3), so a down call spun
  the hoist motor in the *same* direction as an up call. The down contactors now
  swap L2/L3 (KM2 in `elevator-2floor`, KM_dn in `elevator-10floor`), matching
  the reversing starter: up runs forward, down runs reversed, verified by new
  engine tests asserting `state.dir === ±1`.
- **10-floor elevator direction contactors were decorative.** KM_up/KM_dn were
  tapped on the line side but their load terminals (T1/T2/T3) fed nothing — the
  motor was wired straight from KM_run and always spun one way, with the
  selectors only moving dead symbols. The power path is now
  X1–Q1–F1–KM_run–{KM_up | KM_dn}–KK1–M1, and both elevators gained a proper NC
  aux cross-interlock (each direction coil fed through the other contactor's
  21–22), so both can never energize together.
- **Solver now models sequential coil pickup.** Coils were evaluated against a
  frozen per-tick netlist, so two cross-interlocked contactors that saw voltage
  in the same tick would *both* energize (and oscillate) — real contactors
  can't, because whichever closes first opens the other's NC path. The engine
  now rebuilds the netlist mid-tick whenever a coil changes state, and later
  devices in the same tick see the updated circuit.
- **Drag-to-move never persisted.** The `moved` flag was set in an unreachable
  code branch, so `move_component` was never called — and 10 Hz SSE state
  snapshots snapped the component back mid-drag. Drags now track movement from
  a threshold, own the component position while active, and commit on release.
- **Clicks between a symbol's strokes fell through to the background.** The
  symbols are line art with large unpainted interiors, so pointer events
  between strokes hit the grid rect instead of the component. Every symbol now
  carries a transparent hit-rect over its full bounding box (pointer-events:
  all), making select/drag/hover reliable over the whole body.

### Added

- **A real logo.** A designed app icon (bolt over circuit traces on a dark
  rounded badge) replacing the bare emoji, shipped as `build/icon.svg`,
  `icon.png` (1024), `icon.ico` (7 sizes) and `icon.icns` (11 entries), used by
  the installer, window/taskbar, favicon, toolbar and the Pages landing page.
- **Release CI/CD.** `.github/workflows/release.yml` builds signed-off desktop
  binaries on tag push (or manual dispatch) with electron-builder — Windows NSIS
  installer + portable exe, macOS dmg for x64 + arm64, Linux AppImage + deb —
  and attaches them to a draft GitHub Release. `package.json` moved from
  electron-packager to electron-builder (`npm run dist`).
- **Component filter in the palette** — type-to-filter (by name or type), Esc
  clears.
- **Inspector circuit overview** — with nothing selected the inspector now
  shows live circuit stats (components, wires, sim time, motors running,
  active faults) instead of dead space.
- **Auto-fit on load** — loading a circuit fits it to the viewport (the
  10-floor elevator is finally visible in full on first load).
- **Empty-canvas welcome** — a centered logo + getting-started hint when the
  canvas is cleared.
- **Live counts in the status bar** (`13 comps · 31 wires`), symbol hover
  highlighting, terminal hover grow, themed slim scrollbars.
- **APK viability study** — `docs/apk.md`: the engine already runs fully
  client-side (the Pages demo proves it), so a demo APK is ~half a day via
  Capacitor and the full editor needs one client-side transport bridge.
- **First Android APK.** `VoltLab-1.1.0.apk` ships with the [v1.1.0 release](https://github.com/touhidsiddiqueeraj-bit/VoltLab/releases/tag/v1.1.0):
  the operator/demo tier in a Capacitor 7 shell — real engine + renderer fully
  offline, all five bundled circuits, run/pause/step and the live mimic panel.
  Release-signed, minSdk 23 (Android 6.0+), targetSdk 35, adaptive launcher
  icons generated from the app logo.

### Changed

- Regenerated the 10-floor elevator with the corrected power-path layout
  (KK1 and M1 moved after the direction contactors, CAM1 repositioned; also
  removed a dead `CAM1.GC` wire). 46 components, 174 wires.

- **Signed speed / direction rendering** (motor `state.dir`: +1 forward, −1 reverse,
  0 off; plugging through zero on a phase swap; `REVERSED` events in the log) — the
  foundation the elevator reversal fixes build on.

## [1.0.0] — 2026-10-07

First public release.

### Added

- **Simulation engine** (`sim/engine.js`): per-tick union-find netlist solver with phase
  propagation, 6× FLC inrush, class-10 thermal trip curve, single-phasing, coast-down and
  fuse blowing. Environment-agnostic — driven headlessly by `node --test`.
- **Device registry** (`sim/devices.js`): 16 device types — 3-phase supply, 1P/3P
  breakers, 1P/3P fuses, contactor (3 mains + NO/NC aux + coil), thermal overload
  (95-96 / 97-98 aux), 3~ motor, NO/NC push buttons, 2-pos selector, on-delay timer,
  lamps, buzzer, 10-position 3-deck floor cam, junction.
- **Web UI** (`app/`): IEC-style SVG schematic editing (place / wire / move / inspect),
  phase-colored live wires, light + dark themes (persisted), zoom slider (25–300 %),
  Ctrl+wheel zoom, Fit-to-view, inspector panel, collapsible event-log drawer with live
  ticker, 11-step interactive tutorial with action gates, last-circuit resume.
- **HTTP host** (`server.js`): zero-dependency Node server — static app, `/api/command`,
  `/api/tools`, `/api/state`, `/api/health`, SSE live state at `/api/events`, export
  upload endpoints.
- **MCP layer** (`mcp/server.mjs`): dependency-free stdio JSON-RPC 2.0 bridge exposing
  26 tools; tool catalog served verbatim from `sim/api.js`.
- **Electron shell** (`electron/main.mjs`): desktop window + same API; `--smoke`,
  `--screenshot=`, `--headless`, `--check`, `--pdf-test` self-test modes; Linux zygote
  workaround; `VL_CHROMIUM_FLAGS` escape hatch; error page instead of black window on
  load failure.
- **PDF export**: IEC 61082-1-style multi-sheet drawing set — cover/index with tile map,
  1:1 schematic tiling across A4-landscape sheets with 70 px overlap, zone reference
  grids, per-sheet title blocks, symbol legend, component list, event log.
- **Video export**: scripted 720p/25 fps demo recording driven by each circuit's `demo`
  script, camera easing to operated components, mp4 transcoding via ffmpeg.
- **Example circuits** (5): `dol-starter`, `reversing-starter`, `timer-sequence`,
  `elevator-2floor`, `elevator-10floor` (46 components / 169 wires relay elevator),
  each covered by behavior tests.
- **Tests**: 31 tests total — engine physics (DOL scenario), example-circuit wiring
  validation, and a full MCP end-to-end run against real server + real stdio bridge.
- **Packaging**: `npm run package` → standalone linux-x64 Electron build.
- **GitHub Pages site** (`docs/`): landing page plus a live demo that runs the real
  `sim/engine.js` solver entirely client-side (vendored copies refreshed by
  `scripts/sync_demo.sh`). Enable via *Settings → Pages → Deploy from branch → main →
  /docs*.

### Fixed

- `list_components` tool crashed (`components.map is not a function`) after the engine
  switched to a `Map` — now returns a plain array; regression test added.
- Circuit dropdown in the toolbar did not follow circuit loads made via the API/MCP —
  it now syncs from the SSE snapshot.
- Tutorial card stretched over the whole screen when the spotlighted element sat in the
  lower half of the window (inline `bottom` cleared while stylesheet `bottom: 90px`
  re-applied).
