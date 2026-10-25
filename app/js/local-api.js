// app/js/local-api.js — the Tier-2 offline host: runs the REAL engine and the
// REAL tool dispatcher (sim/tools.js) inside the page, replacing server.js.
//
//   ui/main.js ──cmd(tool,args)──▶ local-api.js ──▶ sim/tools.js dispatcher ──▶ sim/engine.js
//        ▲                                                                            │
//        └────────── onState(engine.snapshot()) via a 10 Hz loop ─────────────────────┘
//
// Circuit library = the bundled examples (fetched read-only from circuits/)
// ∪ anything the user saved (localStorage). Dependencies are injectable
// (fetchImpl / storage) so the same module runs in Node tests.

import { Engine } from '../../sim/engine.js';
import { createDispatcher } from '../../sim/tools.js';

const LS_PREFIX = 'voltlab.circuit.';

function savedNames(storage) {
  const names = [];
  try {
    for (let i = 0; i < storage.length; i++) {
      const k = storage.key(i);
      if (k?.startsWith(LS_PREFIX)) names.push(k.slice(LS_PREFIX.length));
    }
  } catch { /* storage unavailable — bundled only */ }
  return names;
}

/**
 * Browser circuit store: bundled examples (via circuits/index.json manifest)
 * merged with user-saved circuits in localStorage. Saved copies win on load.
 */
export function createCircuitStore({ fetchImpl, storage, base = '' }) {
  let bundled = [];   // names from the manifest, cached at init

  return {
    /** Fetch + cache the manifest. Call before serving UI. */
    async init() {
      try {
        const res = await fetchImpl(`${base}circuits/index.json`);
        if (res.ok) {
          const j = await res.json();
          bundled = (j.circuits || []).map(c => c.name).filter(n => /^[A-Za-z0-9._-]+$/.test(n));
        }
      } catch { /* no manifest — saved circuits still work */ }
    },

    list() {
      return [...new Set([...bundled, ...savedNames(storage)])].sort();
    },

    async load(name) {
      const raw = storage.getItem(LS_PREFIX + name);
      if (raw != null) return JSON.parse(raw);
      const res = await fetchImpl(`${base}circuits/${name}.json`);
      if (!res.ok) throw new Error(`circuit "${name}" not found`);
      return res.json();
    },

    save(name, json) {
      storage.setItem(LS_PREFIX + name, JSON.stringify(json));
      return `local:${name}`;
    }
  };
}

/**
 * Create the in-page host. Mirrors server.js behaviour:
 *  - call(tool, args) → dispatcher, then broadcast a fresh snapshot
 *  - 10 Hz loop: step while running, broadcast on version change / running
 *  - connect(): manifest init, then hello + initial state
 *
 * @param {object} opts
 * @param {Function} opts.fetchImpl      fetch-like (bundled circuits)
 * @param {object}   opts.storage        localStorage-like
 * @param {Function} [opts.onState]      snapshot callback (the "SSE stream")
 * @param {Function} [opts.onExportRequest]  ({kind, name}) — renderer records
 * @param {number}   [opts.logLimit=30]  log lines per snapshot (as in SSE)
 * @param {boolean}  [opts.loop=true]    start the realtime interval (tests: false)
 */
export function createLocalHost({
  fetchImpl = (typeof fetch !== 'undefined' ? fetch : undefined),
  storage = (typeof localStorage !== 'undefined' ? localStorage : undefined),
  base = '',
  onState = null,
  onExportRequest = null,
  logLimit = 30,
  loop = true
} = {}) {
  if (!fetchImpl || !storage) throw new Error('local host needs fetchImpl and storage');

  const engine = new Engine();
  const circuits = createCircuitStore({ fetchImpl, storage, base });
  const dispatcher = createDispatcher({ engine, circuits });

  let lastSnapshot = null;
  let lastVersion = -1;

  function emitState() {
    lastSnapshot = engine.snapshot(logLimit);
    lastVersion = engine.version;
    onState?.(lastSnapshot);
  }

  /** One realtime tick — mirrors server.js's loop body. */
  function tick() {
    if (engine.running) engine.step(engine.tickRate);
    if (!lastSnapshot || engine.version !== lastVersion || engine.running) emitState();
  }

  let timer = null;
  function startLoop() {
    if (timer || !loop) return;
    timer = setInterval(tick, 100);
  }
  function stopLoop() {
    if (timer) { clearInterval(timer); timer = null; }
  }

  dispatcher.setExportHook((kind, name) => onExportRequest?.({ kind, name }));

  let connected = null;

  return {
    mode: 'local',
    engine,
    circuits,

    /** Manifest init + initial state. Returns a hello-ish object. */
    async connect() {
      await circuits.init();
      startLoop();
      const hello = { circuit: engine.circuitName, t: engine.t };
      emitState();
      connected = hello;
      return hello;
    },

    disconnect() { stopLoop(); connected = null; },

    /** Same contract as POST /api/command: {ok:true,...} | {ok:false,error}. */
    async call(tool, args = {}) {
      const result = await dispatcher.call(tool, args);
      emitState();
      return result;
    },

    /** Same contract as GET /api/state. */
    state(logLimitArg) {
      return engine.snapshot(logLimitArg ?? 50);
    },

    /** Same contract as GET /api/health (no MCP agent offline). */
    async health() {
      return {
        ok: true,
        app: 'voltlab',
        circuit: engine.circuitName,
        circuits: circuits.list(),
        local: true,
        mcpScript: null,
        agentLastSeenSec: null
      };
    },

    /** Fetch a bundled circuit JSON directly (video.js demo scripts). */
    async loadCircuitJson(name) {
      return circuits.load(name);
    },

    /** Renderer finished an export artifact — resolves the waiting tool call. */
    completeExport(kind, name, payload) {
      return dispatcher.completeExport(kind, name, payload);
    },

    /** Register a host-specific tool implementation (e.g. local screenshot). */
    registerExtra(name, fn) {
      return dispatcher.registerExtra(name, fn);
    },

    get connected() { return connected; },

    /** exposed for tests: drive the realtime loop without timers */
    _tick: tick
  };
}
