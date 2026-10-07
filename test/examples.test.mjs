// test/examples.test.mjs — headless behavior tests for every example circuit.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Engine } from '../sim/engine.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CIRCUITS = path.join(__dirname, '..', 'circuits');

function load(name) {
  const e = new Engine();
  e.loadCircuit(JSON.parse(fs.readFileSync(path.join(CIRCUITS, `${name}.json`), 'utf8')), name);
  e.step(0.1);
  return e;
}
const st = (e, id) => e.components.get(id).state;

// ---------------- elevator ----------------

test('elevator: power on, both contactors start off', () => {
  const e = load('elevator-2floor');
  assert.equal(st(e, 'H3').lit, true, 'power lamp lit');
  assert.equal(st(e, 'KM1').energized, false);
  assert.equal(st(e, 'KM2').energized, false);
  assert.equal(st(e, 'M1').speed, 0);
});

test('elevator: call up latches, top limit releases', () => {
  const e = load('elevator-2floor');
  e.pressButton('S1');
  e.step(0.2);
  assert.equal(st(e, 'KM1').energized, true, 'KM1 picks up on call up');
  e.pressButton('S1', false);
  e.advance(2);
  assert.equal(st(e, 'KM1').energized, true, 'seal-in holds');
  assert.ok(st(e, 'M1').speed > 0.5, 'hoist motor running');
  assert.equal(st(e, 'H1').lit, true, 'going-up lamp lit');
  e.pressButton('S3'); // car reaches top
  e.step(0.2);
  assert.equal(st(e, 'KM1').energized, false, 'top limit drops KM1');
  e.pressButton('S3', false);
  e.advance(5);
  assert.ok(st(e, 'M1').speed < 0.06, 'motor coasted down');
});

test('elevator: call down works and bottom limit releases', () => {
  const e = load('elevator-2floor');
  e.pressButton('S2');
  e.step(0.2);
  assert.equal(st(e, 'KM2').energized, true, 'KM2 picks up on call down');
  e.pressButton('S2', false);
  e.advance(1);
  assert.equal(st(e, 'KM2').energized, true);
  assert.equal(st(e, 'H2').lit, true);
  e.pressButton('S4'); // car reaches bottom
  e.step(0.2);
  assert.equal(st(e, 'KM2').energized, false, 'bottom limit drops KM2');
});

test('elevator: cross-interlock prevents both contactors', () => {
  const e = load('elevator-2floor');
  e.pressButton('S1');
  e.step(0.2);
  e.pressButton('S1', false);
  e.advance(0.5);
  assert.equal(st(e, 'KM1').energized, true);
  e.pressButton('S2'); // opposite call while running
  e.step(0.3);
  assert.equal(st(e, 'KM2').energized, false, 'KM2 blocked by KM1 NC interlock');
  e.pressButton('S2', false);
  // and the mirror case
  e.pressButton('S3');
  e.step(0.2);
  e.pressButton('S3', false);
  e.advance(0.3);
  e.pressButton('S2');
  e.step(0.2);
  e.pressButton('S2', false);
  e.advance(0.5);
  assert.equal(st(e, 'KM2').energized, true, 'KM2 runs after KM1 dropped');
  e.pressButton('S1');
  e.step(0.3);
  assert.equal(st(e, 'KM1').energized, false, 'KM1 blocked by KM2 NC interlock');
});

test('elevator: overload trip kills both directions', () => {
  const e = load('elevator-2floor');
  e.injectFault('stall', { target: 'M1' });
  e.pressButton('S1');
  e.step(0.2);
  e.pressButton('S1', false);
  e.advance(30);
  assert.equal(st(e, 'KK1').tripped, true, 'overload tripped');
  assert.equal(st(e, 'KM1').energized, false);
  e.pressButton('S2'); // try the other direction
  e.step(0.3);
  assert.equal(st(e, 'KM2').energized, false, 'down direction also dead (95-96 open)');
  e.pressButton('S2', false);
});

// ---------------- timer-sequence ----------------

test('timer: first motor starts immediately, second after the delay', () => {
  const e = load('timer-sequence');
  e.pressButton('S1');
  e.step(0.2);
  assert.equal(st(e, 'KM1').energized, true, 'KM1 immediate');
  assert.equal(st(e, 'KM2').energized, false, 'KM2 waits');
  assert.equal(st(e, 'H2').lit, true, 'M1 run lamp lit');
  assert.equal(st(e, 'H3').lit, false, 'M2 lamp dark while timing');
  e.pressButton('S1', false);
  e.advance(2); // total 2s < 3s delay
  assert.equal(st(e, 'KM2').energized, false, 'timer not yet out');
  assert.equal(st(e, 'KM1').energized, true, 'KM1 held by seal');
  e.advance(1.5); // total 3.5s > 3s
  assert.equal(st(e, 'KT1').done, true, 'timer timed out');
  assert.equal(st(e, 'KM2').energized, true, 'KM2 started by timed contact');
  assert.ok(st(e, 'M1').speed > 0.6 && st(e, 'M2').speed > 0.5, 'both motors running');
  assert.equal(st(e, 'H3').lit, true);
});

test('timer: stop drops everything and resets the timer', () => {
  const e = load('timer-sequence');
  e.pressButton('S1');
  e.step(0.2);
  e.pressButton('S1', false);
  e.advance(4);
  assert.equal(st(e, 'KM2').energized, true);
  e.pressButton('S0');
  e.step(0.3);
  assert.equal(st(e, 'KM1').energized, false);
  assert.equal(st(e, 'KM2').energized, false, 'KM2 drops with KM1 (its coil fed from S1 node)');
  e.pressButton('S0', false);
  e.advance(1);
  assert.equal(st(e, 'KT1').done, false, 'timer reset');
  // restart: sequence begins again from M1
  e.pressButton('S1');
  e.step(0.2);
  e.pressButton('S1', false);
  e.advance(0.5);
  assert.equal(st(e, 'KM1').energized, true);
  assert.equal(st(e, 'KM2').energized, false, 'sequence restarts from the beginning');
});

// ---------------- reversing-starter ----------------

test('reversing: forward runs, reverse is interlocked, swap after stop', () => {
  const e = load('reversing-starter');
  e.pressButton('S1');
  e.step(0.2);
  assert.equal(st(e, 'KM1').energized, true, 'forward picks up');
  e.pressButton('S1', false);
  e.advance(2);
  assert.ok(st(e, 'M1').speed > 0.6, 'motor running forward');
  assert.equal(st(e, 'H1').lit, true);

  e.pressButton('S2'); // press reverse while running forward
  e.step(0.3);
  assert.equal(st(e, 'KM2').energized, false, 'reverse blocked by interlock');
  assert.equal(st(e, 'KM1').energized, true, 'forward unaffected');
  e.pressButton('S2', false);

  e.pressButton('S0'); // stop
  e.step(0.3);
  assert.equal(st(e, 'KM1').energized, false);
  e.pressButton('S0', false);
  e.advance(6);
  assert.ok(st(e, 'M1').speed < 0.06);

  e.pressButton('S2'); // now reverse
  e.step(0.2);
  assert.equal(st(e, 'KM2').energized, true, 'reverse picks up after stop');
  e.pressButton('S2', false);
  e.advance(2);
  assert.equal(st(e, 'H2').lit, true, 'reverse lamp lit');
  e.pressButton('S1'); // forward must now be blocked
  e.step(0.3);
  assert.equal(st(e, 'KM1').energized, false, 'forward blocked by reverse interlock');
});

test('reversing: overload trips and blocks both directions', () => {
  const e = load('reversing-starter');
  e.injectFault('stall', { target: 'M1' });
  e.pressButton('S1');
  e.step(0.2);
  e.pressButton('S1', false);
  e.advance(30);
  assert.equal(st(e, 'KK1').tripped, true);
  assert.equal(st(e, 'KM1').energized, false);
  e.pressButton('S2');
  e.step(0.3);
  assert.equal(st(e, 'KM2').energized, false, 'reverse also dead (95-96 in common feed)');
  e.pressButton('S2', false);
});

test('all four example circuits load with their wires intact', () => {
  for (const name of ['dol-starter', 'elevator-2floor', 'timer-sequence', 'reversing-starter']) {
    const e = load(name);
    const json = JSON.parse(fs.readFileSync(path.join(CIRCUITS, `${name}.json`), 'utf8'));
    assert.equal(e.components.size, json.components.length, `${name}: all components placed`);
    assert.equal(e.wires.length, json.wires.length, `${name}: all wires connected`);
  }
});
