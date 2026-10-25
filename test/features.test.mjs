// test/features.test.mjs — v1.2.0 operator features: VFD drive, pedals, brake,
// e-stop, 3-position selector, car call panel, floor indicator.
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

// ---------------- device unit tests ----------------

test('estop: NC pole opens and NO aux closes when tripped', () => {
  const e = new Engine();
  e.addComponent({ type: 'supply3', id: 'X1' });
  e.addComponent({ type: 'estop', id: 'SE1' });
  e.addComponent({ type: 'lamp', id: 'H1' }); // healthy lamp (via NC)
  e.addComponent({ type: 'lamp', id: 'H2' }); // trip lamp (via NO)
  for (const w of [['X1.L1', 'SE1.11'], ['SE1.12', 'H1.1'], ['X1.L1', 'SE1.13'], ['SE1.14', 'H2.1'], ['X1.N', 'H1.2'], ['X1.N', 'H2.2']])
    e.connect(...w);
  e.step(0.1);
  assert.equal(st(e, 'H1').lit, true, 'healthy chain closed through NC pole');
  assert.equal(st(e, 'H2').lit, false);

  e.setSwitch('SE1', false); // trip
  e.step(0.1);
  assert.equal(st(e, 'H1').lit, false, 'tripped e-stop opens the NC pole');
  assert.equal(st(e, 'H2').lit, true, 'tripped e-stop closes the NO aux');
  assert.ok(e.events.some(v => v.msg.includes('EMERGENCY STOP')), 'logs the trip');

  e.setSwitch('SE1', true); // twist-release
  e.step(0.1);
  assert.equal(st(e, 'H1').lit, true, 'twist-release restores the circuit');
});

test('selector3: 0 / I / II route COM to nothing / P1 / P2', () => {
  const e = new Engine();
  e.addComponent({ type: 'supply3', id: 'X1' });
  e.addComponent({ type: 'selector3', id: 'S3' });
  e.addComponent({ type: 'lamp', id: 'H1' });
  e.addComponent({ type: 'lamp', id: 'H2' });
  for (const w of [['X1.L1', 'S3.COM'], ['S3.P1', 'H1.1'], ['S3.P2', 'H2.1'], ['X1.N', 'H1.2'], ['X1.N', 'H2.2']])
    e.connect(...w);
  e.step(0.1);
  assert.equal(st(e, 'H1').lit, false);
  assert.equal(st(e, 'H2').lit, false);
  for (const [pos, h1, h2] of [['1', true, false], ['2', false, true], ['0', false, false], ['1', true, false]]) {
    e.setSelector('S3', pos);
    e.step(0.1);
    assert.equal(st(e, 'H1').lit, h1, `pos ${pos} -> H1`);
    assert.equal(st(e, 'H2').lit, h2, `pos ${pos} -> H2`);
  }
});

test('pedal: interlock pole closes above the cutoff, analog reference flows to a VFD', () => {
  const e = new Engine();
  e.addComponent({ type: 'supply3', id: 'X1' });
  e.addComponent({ type: 'pedal', id: 'P1' });
  e.addComponent({ type: 'lamp', id: 'H1' });
  for (const w of [['X1.L1', 'P1.13'], ['P1.14', 'H1.1'], ['X1.N', 'H1.2']])
    e.connect(...w);
  e.setPedal('P1', 0.03);
  e.step(0.1);
  assert.equal(st(e, 'H1').lit, false, 'below cutoff the interlock pole is open');
  e.setPedal('P1', 0.1);
  e.step(0.1);
  assert.equal(st(e, 'H1').lit, true, 'above cutoff the interlock pole closes');
  assert.equal(st(e, 'P1').value, 0.1);
});

test('floorselector: selecting a floor closes exactly that contact', () => {
  const e = new Engine();
  e.addComponent({ type: 'supply3', id: 'X1' });
  e.addComponent({ type: 'floorselector', id: 'CS1', params: { floors: 10 } });
  e.addComponent({ type: 'lamp', id: 'H3' });
  for (const w of [['X1.L1', 'CS1.COM'], ['CS1.3', 'H3.1'], ['X1.N', 'H3.2']])
    e.connect(...w);
  e.setSelector('CS1', 3);
  e.step(0.1);
  assert.equal(st(e, 'H3').lit, true, 'floor 3 selected closes COM-3');
  e.setSelector('CS1', 4);
  e.step(0.1);
  assert.equal(st(e, 'H3').lit, false, 'moving the selection opens COM-3');
  e.setSelector('CS1', 0);
  e.step(0.1);
  assert.equal(st(e, 'H3').lit, false, 'cancelling keeps everything open');
});

test('floordisplay: shows the energized input, E when ambiguous', () => {
  const e = new Engine();
  e.addComponent({ type: 'supply3', id: 'X1' });
  e.addComponent({ type: 'floordisplay', id: 'FD1' });
  for (const w of [['X1.L1', 'FD1.3'], ['X1.N', 'FD1.N']])
    e.connect(...w);
  e.step(0.1);
  assert.equal(st(e, 'FD1').floor, 3, 'digit 3 when only input 3 is hot');
  e.connect('X1.L1', 'FD1.7');
  e.step(0.1);
  assert.equal(st(e, 'FD1').floor, -1, 'ambiguous inputs show E');
});

test('vfd: manual ref parameter drives speed without a pedal', () => {
  const e = new Engine();
  e.addComponent({ type: 'supply3', id: 'X1' });
  e.addComponent({ type: 'vfd', id: 'U1' });
  e.addComponent({ type: 'motor3', id: 'M1' });
  for (const w of [['X1.L1', 'U1.L1'], ['X1.L2', 'U1.L2'], ['X1.L3', 'U1.L3'],
    ['U1.U', 'M1.U'], ['U1.V', 'M1.V'], ['U1.W', 'M1.W'],
    ['X1.L1', 'U1.FWD'], ['X1.N', 'U1.COM']])
    e.connect(...w);
  e.setParam('U1', 'ref', 0.4);
  e.advance(4);
  assert.equal(st(e, 'U1').running, true);
  assert.equal(st(e, 'U1').dir, 1);
  assert.ok(Math.abs(st(e, 'U1').freq - 20) < 3, `freq ramps to 40% of 50 Hz (got ${st(e, 'U1').freq})`);
  assert.ok(Math.abs(st(e, 'M1').speed - 0.4) < 0.08, `motor follows the drive at 40% (got ${st(e, 'M1').speed.toFixed(2)})`);
  assert.equal(st(e, 'M1').dir, 1);
});

test('vfd: FWD and REV together = fault, no output', () => {
  const e = new Engine();
  e.addComponent({ type: 'supply3', id: 'X1' });
  e.addComponent({ type: 'vfd', id: 'U1' });
  e.addComponent({ type: 'motor3', id: 'M1' });
  for (const w of [['X1.L1', 'U1.L1'], ['X1.L2', 'U1.L2'], ['X1.L3', 'U1.L3'],
    ['U1.U', 'M1.U'], ['U1.V', 'M1.V'], ['U1.W', 'M1.W'],
    ['X1.L1', 'U1.FWD'], ['X1.L2', 'U1.REV'], ['X1.N', 'U1.COM']])
    e.connect(...w);
  e.setParam('U1', 'ref', 0.8);
  e.advance(2);
  assert.equal(st(e, 'U1').fault, 'FWD+REV', 'direction conflict fault');
  assert.equal(st(e, 'U1').running, false);
  assert.equal(st(e, 'M1').speed, 0, 'no output, motor never spins');
  assert.ok(e.events.some(v => v.msg.includes('FAULT')), 'fault is logged');
});

test('vfd: direction reversal plugs the motor through zero', () => {
  const e = new Engine();
  e.addComponent({ type: 'supply3', id: 'X1' });
  e.addComponent({ type: 'vfd', id: 'U1' });
  e.addComponent({ type: 'motor3', id: 'M1' });
  e.addComponent({ type: 'selector3', id: 'SD' });
  for (const w of [['X1.L1', 'U1.L1'], ['X1.L2', 'U1.L2'], ['X1.L3', 'U1.L3'],
    ['U1.U', 'M1.U'], ['U1.V', 'M1.V'], ['U1.W', 'M1.W'],
    ['X1.L1', 'SD.COM'], ['SD.P1', 'U1.FWD'], ['SD.P2', 'U1.REV'], ['X1.N', 'U1.COM']])
    e.connect(...w);
  e.setParam('U1', 'ref', 0.6);
  e.setSelector('SD', '1');
  e.advance(3);
  assert.ok(st(e, 'M1').speed > 0.4, `forward (got ${st(e, 'M1').speed.toFixed(2)})`);
  e.setSelector('SD', '2');
  e.advance(2.5);
  assert.ok(st(e, 'M1').speed < -0.4, `plugged through zero and spun up reverse (got ${st(e, 'M1').speed.toFixed(2)})`);
  assert.equal(st(e, 'M1').dir, -1);
});

test('pedal state survives serialize / loadCircuit round-trip', () => {
  const e = new Engine();
  e.loadCircuit(JSON.parse(fs.readFileSync(path.join(CIRCUITS, 'vehicle-drive.json'), 'utf8')), 'vehicle-drive');
  e.step(0.1);
  e.setPedal('P1', 0.55);
  e.setSwitch('SE1', false);
  e.setSelector('SD', '2');
  const json = e.serialize('rt');
  const e2 = new Engine();
  e2.loadCircuit(json, 'rt');
  assert.equal(st(e2, 'P1').value, 0.55, 'pedal travel restored');
  assert.equal(st(e2, 'SE1').pressed, true, 'tripped e-stop restored');
  assert.equal(st(e2, 'SD').pos, '2', 'selector position restored');
});

// ---------------- vehicle-drive example circuit ----------------

test('vehicle: throttle 50% forward — drive at half speed', () => {
  const e = load('vehicle-drive');
  e.setSelector('SD', 1);
  e.setPedal('P1', 0.5);
  e.advance(4);
  assert.equal(st(e, 'U1').running, true);
  assert.equal(st(e, 'U1').dir, 1);
  assert.ok(Math.abs(st(e, 'U1').freq - 25) < 3, `25 Hz (got ${st(e, 'U1').freq})`);
  assert.ok(Math.abs(st(e, 'M1').speed - 0.5) < 0.1, `motor at ~50% (got ${st(e, 'M1').speed.toFixed(2)})`);
});

test('vehicle: brake stops the motor, lights the brake lamps, drops the drive', () => {
  const e = load('vehicle-drive');
  e.setSelector('SD', 1);
  e.setPedal('P1', 1);
  e.advance(4);
  assert.ok(st(e, 'M1').speed > 0.7, 'cruising');
  assert.equal(st(e, 'H2').lit, false);
  e.setPedal('P2', 1);
  e.advance(2.5);
  assert.ok(Math.abs(st(e, 'M1').speed) < 0.05, `braked to a standstill (got ${st(e, 'M1').speed.toFixed(3)})`);
  assert.equal(st(e, 'H2').lit, true, 'brake lamp lit');
  assert.equal(st(e, 'H3').lit, true, 'second brake lamp lit');
  assert.equal(st(e, 'U1').running, false, 'NC brake pole cut the drive command');
});

test('vehicle: e-stop kills the control chain and trips its lamp', () => {
  const e = load('vehicle-drive');
  e.setSelector('SD', 1);
  e.setPedal('P1', 0.7);
  e.advance(3);
  assert.equal(st(e, 'U1').running, true);
  e.setSwitch('SE1', false);
  e.advance(1);
  assert.equal(st(e, 'U1').running, false, 'drive output off');
  assert.equal(st(e, 'H4').lit, true, 'e-stop lamp lit');
  assert.ok(Math.abs(st(e, 'M1').speed) < 0.5, `motor coasting down (got ${st(e, 'M1').speed.toFixed(2)})`);
  e.setSwitch('SE1', true); // twist-release
  e.advance(2);
  assert.equal(st(e, 'U1').running, true, 'released e-stop lets the drive pick back up');
});

test('vehicle: pedal below cutoff blocks the drive (dead-man interlock)', () => {
  const e = load('vehicle-drive');
  e.setSelector('SD', 1);
  e.setPedal('P1', 0.03); // below the 5% cutoff
  e.advance(2);
  assert.equal(st(e, 'U1').running, false, 'interlock pole open — no drive command');
  e.setPedal('P1', 0.4);
  e.advance(3);
  assert.equal(st(e, 'U1').running, true, 'foot on the pedal enables the drive');
});

// ---------------- elevator-cop example circuit ----------------

test('cop: floor indicator follows the car position', () => {
  const e = load('elevator-cop');
  assert.equal(st(e, 'FD1').floor, 1, 'idle at floor 1');
  e.setPosition('CAM1', 4);
  e.step(0.1);
  assert.equal(st(e, 'FD1').floor, 4, 'digit tracks the isolated indicator deck');
});

test('cop: car call from the panel dispatches and serves the floor', () => {
  const e = load('elevator-cop');
  e.setSelector('CS1', 5);
  e.advance(2.2);
  assert.equal(st(e, 'K5').energized, true, 'car call 5 latched the floor relay');
  assert.equal(st(e, 'KM_run').energized, true, 'dispatched');
  assert.equal(st(e, 'FD1').up, true, 'up arrow lit while travelling');
  for (let f = 2; f <= 5; f++) { e.setPosition('CAM1', f); e.advance(0.3); }
  assert.equal(st(e, 'KM_run').energized, false, 'arrived — run contactor dropped');
  assert.equal(st(e, 'FD1').floor, 5, 'indicator shows floor 5');
  assert.equal(st(e, 'FD1').up, false, 'arrow released');
});

test('cop: held car call keeps the floor relay in until cancelled', () => {
  const e = load('elevator-cop');
  e.setSelector('CS1', 5);
  e.advance(2.2);
  for (let f = 2; f <= 5; f++) { e.setPosition('CAM1', f); e.advance(0.3); }
  assert.equal(st(e, 'K5').energized, true, 'maintained call keeps K5 in');
  e.setSelector('CS1', 0); // cancel
  e.step(0.1);
  assert.equal(st(e, 'K5').energized, false, 'cancelling the call drops the relay');
});

test('cop: emergency stop drops the whole control chain mid-travel', () => {
  const e = load('elevator-cop');
  e.setSelector('CS1', 8);
  e.advance(2.2);
  assert.equal(st(e, 'KM_run').energized, true);
  e.setPosition('CAM1', 3);
  e.setSwitch('SE1', false);
  e.advance(0.5);
  assert.equal(st(e, 'KM_run').energized, false, 'run contactor dropped');
  assert.equal(st(e, 'KM_up').energized, false, 'direction contactor dropped');
  assert.equal(st(e, 'K8').energized, false, 'call relays dropped');
  assert.equal(st(e, 'FD1').floor, 0, 'indicator dark (control power gone)');
});

test('cop: original hall buttons still work alongside the car panel', () => {
  const e = load('elevator-cop');
  e.pressButton('S3');
  e.advance(2.2);
  assert.equal(st(e, 'K3').energized, true, 'hall call 3 latched');
  assert.equal(st(e, 'KM_run').energized, true, 'dispatched');
});
