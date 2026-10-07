# Circuit format

A VoltLab circuit is a single JSON file in [`circuits/`](../circuits/). Everything is
explicit — components, wires (including elbow points), and the optional demo script used
by the video exporter.

```jsonc
{
  "name": "dol-starter",            // file name without .json
  "description": "Direct-On-Line starter …",  // shown in reports
  "components": [ /* … */ ],
  "wires":      [ /* … */ ],
  "demo":       [ /* … optional */ ]
}
```

## Components

```jsonc
{
  "id": "KM1",            // unique; referenced by wires and tools
  "type": "contactor",    // one of the 16 registry types (see below)
  "label": "KM1",         // displayed on the schematic and in the component list
  "x": 460, "y": 460,     // absolute canvas position (top-left of the symbol)
  "params": { "flc": 8 }  // optional overrides of the registry defaults
}
```

### Device types (`sim/devices.js`)

| Group | Types |
|---|---|
| Sources | `supply3` — 3-phase + neutral, always energized |
| Protection | `breaker3`, `breaker1` (toggle open/closed), `fuse3`, `fuse1` (blow on short-circuit), `overload` (thermal, NC 95-96 + NO 97-98 aux, params `flc`, `trip_class`) |
| Switching | `contactor` — 3 main poles, NO aux 13-14, NC aux 21-22, coil A1-A2 |
| Control | `pushbutton_no` (13-14), `pushbutton_nc` (11-12), `selector2` (I/0), `timer_on` (coil A1-A2, contact 15-16, param `delay`), `cam10` (10-position 3-deck floor cam) |
| Loads | `motor3` (U/V/W, params `flc`, `load`) |
| Signalling | `lamp`, `buzzer`, `junction` (plain node / rail point) |

Terminal names follow the registry (`Q1.L1`, `KM1.A1`, `M1.U`, `KK1.95`, …). Run
`list_terminals` on any component (or read `sim/devices.js`) to see every terminal and
its offset.

## Wires

```jsonc
{
  "from": "X1.L1",
  "to":   "Q1.L1",
  "waypoints": [[60, 124], [200, 124]]   // optional elbow points, ABSOLUTE canvas coords
}
```

Waypoints are preserved verbatim through save/load — that's what makes hand-drawn
schematics keep their tidy orthogonal routing. Omit them and the renderer draws a
straight line.

> **The classic hand-writing mistakes** (all caught by `test/examples.test.mjs`):
> forgetting per-branch feeds (e.g. the interlock contact must be *fed*, not just
> connected), and forgetting the return wire from a coil/lamp to the N junction.

## Demo script (optional)

Each entry is one step of the video exporter's choreography:

```jsonc
"demo": [
  { "caption": "VoltLab — DOL starter: H1 shows control power" },
  { "wait": 2.5 },
  { "caption": "Press START (S1) — contactor picks up" },
  { "press": "S1" },
  { "wait": 1.5 },
  { "release": "S1" },
  { "caption": "Seal-in aux holds the contactor — motor spins up" },
  { "wait": 3.5 },
  { "press": "S0" }, { "wait": 1.2 }, { "release": "S0" }
]
```

Steps: `caption` (on-screen title for the following beat), `wait` (seconds),
`press` / `release` (push-button id). While recording, the camera eases toward whatever
component the current step operates.

## Authoring workflow

**GUI first** (recommended): build and wire in the app, then **Circuit ▸ Save as** —
you get a valid file with correct waypoints to tweak by hand.

**Generated**: `elevator-10floor.json` is produced by
[`scripts/generate_elevator10.py`](../scripts/generate_elevator10.py) — a good reference
for programmatic generation of repetitive circuits (10 nearly identical per-floor
branches).

**Validating**: after any hand edit, run the example-circuit tests:

```bash
node --test test/examples.test.mjs
```

They load every file in `circuits/` into a fresh engine and assert each circuit's
*behavior* (what picks up, what trips, what can never energize simultaneously), which is
the strongest check that a circuit is wired the way its name claims. Then add a test for
your own circuit's behavior — see [CONTRIBUTING.md](../CONTRIBUTING.md).
