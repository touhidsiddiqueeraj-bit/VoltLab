// test/localapi.test.mjs — the Tier-2 offline host (app/js/local-api.js):
// the full editor stack (dispatcher + engine + circuit store) running in-page.
//
// Everything is injected: an in-memory fetch serving the bundled circuits +
// manifest, and a localStorage shim — no browser, no server, no DOM.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createLocalHost, createCircuitStore } from '../app/js/local-api.js';

const CIRCUITS = {
  'dol-starter': JSON.parse(readFileSync(new URL('../circuits/dol-starter.json', import.meta.url), 'utf8')),
  'elevator-2floor': JSON.parse(readFileSync(new URL('../circuits/elevator-2floor.json', import.meta.url), 'utf8'))
};
const MANIFEST = {
  circuits: [{ name: 'dol-starter' }, { name: 'elevator-2floor' }]
};

function memoryFetch(files) {
  return async (url) => {
    const path = String(url).replace(/^https?:\/\/[^/]+/, '').replace(/^\//, '');
    if (path in files) {
      return { ok: true, json: async () => files[path] };
    }
    return { ok: false, status: 404, json: async () => ({ error: 'not found' }) };
  };
}

function memoryStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    get length() { return map.size; },
    key: (i) => [...map.keys()][i] ?? null,
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k)
  };
}

function makeHost({ files = {}, storage = {}, states = [], exports = [] } = {}) {
  const allFiles = {
    'circuits/index.json': MANIFEST,
    'circuits/dol-starter.json': CIRCUITS['dol-starter'],
    'circuits/elevator-2floor.json': CIRCUITS['elevator-2floor'],
    ...files
  };
  const storageShim = storage instanceof Map ? storage : memoryStorage(storage);
  const host = createLocalHost({
    fetchImpl: memoryFetch(allFiles),
    storage: storageShim,
    onState: (snap) => states.push(snap),
    onExportRequest: (req) => exports.push(req),
    loop: false
  });
  return { host, storage: storageShim };
}

test('store lists manifest circuits and merges saved ones', async () => {
  const store = createCircuitStore({
    fetchImpl: memoryFetch({ 'circuits/index.json': MANIFEST }),
    storage: memoryStorage({ 'voltlab.circuit.my-saved': '{}' })
  });
  await store.init();
  assert.deepEqual(store.list(), ['dol-starter', 'elevator-2floor', 'my-saved']);
});

test('connect loads the manifest and emits an initial snapshot', async () => {
  const states = [];
  const { host } = makeHost({ states });
  await host.connect();
  assert.equal(host.connected.circuit, '(empty)');
  assert.equal(states.length, 1);
  assert.equal(states[0].circuit, '(empty)');
  assert.deepEqual(host.circuits.list(), ['dol-starter', 'elevator-2floor']);
});

test('full DOL scenario over the local command channel', async () => {
  const { host } = makeHost();
  await host.connect();

  // load + run
  let r = await host.call('load_circuit', { name: 'dol-starter' });
  assert.equal(r.ok, true);
  assert.equal(r.loaded, 'dol-starter');
  assert.ok(r.components > 0, 'has components');

  // health mirrors the server contract
  const h = await host.health();
  assert.equal(h.ok, true);
  assert.ok(h.circuits.includes('dol-starter'));
  assert.equal(h.local, true);

  r = await host.call('sim_control', { action: 'run' });
  assert.equal(r.running, true);

  // close the supply breaker, press START, expect seal-in + motor spin-up
  await host.call('set_switch', { id: 'Q1', closed: true });
  r = await host.call('press_button', { id: 'S1' });
  assert.equal(r.pressed, 'S1');
  await host._tick();
  await host.call('release_button', { id: 'S1' });

  // realtime loop advances sim time while running
  const t0 = host.state().t;
  for (let i = 0; i < 15; i++) host._tick();
  const snap = host.state();
  assert.ok(snap.t > t0, 'sim time advanced');
  const km1 = snap.components.find(c => c.id === 'KM1');
  const m1 = snap.components.find(c => c.id === 'M1');
  assert.equal(km1.state.energized, true, 'KM1 sealed in after START');
  assert.ok(Math.abs(m1.state.speed) > 0.3, `motor running (speed ${m1.state.speed.toFixed(2)})`);
});

test('editor flow: place, wire, save → persists to storage and reloads', async () => {
  const { host, storage } = makeHost();
  await host.connect();

  // build a minimal latch circuit from scratch
  let r = await host.call('add_component', { type: 'supply3', id: 'X1', x: 100, y: 100 });
  assert.equal(r.id, 'X1');
  r = await host.call('add_component', { type: 'pushbutton_no', id: 'S1', x: 300, y: 100 });
  r = await host.call('add_component', { type: 'lamp', id: 'H1', x: 500, y: 100 });
  await host.call('connect', { from: 'X1.L1', to: 'S1.13' });
  r = await host.call('connect', { from: 'S1.14', to: 'H1.1' });
  assert.equal(r.ok, true);
  await host.call('connect', { from: 'X1.N', to: 'H1.2' });
  assert.equal(r.ok, true);

  r = await host.call('save_circuit', { name: 'my-latch' });
  assert.equal(r.ok, true);
  assert.match(r.saved, /my-latch/);
  assert.ok(host.circuits.list().includes('my-latch'), 'saved circuit listed');
  assert.ok(JSON.parse(storage.getItem('voltlab.circuit.my-latch')).components.length === 3, 'stored JSON has 3 components');

  // wipe, reload from storage
  await host.call('clear_circuit');
  assert.equal(host.state().components.length, 0);
  r = await host.call('load_circuit', { name: 'my-latch' });
  assert.equal(r.loaded, 'my-latch');
  assert.equal(host.state().components.length, 3);
  assert.equal(host.state().wires.length, 3);

  // the lamp lights when the button is held
  await host.call('press_button', { id: 'S1' });
  host._tick();
  const h1 = host.state().components.find(c => c.id === 'H1');
  assert.equal(h1.state.lit, true, 'lamp lit through the pressed button');
});

test('saved circuits override bundled ones with the same name', async () => {
  // one-component "elevator-2floor" in storage shadows the bundled 20+ component one
  const shadow = { name: 'elevator-2floor', components: [{ id: 'M1', type: 'motor3', x: 0, y: 0 }], wires: [] };
  const { host } = makeHost({ storage: { 'voltlab.circuit.elevator-2floor': JSON.stringify(shadow) } });
  await host.connect();
  await host.call('load_circuit', { name: 'elevator-2floor' });
  assert.equal(host.state().components.length, 1);
});

test('export hooks round-trip: request → completeExport resolves the tool call', async () => {
  const exports = [];
  const { host } = makeHost({ exports });
  await host.connect();
  await host.call('load_circuit', { name: 'dol-starter' });

  // a tool call that waits for the renderer, racing a manual completion
  const pending = host.call('export_video', {});
  await new Promise(r => setTimeout(r, 10));
  assert.equal(exports.length, 1, 'export request dispatched');
  assert.equal(exports[0].kind, 'video');
  assert.equal(exports[0].name, 'dol-starter');

  host.completeExport('video', 'dol-starter', { ok: true, path: 'Documents/demo.webm' });
  const r = await pending;
  assert.equal(r.ok, true);
  assert.equal(r.path, 'Documents/demo.webm');
});

test('commands report errors with the same contract as the server', async () => {
  const { host } = makeHost();
  await host.connect();
  const r = await host.call('load_circuit', { name: 'no-such-circuit' });
  assert.equal(r.ok, false);
  assert.match(r.error, /not found/);
});
