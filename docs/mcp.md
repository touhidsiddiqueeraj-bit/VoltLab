# MCP tool reference

VoltLab exposes its full control surface as **26 MCP tools**. The catalog lives in
[`sim/api.js`](../sim/api.js) (`TOOLS`) — the same dispatcher serves the HTTP API, so
everything here also works as plain JSON-over-HTTP without any MCP client.

## Connecting a client

Start the app first (either mode):

```bash
npm run serve   # browser mode, http://127.0.0.1:8123
# or
npm start       # Electron; prints its API port if 8123 was busy
```

Then register the stdio bridge:

```json
{
  "mcpServers": {
    "voltlab": {
      "command": "node",
      "args": ["/path/to/voltlab/mcp/server.mjs"],
      "env": { "VOLTLAB_URL": "http://127.0.0.1:8123" }
    }
  }
}
```

- The bridge is **dependency-free** and speaks newline-delimited JSON-RPC 2.0 over stdio
  (`initialize`, `tools/list`, `tools/call`).
- `tools/list` serves the catalog **verbatim from `sim/api.js`** — the app UI can show
  you the same list at `GET /api/tools`, and the toolbar **MCP** button shows the
  connection status plus this client config, ready to copy.
- Every tool result is JSON with `ok: true/false` (errors carry an `error` message).

## The tools

### Build the circuit

| Tool | Args | Notes |
|---|---|---|
| `add_component` | `type` (required), `id?`, `label?`, `x?`, `y?`, `params?` | Types: `supply3, breaker3, breaker1, fuse3, fuse1, contactor, overload, motor3, pushbutton_no, pushbutton_nc, selector2, timer_on, lamp, buzzer, cam10, junction` |
| `remove_component` | `id` | Removes attached wires too |
| `move_component` | `id`, `x`, `y` | |
| `list_components` | — | id / type / label of everything placed |
| `list_terminals` | `id` | Terminals with absolute canvas positions (for wiring) |
| `connect` | `from`, `to` | `"Comp.Term"` refs, e.g. `{"from": "Q1.T1", "to": "KM1.L1"}` |
| `disconnect` | `from`, `to` | |
| `list_wires` | — | Endpoints + live net ids |

### Operate the panel

| Tool | Args | Notes |
|---|---|---|
| `press_button` | `id` | Momentary — **stays held** until `release_button` |
| `release_button` | `id` | |
| `set_switch` | `id`, `closed` | Breakers on/off, selector I/0 |
| `set_position` | `id`, `position` (1..10) | Moves a `cam10` floor cam (elevator car) |
| `set_param` | `id`, `param`, `value` | e.g. motor `flc`/`load`, overload `flc`/`trip_class`, timer `delay`, fuse `rating` |

### Break things (fault injection)

| Tool | Args | Notes |
|---|---|---|
| `inject_fault` | `type`, `target?`, `phase?`, `multiplier?` | `phase_loss` (drops L2 by default), `overload` (mechanical, ×2.5 default), `stall` (locked rotor), `short_circuit` (blows upstream fuses) |
| `clear_fault` | `type?` | Omit to clear all; blown fuses still need `replace_fuses`, a trip needs `reset_overload` |
| `replace_fuses` | `id?` | All fuses, or one device |
| `reset_overload` | `id` | Clears trip + thermal memory |

### Observe

| Tool | Args | Notes |
|---|---|---|
| `get_state` | `logLimit?` | Full snapshot: component states, nets/phase colors, faults, sim time, events |
| `get_log` | `limit?` | Timestamped event history (coil pick/drop, trips, faults, presses) |
| `sim_control` | `action`, `seconds?` | `run` (realtime) / `pause` / `step` (one 0.1 s tick) / `advance` N sim-seconds / `reset` (reload last circuit) |

### Circuit library

| Tool | Args | Notes |
|---|---|---|
| `load_circuit` | `name` | From `circuits/<name>.json`, replaces the canvas |
| `save_circuit` | `name` | Writes `circuits/<name>.json` |
| `clear_circuit` | — | Empty canvas |

### Document

| Tool | Args | Notes |
|---|---|---|
| `export_pdf` | `name?` | IEC-style multi-sheet drawing set → `exports/`. Needs the app UI open (a renderer must build the report); browser mode may fall back to HTML |
| `export_video` | `name?` | Scripted 720p demo recording per the circuit's `demo` script → `exports/` (mp4 if ffmpeg present). Needs the app UI open |
| `screenshot` | `path?` | **Electron mode only** — captures the window; browser mode returns a helpful error |

## Without MCP: raw HTTP

Every tool is a plain POST away — handy for scripts and smoke tests:

```bash
# start the motor, fast-forward 2 s, read the state
curl -s -X POST localhost:8123/api/command -H 'Content-Type: application/json' \
  -d '{"tool":"press_button","args":{"id":"S1"}}'
curl -s -X POST localhost:8123/api/command -H 'Content-Type: application/json' \
  -d '{"tool":"sim_control","args":{"action":"advance","seconds":2}}'
curl -s localhost:8123/api/state | jq '.state.components[] | select(.id=="M1")'
```

Other endpoints: `GET /api/tools` (catalog), `GET /api/state` (snapshot),
`GET /api/health` (circuit in use, available circuits, agent last-seen),
`GET /api/events` (SSE: `state` frames at 10 Hz + `export-request` events).

## A worked agent session

This is the scenario `test/mcp.e2e.mjs` drives end-to-end against the real server —
24 checks, zero GUI involvement:

```
→ tools/call load_circuit   {"name":"dol-starter"}        13 components, 31 wires on canvas
→ tools/call sim_control    {"action":"run"}               realtime ticking
→ tools/call get_state                                     H1 lit, KM1 off, motor stopped
→ tools/call press_button   {"id":"S1"}                    S1 held
→ tools/call advance        …                              KM1 picks up, motor spins up, H2 lit
→ tools/call release_button {"id":"S1"}                    seal-in 13-14 keeps KM1 energized
→ tools/call press_button   {"id":"S0"}                    contactor drops, motor coasts
→ tools/call inject_fault   {"type":"stall","target":"M1"} locked-rotor current ~6× FLC
→ tools/call sim_control    {"action":"advance","seconds":16}
                                                           KK1 trips (class 10), coil drops, H3 lights
→ tools/call reset_overload {"id":"KK1"}                   thermal memory cleared, ready again
```

An agent can just as well **build** a circuit from scratch: `clear_circuit` →
`add_component` (supply, breaker, fuses, contactor, overload, motor, buttons, lamps) →
`list_terminals` → `connect` each wire → `save_circuit` → `export_pdf` → `export_video`.
The full DOL starter is ~13 components and ~31 wires; see
[docs/circuit-format.md](circuit-format.md) for what such a save looks like.
