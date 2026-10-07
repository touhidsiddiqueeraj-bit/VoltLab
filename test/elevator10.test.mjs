// test/elevator10.test.mjs — the 10-story relay elevator.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Engine } from '../sim/engine.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const j = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'circuits', 'elevator-10floor.json'), 'utf8'));

function load() {
  const e = new Engine();
  e.loadCircuit(j, 'elevator-10floor');
  e.step(0.1);
  return e;
}
const st = (e, id) => e.components.get(id).state;
const travel = (e, from, to) => {
  const step = from < to ? 1 : -1;
  for (let f = from + step; f !== to + step; f += step) {
    e.setPosition('CAM1', f);
    e.step(0.15);
  }
};

test('idle car: no calls, nothing runs', () => {
  const e = load();
  assert.equal(st(e, 'KM_run').energized, false);
  assert.equal(st(e, 'KP').energized, false);
  assert.equal(st(e, 'M1').speed, 0);
});

test('call registers, car runs, serves the floor and resets', () => {
  const e = load();
  e.pressButton('S5');
  e.advance(2); // 1.5s dispatch dwell + relay chain
  assert.equal(st(e, 'K5').energized, true, 'call 5 latched');
  assert.equal(st(e, 'H5').lit, true, 'floor 5 lamp lit');
  assert.equal(st(e, 'KM_run').energized, true, 'run contactor engaged');
  assert.equal(st(e, 'KM_up').energized, true, 'up contactor engaged (SelUp on)');
  e.pressButton('S5', false);
  e.advance(2);
  assert.equal(st(e, 'KM_run').energized, true, 'still running mid-shaft');
  assert.equal(st(e, 'K5').energized, true, 'call held while traveling');
  travel(e, 1, 5);
  e.step(0.3);
  assert.equal(st(e, 'KM_run').energized, false, 'stopped at floor 5');
  assert.equal(st(e, 'K5').energized, false, 'call auto-reset on arrival');
  assert.equal(st(e, 'H5').lit, false);
  e.advance(6);
  assert.ok(st(e, 'M1').speed < 0.06, 'motor coasted down');
  e.advance(2);
  assert.equal(st(e, 'KM_run').energized, false, 'car holds with no pending calls');
});

test('pending calls re-dispatch automatically after a stop', () => {
  const e = load();
  e.pressButton('S8'); e.advance(2); e.pressButton('S8', false);
  e.pressButton('S9'); e.advance(2); e.pressButton('S9', false);
  assert.equal(st(e, 'KM_run').energized, true);
  travel(e, 1, 8);
  e.advance(0.6);
  assert.equal(st(e, 'KM_run').energized, false, 'stopped at 8 (dwell)');
  assert.equal(st(e, 'K8').energized, false, 'floor 8 served and reset');
  assert.equal(st(e, 'K9').energized, true, 'floor 9 call still pending');
  e.advance(2);
  assert.equal(st(e, 'KM_run').energized, true, 'auto re-dispatch toward 9 after dwell');
  assert.ok(st(e, 'M1').speed > 0.2, 'motor running again');
  travel(e, 8, 9);
  e.advance(0.6);
  e.advance(3);
  assert.equal(st(e, 'K9').energized, false, 'floor 9 served');
  assert.equal(st(e, 'KM_run').energized, false, 'holds at 9 — no calls left');
});

test('down direction via SelDn', () => {
  const e = load();
  e.setSwitch('SelUp', false);
  e.setSwitch('SelDn', true);
  e.step(0.1);
  e.pressButton('S3');
  e.advance(2);
  e.pressButton('S3', false);
  assert.equal(st(e, 'KM_dn').energized, true, 'down contactor engaged');
  assert.equal(st(e, 'KM_up').energized, false, 'up contactor off');
  travel(e, 1, 3);
  e.step(0.3);
  assert.equal(st(e, 'KM_run').energized, false);
  assert.equal(st(e, 'K3').energized, false);
});

test('calls for the car\'s current floor cannot register (car is there)', () => {
  const e = load();
  e.setPosition('CAM1', 7);
  e.step(0.1);
  e.pressButton('S7');
  e.step(0.2);
  assert.equal(st(e, 'K7').energized, false, 'deck B opens the own-floor register path');
  assert.equal(st(e, 'KM_run').energized, false);
});

test('overload kills the run regardless of pending calls', () => {
  const e = load();
  e.pressButton('S5'); e.step(0.2); e.pressButton('S5', false);
  e.advance(0.5);
  e.injectFault('stall', { target: 'M1' });
  e.advance(35);
  assert.equal(st(e, 'KK1').tripped, true, 'overload tripped');
  assert.equal(st(e, 'KM_run').energized, false, 'run contactor dropped (95-96 kills control feed)');
  e.pressButton('S9');
  e.advance(2);
  e.pressButton('S9', false);
  assert.equal(st(e, 'KM_run').energized, false, 'no re-dispatch while tripped');
});
