# Changelog

All notable changes to VoltLab are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/) and the project adheres to
[Semantic Versioning](https://semver.org/).

## [1.3.1] — 2026-10-25

### Fixed — the packaging round (AppImage crash, Android 15 overlap, phone ergonomics)

- **Linux AppImage/deb crashed on launch** (`ENOENT mkdir …/resources/app/exports`).
  Packaged installs are read-only at runtime, and the app tried to create its
  `exports/` directory inside the install dir. All runtime writes now live in
  writable per-user locations: exports and screenshots in the OS data dir
  (`~/.config/VoltLab` on Linux, `%APPDATA%\VoltLab` on Windows,
  `~/Library/Application Support/VoltLab` on macOS — Electron prints the exact
  path at startup), user-saved circuits in a `circuits/` overlay next to them.
  A writable checkout still writes `exports/` and `circuits/` in place, exactly
  as before (`node server.js` unchanged). `createHost` gained a `stop()` for
  clean shutdown, and falls back to `~/.voltlab/exports` if the requested
  exports dir cannot be created.
- **Circuit saves in read-only installs.** `save_circuit` in the AppImage would
  have crashed the same way; saves now land in the user circuits overlay and
  the picker lists the merged library (user copies shadow bundled files of the
  same name).
- **Fontconfig warning storm on modern distros.** AppImage/deb runs no longer
  parse the host's `/etc/fonts/conf.d` (whose 2.15+ syntax the bundled
  fontconfig cannot read — the "invalid attribute 'xsi:nil'" wall); the app
  ships a minimal `fonts.conf` (standard font dirs + cache) and points
  `FONTCONFIG_FILE` at it on Linux.
- **Android 15 system-bar overlap (the "unusable UI" report).** The APK targets
  SDK 35, where edge-to-edge is enforced — the WebView drew under the status
  bar and gesture bar, covering the toolbar and the operator console. The
  WebView now insets itself (`adjustMarginsForEdgeToEdge: auto`), the window
  chrome is VoltLab-dark, and screenshots default to the data dir.
- **Phone fit was a speck.** Auto-fit could shrink a large circuit to ~25 %
  zoom on a phone. On viewports under 900 px the fit is floored at 70 % —
  legible, pannable, pinchable. A `load_circuit` race that skipped the fit in
  server mode is also fixed (the SSE frame announcing the load can beat the
  command response).
- **Two-finger gestures rewritten.** Pan (midpoint-follow) and zoom (per-frame
  spread ratio, anchored at the fingers) are now one combined gesture — a
  two-finger drag pans even over symbols (one-finger drag there still moves
  the component), and pinch-zoom no longer drifts when fingers wobble. The
  Ctrl+wheel zoom anchor math was corrected the same way (screen offsets, not
  the moving svg rect).
- **Toolbar declutter on phones.** The fast-forward seconds field and the zoom
  slider hide below 900 px (⏩ keeps its value; pinch and the − / + buttons
  remain), and the empty-canvas hint points at the ☰ components drawer
  instead of a palette that phones don't show.

### Tests

- New `test/packaging.test.mjs` (6 tests): read-only installs fall back instead
  of crashing, the circuits overlay merges/shadows correctly, writable
  checkouts are regression-checked, and the mobile fit floor is pinned. Suite:
  **63 pass**.

## [1.3.0] — 2026-10-25

### Added — the operator round

- **Variable frequency drive (`vfd`).** A real speed-controlled drive: powers up on
  3-phase at L1/L2/L3, runs when FWD-COM or REV-COM see a potential difference, ramps
  its output frequency toward the speed reference (25 Hz/s default), and synthesizes
  its own rotating field on U/V/W — forward or reversed by swapping two synthetic
  phases, like a real drive. Motors fed by a drive now scale their speed target to
  the drive's frequency, so a drive at 15 Hz genuinely turns the load at 30 %. Both
  direction inputs at once = fault. Commanding both directions mid-drive plugs the
  motor through zero, exactly like mains reversing.
- **Accelerator (`pedal`) and service brake (`brake`).** Analog pedals, 0–100 %.
  The accelerator's R+/R- terminals emit an analog reference onto the net (like a
  0–10 V signal) that the VFD reads as its speed input, and its 13-14 pole is a
  pedal-start interlock (closes above a 5 % cutoff — no foot, no drive). The brake's
  NC pole 11-12 cuts the drive command when pressed, its NO pole 13-14 lights the
  brake lamps, and it mechanically decelerates the motor it is bound to — fighting
  the drive pulls extra current, coasting just stops the wheels.
- **Emergency stop (`estop`).** The classic red mushroom: maintained NC pole 11-12
  plus NO aux 13-14 for trip signalling, twist-to-release, clickable on the canvas
  and in the console.
- **3-position selector (`selector3`).** COM routes to nothing / P1 / P2 — for
  FWD-OFF-REV direction selectors or Hand-Off-Auto duty.
- **Elevator operator devices.** `floorselector` — a car operating panel that closes
  COM-<floor> per selection (parallel-friendly with hall buttons); `floordisplay` —
  a 7-segment floor indicator with up/down travel arrows, driven by real wiring;
  and the floor cam gained an **isolated indicator deck** (ICOM-IF1..10) so a display
  can be wired up without backfeeding the control logic.
- **Operator console.** The bottom bar is now device-driven: it grows hold-to-press
  buttons, a big e-stop mushroom, drag-able throttle/brake pedal sliders (keyboard
  accessible), VFD Hz + direction readouts, a floor indicator with arrows, car-call
  grids and move-the-car demo buttons, alongside the existing motor discs — whatever
  the circuit contains.
- **Two new worked examples.** `vehicle-drive` (EV/truck traction: VFD + pedals +
  key + F/R selector + e-stop + brake lights) and `elevator-cop` (the 10-story
  machine with a car operating panel, floor indicator and e-stop) — 18 new tests in
  `test/features.test.mjs` covering drive scaling, plugging, mechanical braking,
  dead-man interlock, held car calls and e-stop behavior (57 total).
- **Three new MCP tools:** `set_pedal` (analog pedal travel), `set_floor` (register
  car calls) and `set_selector` (multi-position selectors incl. cam10); `set_switch`
  now trips/releases e-stops.

### Changed

- `sequenceDir` generalized: rotation direction is derived from the cyclic order of
  any three distinct phase labels (mains L1-L2-L3 or a drive's synthetic field),
  with neutral explicitly excluded — mains-fed motors behave exactly as before.


## [1.2.0] — 2026-10-25

### Added — Tier 2: the full editor on Android (and in any browser, offline)

- **In-page host (`app/js/local-api.js`).** The real engine + the real tool
  dispatcher running inside the page, with the same contracts as the HTTP
  host: command-then-broadcast, a 10 Hz realtime loop, health/state endpoints
  and export round-trips. Circuits = the bundled examples (via a generated
  `circuits/index.json` manifest) ∪ anything the user saved to
  `localStorage`; saved copies shadow bundled ones by name. Dependency-injected
  (`fetchImpl`, `storage`), so it is fully unit-tested in Node
  (`test/localapi.test.mjs`, 7 tests).
- **Transport seam (`app/js/host.js`).** The UI no longer talks to
  `/api/...` directly. Server mode keeps the exact fetch + SSE behaviour;
  local mode — the Android APK, `file://`, or `?local=1` in any browser —
  swaps in the in-page host. One interface, every feature: commands, state
  stream, circuit listing, exports, screenshots.
- **Shared dispatcher (`sim/tools.js`).** The tool table + dispatcher moved
  out of `sim/api.js` into a browser-safe module; `sim/api.js` remains the
  Node wrapper (fs-backed circuit store) with an identical public surface.
  Node, Electron, MCP and the browser now execute the same dispatcher code.
- **Touch editing.** Two-finger pinch zoom around the gesture midpoint,
  one-finger pan, tap-to-select/wire, hold-to-press mimic buttons; terminals
  grow to 13 px hit circles on coarse pointers; menus, palette items and
  buttons get 38–40 px minimum heights. Drags moved from `mousemove` to
  `pointermove` (mouse, pen and touch unified).
- **Mobile layout.** Below 900 px the palette and inspector become swipe-in
  drawers with floating toggles; the toolbar wraps; the canvas fills the
  workspace.
- **In-page Save-as dialog.** Android WebViews have no `window.prompt`, so
  "Save canvas as…" is now a themed `<dialog>` everywhere.
- **Offline exports.** Video (webm) and PDF reports save to the app's
  Documents directory via `@capacitor/filesystem` on Android, or download
  in a plain browser; local screenshots render the SVG canvas to PNG.
- **Offline bundle (`scripts/build-offline-bundle.sh`).** Assembles the
  self-contained web app (~300 KB): editor + engine + circuits + manifest.
  `scripts/build-apk.sh` wraps it in Capacitor 7 with the Filesystem plugin,
  launcher icons from the app logo, and release signing — v1.2.0 APK is
  versionCode 3.

### Changed

- `test/mcp.e2e.mjs`-verified behaviour is unchanged: 39 unit tests (was 32)
  and 24 MCP end-to-end checks pass; the Electron `--smoke` DOL scenario
  passes; http mode, offline mode and the packaged desktop app were all
  re-verified end-to-end.

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
