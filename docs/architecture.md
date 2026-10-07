# Architecture

VoltLab is one simulation engine with three front doors: the **web UI**, the **Electron
desktop shell**, and the **MCP agent layer**. All three speak to the same tool catalog —
there is exactly one dispatcher (`sim/api.js`) and it is the single source of truth for
both the HTTP API and the MCP `tools/list`.

```
┌─────────────────────┐   SSE state @10Hz   ┌──────────────────┐
│  Browser (app/)     │ ◄────────────────── │  host server.js  │ ◄── circuits/*.json
│  SVG canvas, UI     │  POST /api/command  │  static app/     │ ┌── sim/engine.js   ← the solver
└─────────────────────┘  ──────────────────► │  /api/* endpoints│ │   sim/devices.js  ← device registry
                                             └────────┬─────────┘ │   sim/api.js      ← tool catalog
                                                      │ imports   │
                                             ┌────────┴─────────┐ ▼
                                             │  electron/main.mjs│  createHost()
                                             │  window + extras  │  (screenshot tool via capturePage)
                                             └────────┬─────────┘
                                                      │ http://127.0.0.1:<port>/api/*
                                             ┌────────┴─────────┐
                                             │  mcp/server.mjs   │ ◄── any MCP client
                                             │  stdio JSON-RPC   │     (ZCode, Claude, …)
                                             └───────────────────┘
```

## Module map

| Module | Role | Dependencies |
|---|---|---|
| `sim/devices.js` | Device registry: terminals, params, defaults, sizes. Pure data — imported by the engine (physics) *and* the renderer (SVG symbols). | none |
| `sim/engine.js` | The solver: holds components/wires, evaluates one 0.1 s tick, produces snapshots. | `devices.js` |
| `sim/api.js` | `TOOLS` catalog (JSON-Schema-ish input specs) + `call(tool, args)` dispatcher; circuit library I/O. | `engine.js`, `devices.js` |
| `server.js` | HTTP host: static files, command endpoint, SSE broadcast loop, export uploads, headless-Chrome PDF fallback. | `sim/api.js` |
| `app/js/*` | Renderer: SVG symbol drawing, wiring interaction, themes, report builder, video recorder, tutorial. | browser ESM, no framework |
| `electron/main.mjs` | Desktop shell: window lifecycle, screenshot extra tool, self-test modes. | `server.js` |
| `mcp/server.mjs` | MCP bridge: newline-delimited JSON-RPC 2.0 over stdio → HTTP `POST /api/command`. | none (stdlib http) |

## The solver model (`sim/engine.js`)

The engine is a **discrete-time electrical solver**, not an animation loop:

1. **Netlist per tick.** Every tick, a union-find (DSU) structure merges all wire-connected
   terminals into *nets*. Nets carry a set of phases present on them (L1/L2/L3/N), seeded
   from phase-carrying terminals (`X1.L1`, contactor `T1`, motor `U`, …).
2. **Phase propagation.** Closed contacts (breaker poles, fuse elements, contactor mains,
   closed auxiliary contacts, selector positions, timer contacts) propagate phases across
   themselves. A device is *energized across* two terminals when both nets hold phases and
   they differ (coils A1-A2, lamps 1-2, buzzer).
3. **One-tick-per-stage propagation.** Relay chains cascade one stage per tick: pressing
   S5 → K5 picks up (tick 1) → KP dispatch contact closes (tick 2) → KM_run picks up
   (tick 3). Tests must `advance()` past pick-up and dwell delays before asserting.
4. **Thermal & dynamics** run on top of the electrical layer:
   - motor: ~6× FLC inrush at standstill, current decays to load current as speed rises,
     coast-down when de-energized, **stops on phase loss** with the remaining phases
     overcurrented (single-phasing);
   - thermal overload: integrates i²-style heating against its FLC setpoint, trips at
     100 % (class 10: ~10 s at 7.2× setpoint; a locked rotor trips in ~14.5 s at a 10 A
     setpoint), NC 95-96 drops the coil circuit, NO 97-98 lights the trip lamp, manual
     reset clears thermal memory;
   - fuses: blow instantly on short-circuit current; `replace_fuses` restores.
5. **Fast-forward.** `advance(s)` runs s/0.1 ticks synchronously — used by tests and by
   agents to reach trips without real-time waiting.

`snap()` (snapshot) must seed phase colors against its **own post-evaluation DSU** —
reusing the previous tick's roots yields empty phase arrays whenever a device changed
state that tick (this bug shipped once; tests cover it).

## State flow (SSE)

The host runs a 10 Hz interval: while `engine.running`, it steps the engine, then
broadcasts a JSON snapshot (component states, net ids + phase colors for wire coloring,
faults, sim time, recent events) to all SSE clients at `GET /api/events`. The renderer
is *dumb* — it renders whatever the last snapshot says and sends commands. This is why
every interaction handler binds to `pointerdown` (the element that exists at event time;
10 Hz re-renders would otherwise swallow click targets mid-press) and why circuit
`waypoints` are absolute canvas coordinates preserved across load/serialize.

## Tool catalog (`sim/api.js`)

`TOOLS` is an array of `{ name, description, inputSchema }` served verbatim as the MCP
`tools/list` and at `GET /api/tools`. The dispatcher `call(tool, args)` returns
`{ ok: true, ... }` or `{ ok: false, error }` — never throws across the boundary. The
Electron shell registers one extra tool implementation (`screenshot` via `capturePage`);
the host wires export hooks (`export_pdf` / `export_video` wait for the renderer to
upload the artifact back to `POST /api/export/*`).

## Export pipelines

- **PDF (IEC 61082-1 drawing set):** the renderer clones the canvas SVG, stamps a
  `viewBox`, strips inline pixel width/height (or CSS max-height clips instead of
  scaling), injects a light print theme into the SVG's own `<style>`, then builds A4-
  landscape sheets: schematic tiled 1:1 with 70 px overlap, zone grids, per-sheet title
  blocks, cover/index with tile map, legend, component list, event log. In Electron the
  HTML goes through `printToPDF`; in browser mode the host falls back to headless Chrome,
  then to a printable HTML file.
- **Video:** the renderer MediaRecorder-captures an offscreen 720p canvas while a `demo`
  script presses buttons on the live sim (camera easing toward each operated component),
  then uploads webm to `/api/export/video`, where ffmpeg transcodes to mp4 when present.

## Electron shell notes

- Linux: `--no-zygote` + `disableHardwareAcceleration` + `disable-gpu` are applied by
  default — on several modern kernels the Chromium **zygote silently fails to spawn
  renderer processes**, which manifests as a permanently black window with *no* error
  events. `--check` dumps load/DOM/capture diagnostics; `--pdf-test` self-tests
  printToPDF; `VL_CHROMIUM_FLAGS="a,b,c"` injects extra switches without a rebuild.
- `--smoke` runs a headless DOL scenario end-to-end and prints `SMOKE OK`;
  `--screenshot=out.png` loads the demo, captures and exits.
- Packaged Electron binaries have `argv = [binary, ...flags]` (no appDir), so CLI-flag
  parsing must slice `app.isPackaged ? 1 : 2`.

## Known constraints / sharp edges

- A whole ESM module graph can be silently blanked by a top-level `const` name collision
  *within one module* (happened with `rows` in `report.js`) — if the UI is blank, check
  `window.__voltlab` first.
- SVG presentation attributes cannot take `var()` — theme colors must ride on classes or
  inline styles.
- The tutorial dim overlay must be `pointer-events: none` (only the card captures) or it
  blocks clicks on the very element it spotlights.
- Report CSS must carry `.sel-box{display:none}` + symbol/wire rules or PDF tiles render
  black boxes and the legend prints blank; each `.sheet` must fit the printable A4-
  landscape area or every sheet spills an extra blank page.
