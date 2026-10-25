// test/packaging.test.mjs — v1.3.1 regression tests for the read-only-install
// bugs reported against the v1.3.0 AppImage ("ENOENT mkdir .../resources/app/exports")
// and the Android APK's mobile UI defaults.
//
// Packaged installs mount the app directory read-only (AppImage squashfs,
// Program Files, ...). Everything the app writes at runtime — exports and
// user-saved circuits — must land in writable locations instead of inside the
// install dir.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createApi } from '../sim/api.js';
import { createHost } from '../server.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const isRoot = typeof process.getuid === 'function' && process.getuid() === 0;

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'voltlab-pack-'));
}

function readOnlyDir(label) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `voltlab-ro-${label}-`));
  fs.chmodSync(dir, 0o555);
  return dir;
}

function cleanupReadOnly(dir) {
  fs.chmodSync(dir, 0o755);
  fs.rmSync(dir, { recursive: true, force: true });
}

const CIRCUIT = {
  name: 'smoke-circuit',
  components: [{ id: 'Q1', type: 'switch', x: 100, y: 100, state: { closed: true } }],
  wires: []
};
// the engine needs the component type registered for load to succeed
import { DEVICE_TYPES } from '../sim/devices.js';
if (!DEVICE_TYPES.switch) {
  // keep the test independent of the registry's exact shape
  CIRCUIT.components[0].type = Object.keys(DEVICE_TYPES)[0];
}

// ---------- circuits overlay (sim/api.js, via the real tool API) ----------

async function save(api, name) {
  const r = await api.call('save_circuit', { name });
  assert.equal(r.ok, true, `save_circuit failed: ${r.error}`);
  return r.saved;
}

test('save_circuit: writable circuits/ keeps writing in place (no regression)', async () => {
  const circuitsDir = tmpDir();
  const api = createApi({ circuitsDir });
  await api.call('load_circuit', { name: 'dol-starter' });
  const file = await save(api, 'my-test');
  assert.equal(file, path.join(circuitsDir, 'my-test.json'));
  assert.ok(fs.existsSync(file));
  assert.deepEqual(api.listCircuits(), ['my-test']);
  fs.rmSync(circuitsDir, { recursive: true, force: true });
});

test('save_circuit: read-only circuits/ falls back to the user overlay (AppImage case)', { skip: isRoot && 'read-only perms are ineffective as root' }, async () => {
  const circuitsDir = readOnlyDir('circ');
  const userCircuitsDir = tmpDir();
  try {
    const api = createApi({ circuitsDir, userCircuitsDir });
    await api.call('load_circuit', { name: 'dol-starter' });
    const file = await save(api, 'rescued');
    assert.equal(file, path.join(userCircuitsDir, 'rescued.json'));
    assert.ok(fs.existsSync(file));
    assert.ok(!fs.existsSync(path.join(circuitsDir, 'rescued.json')));
    // the save must be loadable from the overlay afterwards
    const r = await api.call('load_circuit', { name: 'rescued' });
    assert.equal(r.ok, true);
  } finally {
    cleanupReadOnly(circuitsDir);
    fs.rmSync(userCircuitsDir, { recursive: true, force: true });
  }
});

test('list()/load(): user circuits merge with the bundled library and shadow it', async () => {
  const circuitsDir = path.join(__dirname, '..', 'circuits'); // real bundle (dol-starter etc.)
  const userCircuitsDir = tmpDir();
  fs.writeFileSync(path.join(userCircuitsDir, 'dol-starter.json'), JSON.stringify(CIRCUIT)); // shadows the bundle
  fs.writeFileSync(path.join(userCircuitsDir, 'mine.json'), JSON.stringify(CIRCUIT));
  const api = createApi({ circuitsDir, userCircuitsDir });

  const names = api.listCircuits();
  assert.ok(names.includes('dol-starter'), 'bundled circuits still listed');
  assert.ok(names.includes('mine'), 'user circuit listed');
  assert.equal(new Set(names).size, names.length, 'no duplicates');

  const r = await api.call('load_circuit', { name: 'dol-starter' });
  assert.equal(r.ok, true);
  assert.equal(r.components, 1, 'user copy (1 component) shadows the bundled one');
  const r2 = await api.call('load_circuit', { name: 'mine' });
  assert.equal(r2.ok, true);

  fs.rmSync(userCircuitsDir, { recursive: true, force: true });
});

// ---------- exports dir (server.js createHost) ----------

test('createHost: writable exports dir is used as-is', async () => {
  const exportsDir = path.join(tmpDir(), 'exports');
  const host = await createHost({ port: 0, exportsDir });
  assert.equal(host.exportsDir, exportsDir);
  assert.ok(fs.existsSync(exportsDir));
  host.stop();
  fs.rmSync(path.dirname(exportsDir), { recursive: true, force: true });
});

test('createHost: read-only exports dir falls back to ~/.voltlab/exports (the v1.3.0 AppImage crash)', { skip: isRoot && 'read-only perms are ineffective as root' }, async () => {
  const roDir = readOnlyDir('exp');
  const host = await createHost({ port: 0, exportsDir: path.join(roDir, 'exports') });
  try {
    const expected = path.join(os.homedir(), '.voltlab', 'exports');
    assert.equal(host.exportsDir, expected);
    assert.ok(fs.existsSync(expected));
    // the API must be fully alive — the v1.3.0 build died in createHost before listening
    const r = await host.api.call('get_state', { logLimit: 0 });
    assert.equal(r.ok, true);
  } finally {
    host.stop();
    cleanupReadOnly(roDir);
  }
});

// ---------- mobile fit zoom (app/js/main.js behavior contract) ----------
// The APK opens at a zoom that fits the whole circuit, which on a phone
// shrank large circuits to ~25% (unreadable). The UI now floors the fit at
// 0.7 on narrow viewports. We re-derive the same numbers the UI uses so a
// regression shows up here too.

test('mobile fit floor: a phone-sized fit clamps to >= 0.7, desktop fits fully', () => {
  const FIT_FLOOR = 0.7;
  const NARROW_MAX = 900;
  // vehicle-drive extents (px) as zoomFit would compute them
  const mx = 2500, my = 1300;
  const phone = { w: 412, h: 590 };
  const desktop = { w: 1560, h: 900 };

  const fit = (vp) => Math.min((vp.w - 30) / mx, (vp.h - 30) / my);
  const clamped = (vp) => vp.w <= NARROW_MAX ? Math.max(fit(vp), FIT_FLOOR) : fit(vp);

  assert.ok(fit(phone) < 0.3, 'sanity: phone fit would be a speck without the floor');
  assert.ok(Math.abs(clamped(phone) - FIT_FLOOR) < 1e-9, 'phone clamps at the floor');
  assert.ok(clamped(desktop) > 0.5, 'desktop keeps the true fit');
});
