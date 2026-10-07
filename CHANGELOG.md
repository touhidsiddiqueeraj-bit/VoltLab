# Changelog

All notable changes to VoltLab are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/) and the project adheres to
[Semantic Versioning](https://semver.org/).

## [Unreleased]

### Fixed

- **Motor direction was invisible.** The engine treated motor speed as a plain magnitude
  (0..1), so the rotor animation could only ever spin one way — a reversing starter
  swapped phases electrically but the motor never appeared to slow down, stop, or turn
  the opposite way. The engine now derives rotation direction from the phase sequence
  across the motor's U-V-W terminals (`state.dir`: +1 forward, −1 reverse, 0 off) and
  keeps `state.speed` signed. Applying the opposite sequence to a spinning rotor plugs
  it: counter-torque brakes through zero at ~2× load current, then it spins up reversed.
  The rotor animation and inspector render the signed speed/direction, and the event log
  records `REVERSED — phase order Lx-Ly-Lz` on a direction change.

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
