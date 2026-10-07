# Contributing to VoltLab

Thanks for your interest! VoltLab is deliberately small and dependency-free — the whole
runtime is Node stdlib plus the Electron shell. Contributions that keep that character
are especially welcome.

## Development setup

```bash
git clone https://github.com/touhidsiddiqueeraj-bit/VoltLab.git
cd voltlab
npm install          # only dev deps: electron + electron-packager
npm test             # engine + examples + MCP end-to-end
npm run serve        # web UI on http://127.0.0.1:8123
```

There is no build step — edit files and reload the browser tab. The dev server sends
`Cache-Control: no-cache`, so assets always revalidate.

### GitHub Pages demo

`docs/` doubles as the Pages site: a landing page (`docs/index.html`) plus a live demo
(`docs/demo/`) that runs the **real engine client-side**. The demo vendors copies of
`sim/engine.js`, `sim/devices.js`, `app/js/render.js`, `app/js/symbols.js`,
`app/css/app.css` and the circuits — after changing any of those, refresh the vendored
copies and check the demo still behaves:

```bash
./scripts/sync_demo.sh
python3 -m http.server -d docs 8124   # then open http://127.0.0.1:8124/
```

## Test layout

| Command | What it covers |
|---|---|
| `npm test` | everything below, via `node --test` |
| `test/dol.test.mjs` | DOL physics scenario: pick-up, seal-in, trip timing, phase loss, fuses |
| `test/examples.test.mjs` | wiring validation of every circuit in `circuits/` |
| `test/elevator10.test.mjs` | 10-floor elevator dispatch / cam / call-reset behavior |
| `test/mcp.e2e.mjs` | spawns real HTTP host + real MCP stdio server, drives the full scenario via `tools/call` |

Engine gotchas worth knowing before writing tests: relay chains propagate **one tick per
stage** (S5→K5→KP→KM_run = 3 ticks), and `advance(s)` fast-forwards n `step(0.1)` ticks —
so run past pick-up and dwell delays before asserting.

## Adding an example circuit

1. Build it in the UI and use **Circuit ▸ Save as**, or hand-write JSON — the schema is
   documented in [docs/circuit-format.md](docs/circuit-format.md).
2. Hand-writing JSON? The classic mistake is forgetting per-branch feeds (interlock
   contacts, coil/lamp return wires to the N junction). `test/examples.test.mjs` catches
   these — run it after every edit:
   ```bash
   node --test test/examples.test.mjs
   ```
3. Add a test to `test/examples.test.mjs` asserting the circuit's *behavior* (what picks
   up, what trips, what must never energize simultaneously), not just its wiring.
4. If it has a `demo` script, export a video to check the captions and camera.

## Adding a device type

1. Register it in `sim/devices.js` — terminals (absolute offsets), defaults, params,
   description. This file is shared by the engine and renderer and must stay
   dependency-free (pure data).
2. Draw it in `app/js/symbols.js` as an SVG symbol function. Rules that will bite you:
   - use CSS classes / inline styles for colors — **SVG presentation attributes cannot
     take `var()`**, so theme colors won't apply through attributes;
   - draw in absolute canvas coordinates (no group transforms);
   - terminal hit targets must render on `pointerdown`-visible layers (the UI re-renders
     at 10 Hz).
3. Give the engine a case in the per-tick evaluation switch in `sim/engine.js`
   (`state` mutations + `log()` calls), and expose any new operations as tools in
   `sim/api.js` — that one catalog feeds both HTTP and MCP.
4. Add tests for the new device's physics in a `test/*.test.mjs` file.

## Code style

- **No runtime npm dependencies** in `server.js`, `sim/`, `mcp/`, `electron/` — Node
  stdlib only. The app UI (`app/js/`) is plain ESM with no framework or bundler.
- Keep the UI minimal: new operations belong in the existing `<details>` menus, not new
  toolbars.
- Comments explain constraints (why something must be done a way), not restated code.

## Pull requests

1. Fork / branch, keep changes focused.
2. `npm test` green — include new tests for behavior changes.
3. Update `docs/` when you change architecture, tools, or the circuit format.
4. Update `CHANGELOG.md` under *Unreleased*.
5. Screenshots/GIFs welcome for UI changes — place them in `docs/media/`.

## Reporting bugs

Please include: how you ran the app (browser / Electron / which flags), the circuit JSON
(or the `save_circuit` output), the relevant slice of `get_log` events, and what you
expected vs. what happened. For agent/MCP issues, include the exact tool call and its
raw JSON response.
