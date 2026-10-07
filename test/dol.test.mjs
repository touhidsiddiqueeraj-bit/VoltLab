// test/dol.test.mjs — headless engine tests driving the full DOL starter scenario.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Engine } from '../sim/engine.js';
import { createApi } from '../sim/api.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dol = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'circuits', 'dol-starter.json'), 'utf8'));

function freshEngine() {
  const e = new Engine();
  e.loadCircuit(dol, 'dol-starter');
  e.step(0.1);
  return e;
}

const comp = (e, id) => e.components.get(id);
const st = (e, id) => comp(e, id).state;

test('circuit loads completely: all 13 components and 31 wires', () => {
  const e = freshEngine();
  assert.equal(e.components.size, 13);
  assert.equal(e.wires.length, 31);
});

test('API tool catalog: list_components returns a plain array (regression)', async () => {
  const api = createApi();
  await api.call('load_circuit', { name: 'dol-starter' });
  const r = await api.call('list_components', {});
  assert.equal(r.ok, true, r.error ?? '');
  assert.ok(Array.isArray(r.components), 'components must be an array');
  assert.equal(r.components.length, 13);
  assert.ok(r.components.every(c => c.id && c.type));
});

test('initial state: control live, H1 lit, contactor off, motor stopped', () => {
  const e = freshEngine();
  assert.equal(st(e, 'H1').lit, true, 'H1 power lamp lit');
  assert.equal(st(e, 'KM1').energized, false);
  assert.equal(st(e, 'M1').speed, 0);
  assert.equal(st(e, 'H2').lit, false);
  assert.equal(st(e, 'H3').lit, false);
});

test('breaker Q1 kills and restores the control circuit', () => {
  const e = freshEngine();
  e.setSwitch('Q1', false);
  e.step(0.1);
  assert.equal(st(e, 'H1').lit, false, 'H1 dark with Q1 open');
  e.pressButton('S1');
  e.step(0.2);
  assert.equal(st(e, 'KM1').energized, false, 'coil cannot pick up without control voltage');
  e.setSwitch('Q1', true);
  e.release_button_helper ?? 0; // no-op guard
  e.pressButton('S1', false);
  e.step(0.1);
  assert.equal(st(e, 'H1').lit, true, 'H1 back on');
});

test('DOL start: press START -> contactor picks up, motor spins up', () => {
  const e = freshEngine();
  e.pressButton('S1');
  e.step(0.1);
  assert.equal(st(e, 'KM1').energized, true, 'coil energized while START held');
  e.advance(2);
  assert.ok(st(e, 'M1').speed > 0.7, `motor speed ${st(e, 'M1').speed} > 0.7`);
  assert.equal(st(e, 'H2').lit, true, 'run lamp lit');
  assert.ok(st(e, 'M1').current <= comp(e, 'M1').params.flc * 1.05, 'current falls to ~FLC after spin-up');
});

test('seal-in: releasing START holds the contactor via aux 13-14', () => {
  const e = freshEngine();
  e.pressButton('S1');
  e.step(0.2);
  e.pressButton('S1', false);
  e.advance(1);
  assert.equal(st(e, 'KM1').energized, true, 'contactor still energized after releasing START');
  assert.ok(st(e, 'M1').speed > 0.5);
  assert.equal(st(e, 'H2').lit, true);
});

test('STOP drops the contactor and the motor coasts down', () => {
  const e = freshEngine();
  e.pressButton('S1');
  e.step(0.2);
  e.pressButton('S1', false);
  e.advance(2);
  e.pressButton('S0');
  e.step(0.2);
  assert.equal(st(e, 'KM1').energized, false, 'STOP drops contactor');
  e.pressButton('S0', false);
  e.advance(6);
  assert.ok(st(e, 'M1').speed < 0.06, `speed ${st(e, 'M1').speed} coasted down`);
  assert.equal(st(e, 'H2').lit, false);
});

test('overload trip: stalled motor heats KK1, trips, drops contactor, lights H3', () => {
  const e = freshEngine();
  e.injectFault('stall', { target: 'M1' });
  e.pressButton('S1');
  e.step(0.2);
  e.pressButton('S1', false);
  e.advance(1);
  assert.ok(st(e, 'M1').current > 5 * comp(e, 'M1').params.flc, 'locked-rotor current ~6x FLC');
  e.advance(30);
  assert.equal(st(e, 'KK1').tripped, true, 'overload tripped');
  assert.equal(st(e, 'KM1').energized, false, 'contactor dropped by 95-96 opening');
  assert.equal(st(e, 'H3').lit, true, 'trip lamp lit via 97-98');
  assert.equal(st(e, 'H2').lit, false);
  assert.ok(st(e, 'M1').speed < 0.05);
  // expected trip time at 6x In, class 10: t = 1/((36-1)/((51.84-1)*10)) = 14.5s
  const tripEv = e.events.find(v => v.msg.includes('TRIPPED'));
  assert.ok(tripEv, 'trip event logged');
  assert.ok(tripEv.t > 10 && tripEv.t < 20, `trip time ${tripEv.t}s within class-10 band`);
});

test('overload reset restores readiness', () => {
  const e = freshEngine();
  e.injectFault('stall', { target: 'M1' });
  e.pressButton('S1');
  e.step(0.2);
  e.pressButton('S1', false);
  e.advance(30);
  assert.equal(st(e, 'KK1').tripped, true);
  e.clearFault('stall');
  e.resetOverload('KK1');
  e.step(0.1);
  assert.equal(st(e, 'KK1').tripped, false);
  assert.equal(st(e, 'H3').lit, false, 'trip lamp dark after reset');
  // restart works
  e.pressButton('S1');
  e.step(0.2);
  e.pressButton('S1', false);
  e.advance(1);
  assert.equal(st(e, 'KM1').energized, true);
  assert.ok(st(e, 'M1').speed > 0.3);
});

test('mechanical overload fault eventually trips (load x2.5)', () => {
  const e = freshEngine();
  e.injectFault('overload', { target: 'M1', multiplier: 2.5 });
  e.pressButton('S1');
  e.step(0.2);
  e.pressButton('S1', false);
  e.advance(1);
  assert.ok(st(e, 'M1').current > 2 * comp(e, 'M1').params.flc, 'current reflects overload');
  e.advance(400);
  assert.equal(st(e, 'KK1').tripped, true, 'thermal model trips at 2.5x within 400s');
  assert.equal(st(e, 'KM1').energized, false);
});

test('phase loss: motor single-phases, slows, draws excess current, recovers when phase restored', () => {
  const e = freshEngine();
  e.pressButton('S1');
  e.step(0.2);
  e.pressButton('S1', false);
  e.advance(2);
  assert.ok(st(e, 'M1').speed > 0.7);
  e.injectFault('phase_loss', { phase: 'L2' });
  e.advance(3);
  assert.ok(st(e, 'M1').speed < 0.6, `speed dropped to ${st(e, 'M1').speed}`);
  assert.ok(st(e, 'M1').current > comp(e, 'M1').params.flc * 1.2, 'single-phase current elevated');
  e.clearFault('phase_loss');
  e.advance(2);
  assert.ok(st(e, 'M1').speed > 0.5, 'motor re-accelerates after phase restore');
});

test('short circuit blows upstream fuses and kills the circuit', () => {
  const e = freshEngine();
  e.pressButton('S1');
  e.step(0.2);
  e.pressButton('S1', false);
  e.advance(1);
  e.injectFault('short_circuit', { target: 'M1' });
  e.step(0.1); // tick 1: fuses blow
  e.step(0.1); // tick 2: coil circuit dead -> contactor drops
  const f1 = st(e, 'F1').blown;
  assert.ok(f1.some(b => b), 'F1 poles blown');
  assert.equal(st(e, 'KM1').energized, false, 'everything dead after fuse blow');
  assert.equal(st(e, 'H1').lit, false, 'H1 dark (fed from F1.T1)');
  e.clearFault('short_circuit');
  e.replaceFuses('F1');
  e.step(0.1);
  assert.equal(st(e, 'H1').lit, true, 'restored after fuse replacement');
});

test('timer on-delay closes contact after set delay', () => {
  const e = freshEngine();
  e.addComponent({ id: 'KT1', type: 'timer_on', x: 1200, y: 200, params: { delay: 2 } });
  e.addComponent({ id: 'X2', type: 'supply3', x: 1200, y: 40 }); // dedicated source for coil
  e.connect('X2.L1', 'KT1.A1');
  e.connect('X2.N', 'KT1.A2');
  e.addComponent({ id: 'H9', type: 'lamp', x: 1200, y: 400 });
  e.connect('X2.L1', 'KT1.15');
  e.connect('KT1.16', 'H9.1');
  e.connect('X2.N', 'H9.2');
  e.advance(1);
  assert.equal(st(e, 'H9').lit, false, 'not yet timed out');
  e.advance(1.5);
  assert.equal(st(e, 'H9').lit, true, 'lit after 2s delay');
});

test('serialize/load round-trip preserves topology and state', () => {
  const e = freshEngine();
  e.pressButton('S1');
  e.step(0.2);
  e.pressButton('S1', false);
  e.advance(1);
  const ser = e.serialize('roundtrip');
  const e2 = new Engine();
  e2.loadCircuit(ser, 'roundtrip');
  e2.step(0.1);
  assert.equal(e2.components.size, e.components.size);
  assert.equal(e2.wires.length, e.wires.length);
  assert.equal(st(e2, 'KM1').energized, true, 'running state persisted through save/load');
});
