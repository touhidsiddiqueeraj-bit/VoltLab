// sim/api.js — tool dispatcher shared by the HTTP host, the MCP stdio server and Electron.
// TOOLS is the single source of truth: the MCP server serves it verbatim as tools/list.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Engine } from './engine.js';
import { DEVICE_TYPES } from './devices.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const CIRCUITS_DIR = path.join(__dirname, '..', 'circuits');

const s = (x) => ({ type: 'string', description: x });
const n = (x) => ({ type: 'number', description: x });
const b = (x) => ({ type: 'boolean', description: x });

const obj = (properties, required = []) => ({ type: 'object', properties, required });

export const TOOLS = [
  {
    name: 'get_state',
    description: 'Full simulation snapshot: every component with live state (contactor energized, lamp lit, motor speed/current, overload thermal load, breaker/fuse status), wires with net ids and phase coloring, active faults, sim time and the recent event log.',
    inputSchema: obj({ logLimit: n('How many log events to include (default 50)') })
  },
  {
    name: 'list_components',
    description: 'List all placed components: id, type, label, position.',
    inputSchema: obj({})
  },
  {
    name: 'add_component',
    description: 'Place a new component on the canvas. Types: ' + Object.keys(DEVICE_TYPES).join(', ') + '.',
    inputSchema: obj({
      type: s('component type, e.g. contactor, overload, motor3, pushbutton_no, lamp'),
      id: s('optional explicit id (e.g. KM2); auto-generated when omitted'),
      label: s('optional display label'),
      x: n('canvas x'), y: n('canvas y'),
      params: { type: 'object', description: 'optional parameter overrides, e.g. {"flc": 8}' }
    }, ['type'])
  },
  {
    name: 'remove_component',
    description: 'Remove a component and all wires attached to it.',
    inputSchema: obj({ id: s('component id') }, ['id'])
  },
  {
    name: 'move_component',
    description: 'Move a component to new canvas coordinates.',
    inputSchema: obj({ id: s('component id'), x: n('canvas x'), y: n('canvas y') }, ['id', 'x', 'y'])
  },
  {
    name: 'list_terminals',
    description: 'List the terminals of a component with their absolute canvas positions (for wiring).',
    inputSchema: obj({ id: s('component id') }, ['id'])
  },
  {
    name: 'connect',
    description: 'Run a wire between two terminals. References look like "Q1.L1", "KM1.A1", "M1.U".',
    inputSchema: obj({ from: s('"Comp.Term"'), to: s('"Comp.Term"') }, ['from', 'to'])
  },
  {
    name: 'disconnect',
    description: 'Remove the wire between two terminals.',
    inputSchema: obj({ from: s('"Comp.Term"'), to: s('"Comp.Term"') }, ['from', 'to'])
  },
  {
    name: 'list_wires',
    description: 'List all wires with their endpoints and live net ids.',
    inputSchema: obj({})
  },
  {
    name: 'press_button',
    description: 'Press (hold) a momentary push button. It stays held until release_button — wire your sequence accordingly.',
    inputSchema: obj({ id: s('pushbutton id') }, ['id'])
  },
  {
    name: 'release_button',
    description: 'Release a held push button.',
    inputSchema: obj({ id: s('pushbutton id') }, ['id'])
  },
  {
    name: 'set_switch',
    description: 'Toggle a breaker or selector switch: closed=true (ON / position I) or false (OFF / position 0).',
    inputSchema: obj({ id: s('breaker/selector id'), closed: b('true = closed') }, ['id', 'closed'])
  },
  {
    name: 'set_position',
    description: 'Set the position (1..10) of a floor cam (cam10) — moves the elevator car between floors in the discrete model.',
    inputSchema: obj({ id: s('cam10 id'), position: n('floor number 1..10') }, ['id', 'position'])
  },
  {
    name: 'set_param',
    description: 'Set a device parameter, e.g. motor3 flc/load, overload flc/trip_class, timer_on delay, fuse rating.',
    inputSchema: obj({ id: s('component id'), param: s('parameter name'), value: n('numeric value') }, ['id', 'param', 'value'])
  },
  {
    name: 'inject_fault',
    description: 'Inject a fault: phase_loss (drops one supply phase), overload (mechanical overload on a motor, multiplier sets load), stall (locked rotor), short_circuit (blows upstream fuses).',
    inputSchema: obj({
      type: s('phase_loss | overload | stall | short_circuit'),
      target: s('component id (required for overload/stall/short_circuit)'),
      phase: s('phase to drop for phase_loss (L1|L2|L3, default L2)'),
      multiplier: n('load multiplier for overload fault (default 2.5)')
    }, ['type'])
  },
  {
    name: 'clear_fault',
    description: 'Clear one fault type, or all faults when type is omitted. Blown fuses need replace_fuses; a tripped overload needs reset_overload.',
    inputSchema: obj({ type: s('fault type to clear (optional — omit for all)') })
  },
  {
    name: 'replace_fuses',
    description: 'Replace blown fuses (all, or one device when id is given).',
    inputSchema: obj({ id: s('fuse device id (optional)') })
  },
  {
    name: 'reset_overload',
    description: 'Reset a tripped thermal overload relay (clears trip + thermal memory).',
    inputSchema: obj({ id: s('overload id') }, ['id'])
  },
  {
    name: 'load_circuit',
    description: 'Load a circuit from the circuits/ directory by name (without .json), e.g. "dol-starter". Replaces whatever is currently placed.',
    inputSchema: obj({ name: s('circuit name') }, ['name'])
  },
  {
    name: 'save_circuit',
    description: 'Save the current circuit to circuits/<name>.json.',
    inputSchema: obj({ name: s('circuit name') }, ['name'])
  },
  {
    name: 'clear_circuit',
    description: 'Remove all components and wires.',
    inputSchema: obj({})
  },
  {
    name: 'sim_control',
    description: 'Control the simulation: run (realtime), pause, step (one 0.1s tick), advance (fast-forward N sim-seconds instantly — use it to reach overload trips etc. without waiting), reset (reload last circuit).',
    inputSchema: obj({
      action: s('run | pause | step | advance | reset'),
      seconds: n('sim-seconds to advance (action=advance only, default 1)')
    }, ['action'])
  },
  {
    name: 'get_log',
    description: 'Recent timestamped event log: coil energize/drop, trips, motor start/stop, faults, button presses.',
    inputSchema: obj({ limit: n('max events (default 100)') })
  },
  {
    name: 'export_video',
    description: 'Record a demo video (webm, then mp4 when ffmpeg is available): the renderer presses each button per the circuit demo script (or a generic sweep) while capturing the live simulation. Requires the app UI to be open. Saves to exports/.',
    inputSchema: obj({ name: s('circuit name (defaults to the current circuit)') })
  },
  {
    name: 'export_pdf',
    description: 'Export a PDF report of the current circuit: schematic, symbol legend, component state table and event log. Requires the app UI to be open; in plain browser mode an HTML report is produced instead (print it to PDF).',
    inputSchema: obj({ name: s('circuit name (defaults to the current circuit)') })
  },
  {
    name: 'screenshot',
    description: 'Capture a PNG of the app window (Electron mode only; returns an error in plain HTTP mode).',
    inputSchema: obj({ path: s('output path (optional, defaults to out/screenshot-<ts>.png)') })
  }
];

export function createApi({ circuitsDir = CIRCUITS_DIR } = {}) {
  const e = new Engine();
  const extras = new Map(); // tool name -> async handler (e.g. Electron screenshot)
  let onExportRequest = null;   // hook: (kind, name) => void, set by the host for SSE broadcast
  const pendingExports = new Map(); // name -> resolve

  function setExportHook(fn) { onExportRequest = fn; }

  // renderer finished an export — resolve the waiting tool call
  function completeExport(kind, name, payload) {
    const key = `${kind}:${name}`;
    const resolve = pendingExports.get(key);
    if (resolve) {
      pendingExports.delete(key);
      resolve(payload);
      return true;
    }
    return false;
  }

  function registerExtra(name, fn) { extras.set(name, fn); }

  function listCircuits() {
    try {
      return fs.readdirSync(circuitsDir).filter(f => f.endsWith('.json')).map(f => f.replace(/\.json$/, ''));
    } catch { return []; }
  }

  function safeName(name) {
    if (!/^[A-Za-z0-9._-]+$/.test(name)) throw new Error('circuit name may only contain letters, digits, dot, dash, underscore');
    return name;
  }

  function compSummary(e) {
    return [...e.components.values()].map(c => ({ id: c.id, type: c.type, label: c.label }));
  }

  /** Execute a tool call. Returns a JSON-serializable result object (ok:true/false). */
  async function call(tool, args = {}) {
    try {
      const r = await exec(tool, args);
      return { ok: true, ...r };
    } catch (err) {
      return { ok: false, error: String(err.message || err), tool };
    }
  }

  async function exec(tool, args) {
    switch (tool) {
      case 'get_state':
        return { state: e.snapshot(args.logLimit ?? 50) };

      case 'list_components':
        return { components: compSummary(e) };

      case 'add_component': {
        const c = e.addComponent(args);
        return { id: c.id, type: c.type, label: c.label };
      }
      case 'remove_component':
        e.removeComponent(args.id);
        return { removed: args.id };
      case 'move_component':
        e.moveComponent(args.id, args.x, args.y);
        return { moved: args.id };

      case 'list_terminals':
        return { id: args.id, terminals: e.listTerminals(args.id) };

      case 'connect': {
        const w = e.connect(args.from, args.to);
        return { wire: w };
      }
      case 'disconnect':
        e.disconnect(args.from, args.to);
        return { disconnected: `${args.from}–${args.to}` };
      case 'list_wires':
        return { wires: e.wires.map(w => ({ id: w.id, from: w.from, to: w.to })) };

      case 'press_button':
        e.pressButton(args.id, true);
        return { pressed: args.id };
      case 'release_button':
        e.pressButton(args.id, false);
        return { released: args.id };

      case 'set_switch':
        e.setSwitch(args.id, !!args.closed);
        return { id: args.id, closed: !!args.closed };

      case 'set_position':
        e.setPosition(args.id, args.position);
        return { id: args.id, position: e.components.get(args.id).state.position };

      case 'set_param':
        e.setParam(args.id, args.param, args.value);
        return { id: args.id, param: args.param, value: args.value };

      case 'inject_fault':
        e.injectFault(args.type, args);
        return { faults: e.faults };
      case 'clear_fault':
        e.clearFault(args.type);
        return { faults: e.faults };

      case 'replace_fuses':
        return { replaced: e.replaceFuses(args.id) };

      case 'reset_overload':
        e.resetOverload(args.id);
        return { reset: args.id };

      case 'load_circuit': {
        const name = safeName(args.name);
        const file = path.join(circuitsDir, `${name}.json`);
        const json = JSON.parse(fs.readFileSync(file, 'utf8'));
        const loaded = e.loadCircuit(json, name);
        return { loaded, components: e.components.size, wires: e.wires.length, available: listCircuits() };
      }
      case 'save_circuit': {
        const name = safeName(args.name);
        fs.mkdirSync(circuitsDir, { recursive: true });
        const file = path.join(circuitsDir, `${name}.json`);
        fs.writeFileSync(file, JSON.stringify(e.serialize(name), null, 2));
        return { saved: file };
      }
      case 'clear_circuit':
        e.clearCircuit();
        return { cleared: true };

      case 'sim_control': {
        switch (args.action) {
          case 'run': e.running = true; e.log('simulation RUNNING (realtime)'); return { running: true };
          case 'pause': e.running = false; e.log('simulation PAUSED'); return { running: false };
          case 'step': e.step(e.tickRate); return { t: e.t };
          case 'advance': return e.advance(args.seconds ?? 1);
          case 'reset': e.resetSim(); return { reset: true, circuit: e.circuitName };
          default: throw new Error('action must be run|pause|step|advance|reset');
        }
      }

      case 'get_log':
        return { log: e.events.slice(-(args.limit ?? 100)) };

      case 'export_video': {
        const name = args.name || e.circuitName;
        if (!onExportRequest) throw new Error('export_video needs a running renderer (open the app UI first)');
        const key = `video:${name}`;
        const result = await new Promise((resolve, reject) => {
          pendingExports.set(key, resolve);
          onExportRequest('video', name);
          setTimeout(() => {
            if (pendingExports.has(key)) {
              pendingExports.delete(key);
              reject(new Error('renderer did not deliver the video within 180s — is the app UI open?'));
            }
          }, 180000);
        });
        return result;
      }

      case 'export_pdf': {
        const name = args.name || e.circuitName;
        if (!onExportRequest) throw new Error('export_pdf needs a running renderer (open the app UI first)');
        const key = `pdf:${name}`;
        const result = await new Promise((resolve, reject) => {
          pendingExports.set(key, resolve);
          onExportRequest('pdf', name);
          setTimeout(() => {
            if (pendingExports.has(key)) {
              pendingExports.delete(key);
              reject(new Error('renderer did not deliver the report within 60s — is the app UI open?'));
            }
          }, 60000);
        });
        return result;
      }

      case 'screenshot': {
        if (extras.has('screenshot')) {
          return await extras.get('screenshot')(args);
        }
        throw new Error('screenshot is only available when running inside Electron (npm start). In browser mode use your browser tooling instead.');
      }

      default:
        throw new Error(`unknown tool "${tool}"`);
    }
  }

  return { engine: e, call, registerExtra, TOOLS, listCircuits, setExportHook, completeExport };
}
