// sim/engine.js — electrical control circuit simulation engine.
// Environment-agnostic (no DOM): runs in Node (tests, host server, Electron main) and browser.

import { DEVICE_TYPES } from './devices.js';

const TICK = 0.1; // default sim tick, seconds

class DSU {
  constructor(n) {
    this.p = new Array(n);
    for (let i = 0; i < n; i++) this.p[i] = i;
  }
  find(x) {
    while (this.p[x] !== x) { this.p[x] = this.p[this.p[x]]; x = this.p[x]; }
    return x;
  }
  union(a, b) {
    a = this.find(a); b = this.find(b);
    if (a !== b) this.p[b] = a;
  }
}

let idCounter = 0;

export class Engine {
  constructor() {
    this.components = new Map(); // id -> comp
    this.wires = [];             // {id, from, to}  from/to = "Comp.Term"
    this.t = 0;
    this.running = false;
    this.tickRate = TICK;
    this.circuitName = '(empty)';
    this.circuitJson = null;     // last loaded circuit, for sim reset
    this.faults = {};            // {phase_loss:{phase}, overload:{target,multiplier}, stall:{target}, short_circuit:{target}}
    this.events = [];            // [{t, level, msg}]
    this.version = 0;            // bumps on any state change (for SSE diffing)
    this._idSeed = {};
    this._loading = false;
  }

  // When the realtime loop is paused, interaction commands re-evaluate the
  // circuit immediately so agents and UI never read a stale state.
  maybeStep() {
    if (!this.running && !this._loading) this.step(this.tickRate);
  }

  log(msg, level = 'info') {
    this.events.push({ t: Math.round(this.t * 10) / 10, level, msg });
    if (this.events.length > 500) this.events.splice(0, this.events.length - 500);
    this.version++;
  }

  // ---------- circuit editing ----------

  _nextId(type) {
    const base = { breaker3: 'Q', breaker1: 'Q', fuse3: 'F', fuse1: 'F', contactor: 'KM',
      overload: 'KK', motor3: 'M', pushbutton_no: 'S', pushbutton_nc: 'S', selector2: 'S', selector3: 'S',
      timer_on: 'KT', lamp: 'H', buzzer: 'B', supply3: 'X', junction: 'J', estop: 'SE',
      pedal: 'P', brake: 'P', vfd: 'U', floorselector: 'CS', floordisplay: 'FD', cam10: 'CAM' }[type] || 'K';
    const n = (this._idSeed[base] = (this._idSeed[base] || 0) + 1);
    let id = `${base}${n}`;
    while (this.components.has(id)) id = `${base}${++this._idSeed[base]}`;
    return id;
  }

  addComponent(def = {}) {
    const type = def.type;
    if (!DEVICE_TYPES[type]) throw new Error(`unknown component type "${type}" (have: ${Object.keys(DEVICE_TYPES).join(', ')})`);
    let id = def.id || this._nextId(type);
    if (this.components.has(id)) throw new Error(`component id "${id}" already exists`);
    const spec = DEVICE_TYPES[type];
    const params = {};
    if (spec.params) for (const [k, v] of Object.entries(spec.params)) params[k] = v.value;
    Object.assign(params, def.params || {});
    const state = {};
    if (spec.state) for (const [k, v] of Object.entries(spec.state)) state[k] = Array.isArray(v) ? [...v] : v;
    Object.assign(state, def.state || {});
    const comp = {
      id, type,
      label: def.label || params.label || spec.defaults.label || id,
      x: def.x ?? 60, y: def.y ?? 60,
      params, state,
      _internal: {}
    };
    if (comp.label === id && def.id) comp.label = def.id;
    this.components.set(id, comp);
    this.version++;
    this.log(`added ${spec.label} "${comp.label}" (${comp.id})`);
    this.maybeStep();
    return comp;
  }

  removeComponent(id) {
    const comp = this.components.get(id);
    if (!comp) throw new Error(`no component "${id}"`);
    this.wires = this.wires.filter(w => {
      const [fa] = w.from.split('.'), [ta] = w.to.split('.');
      return fa !== id && ta !== id;
    });
    this.components.delete(id);
    this.version++;
    this.log(`removed component "${id}"`, 'warn');
    this.maybeStep();
  }

  moveComponent(id, x, y) {
    const comp = this.components.get(id);
    if (!comp) throw new Error(`no component "${id}"`);
    comp.x = Math.round(x); comp.y = Math.round(y);
    this.version++;
  }

  _parseTerm(ref) {
    const dot = ref.lastIndexOf('.');
    if (dot < 1) throw new Error(`terminal reference "${ref}" must look like "Q1.L1"`);
    const compId = ref.slice(0, dot), term = ref.slice(dot + 1);
    const comp = this.components.get(compId);
    if (!comp) throw new Error(`no component "${compId}"`);
    if (!(term in DEVICE_TYPES[comp.type].terminals)) {
      throw new Error(`component "${compId}" (${comp.type}) has no terminal "${term}" (has: ${Object.keys(DEVICE_TYPES[comp.type].terminals).join(', ')})`);
    }
    return { comp, term };
  }

  connect(fromRef, toRef, waypoints = null) {
    const a = this._parseTerm(fromRef), b = this._parseTerm(toRef);
    if (fromRef === toRef) throw new Error('cannot wire a terminal to itself');
    if (this.wires.some(w => (w.from === fromRef && w.to === toRef) || (w.from === toRef && w.to === fromRef))) {
      throw new Error(`wire ${fromRef}–${toRef} already exists`);
    }
    const wire = { id: `w${++idCounter}`, from: fromRef, to: toRef };
    if (Array.isArray(waypoints) && waypoints.length) {
      wire.waypoints = waypoints.map(([x, y]) => [Math.round(x), Math.round(y)]);
    }
    this.wires.push(wire);
    this.version++;
    this.log(`wired ${fromRef} → ${toRef}`);
    this.maybeStep();
    return wire;
  }

  disconnect(fromRef, toRef) {
    const before = this.wires.length;
    this.wires = this.wires.filter(w =>
      !((w.from === fromRef && w.to === toRef) || (w.from === toRef && w.to === fromRef)));
    if (this.wires.length === before) throw new Error(`no wire ${fromRef}–${toRef}`);
    this.version++;
    this.log(`unwired ${fromRef}–${toRef}`, 'warn');
    this.maybeStep();
  }

  listTerminals(id) {
    const comp = this.components.get(id);
    if (!comp) throw new Error(`no component "${id}"`);
    return Object.entries(DEVICE_TYPES[comp.type].terminals)
      .map(([name, pos]) => ({ name, x: comp.x + pos.x, y: comp.y + pos.y }));
  }

  // ---------- interaction ----------

  pressButton(id, pressed = true) {
    const c = this.components.get(id);
    if (!c) throw new Error(`no component "${id}"`);
    if (c.type !== 'pushbutton_no' && c.type !== 'pushbutton_nc') throw new Error(`"${id}" is a ${c.type}, not a push button`);
    if (c.state.pressed !== pressed) {
      c.state.pressed = pressed;
      this.log(`${c.label} ${c.type === 'pushbutton_nc' ? 'STOP' : 'START'} button ${pressed ? 'PRESSED' : 'RELEASED'}`);
    }
    this.maybeStep();
  }

  setSwitch(id, closed) {
    const c = this.components.get(id);
    if (!c) throw new Error(`no component "${id}"`);
    if (c.type === 'breaker3' || c.type === 'breaker1') {
      if (c.state.closed !== closed) {
        c.state.closed = closed;
        this.log(`breaker ${c.label} ${closed ? 'CLOSED (ON)' : 'OPENED (OFF)'}`);
      }
    } else if (c.type === 'selector2') {
      c.state.pos = closed ? '1' : '0';
      this.log(`selector ${c.label} → position ${closed ? 'I' : '0'}`);
    } else if (c.type === 'estop') {
      if (c.state.pressed !== !closed) {
        c.state.pressed = !closed;
        this.log(c.state.pressed
          ? `EMERGENCY STOP ${c.label} TRIPPED — NC pole open`
          : `emergency stop ${c.label} released (twist-reset)`, 'fault');
      }
    } else {
      throw new Error(`"${id}" is a ${c.type}, not a switch`);
    }
    this.maybeStep();
  }

  // Multi-position selectors: selector3 ('0'|'1'|'2'), floorselector (floor number,
  // 0 = no call), cam10 alias (1..10). selector2 also accepted.
  setSelector(id, pos) {
    const c = this.components.get(id);
    if (!c) throw new Error(`no component "${id}"`);
    if (c.type === 'selector3' || c.type === 'selector2') {
      const p = String(pos);
      if (!['0', '1', '2'].includes(p) || (c.type === 'selector2' && p === '2')) {
        throw new Error(`position must be ${c.type === 'selector3' ? '0, 1 or 2' : '0 or 1'}`);
      }
      c.state.pos = p;
      this.log(`selector ${c.label} → position ${p === '0' ? '0' : p === '1' ? 'I' : 'II'}`);
    } else if (c.type === 'floorselector') {
      const f = Math.round(Number(pos));
      const max = Math.min(10, Math.max(2, c.params.floors ?? 10));
      if (!(f >= 0 && f <= max)) throw new Error(`floor must be 0..${max} (0 = cancel call)`);
      if (c.state.floor !== f) {
        c.state.floor = f;
        this.log(f ? `car call: floor ${f} registered on ${c.label}` : `car call cancelled on ${c.label}`);
      }
    } else if (c.type === 'cam10') {
      return this.setPosition(id, pos);
    } else {
      throw new Error(`"${id}" is a ${c.type}, not a multi-position selector`);
    }
    this.version++;
    this.maybeStep();
  }

  // Analog pedal position (accelerator or brake), 0..1.
  setPedal(id, value) {
    const c = this.components.get(id);
    if (!c) throw new Error(`no component "${id}"`);
    if (c.type !== 'pedal' && c.type !== 'brake') throw new Error(`"${id}" is a ${c.type}, not a pedal`);
    const v = Math.max(0, Math.min(1, Number(value)));
    if (Number.isNaN(v)) throw new Error('pedal value must be a number 0..1');
    const wasApplied = (c.state.value || 0) > 0.02;
    c.state.value = Math.round(v * 1000) / 1000;
    const applied = c.state.value > 0.02;
    if (applied !== wasApplied) {
      this.log(`${c.label} ${c.type === 'brake' ? 'BRAKE' : 'pedal'} ${applied ? `applied (${Math.round(c.state.value * 100)}%)` : 'released'}`,
        c.type === 'brake' && applied ? 'warn' : 'info');
    }
    this.version++;
    this.maybeStep();
  }

  setParam(id, param, value) {
    const c = this.components.get(id);
    if (!c) throw new Error(`no component "${id}"`);
    const spec = DEVICE_TYPES[c.type].params;
    if (!spec || !(param in spec)) {
      throw new Error(`"${id}" (${c.type}) has no parameter "${param}" (has: ${spec ? Object.keys(spec).join(', ') : 'none'})`);
    }
    const num = Number(value);
    if (Number.isNaN(num)) throw new Error(`parameter ${param} must be a number, got "${value}"`);
    c.params[param] = num;
    this.version++;
    this.log(`${c.label}.${param} = ${num}${spec[param].unit ? ' ' + spec[param].unit : ''}`);
    this.maybeStep();
  }

  setPosition(id, position) {
    const c = this.components.get(id);
    if (!c) throw new Error(`no component "${id}"`);
    if (c.type !== 'cam10') throw new Error(`"${id}" is a ${c.type}, not a floor cam`);
    const pos = Math.round(Number(position));
    if (!(pos >= 1 && pos <= 10)) throw new Error('position must be 1..10');
    if (c.state.position !== pos) {
      c.state.position = pos;
      this.log(`${c.label} car position → floor ${pos}`);
    }
    this.version++;
    this.maybeStep();
  }

  resetOverload(id) {
    const c = this.components.get(id);
    if (!c) throw new Error(`no component "${id}"`);
    if (c.type !== 'overload') throw new Error(`"${id}" is a ${c.type}, not an overload relay`);
    if (c.state.tripped) {
      c.state.tripped = false;
      c._internal.thermal = 0;
      this.log(`overload ${c.label} RESET`, 'warn');
    }
    this.version++;
    this.maybeStep();
  }

  replaceFuses(id) {
    const targets = id ? [this.components.get(id)] : [...this.components.values()];
    let n = 0;
    for (const c of targets) {
      if (!c) throw new Error(`no component "${id}"`);
      if (c.type === 'fuse3') { if (c.state.blown.some(b => b)) { c.state.blown = [false, false, false]; n++; this.log(`fuses ${c.label} replaced`, 'warn'); } }
      else if (c.type === 'fuse1') { if (c.state.blown) { c.state.blown = false; n++; this.log(`fuse ${c.label} replaced`, 'warn'); } }
    }
    if (n === 0 && id) throw new Error(`"${id}" has no blown fuses`);
    this.version++;
    this.maybeStep();
    return n;
  }

  injectFault(type, opts = {}) {
    switch (type) {
      case 'phase_loss': {
        const phase = opts.phase || 'L2';
        if (!['L1', 'L2', 'L3'].includes(phase)) throw new Error('phase must be L1, L2 or L3');
        this.faults.phase_loss = { phase };
        this.log(`FAULT injected: phase loss on ${phase}`, 'fault');
        break;
      }
      case 'overload': {
        const target = opts.target;
        if (!target || !this.components.get(target)) throw new Error('overload fault needs a target motor id');
        const multiplier = Number(opts.multiplier) || 2.5;
        this.faults.overload = { target, multiplier };
        this.log(`FAULT injected: mechanical overload on ${target} (load x${multiplier})`, 'fault');
        break;
      }
      case 'stall': {
        const target = opts.target;
        if (!target || !this.components.get(target)) throw new Error('stall fault needs a target motor id');
        this.faults.stall = { target };
        this.log(`FAULT injected: rotor stall (jam) on ${target}`, 'fault');
        break;
      }
      case 'short_circuit': {
        const target = opts.target;
        if (!target || !this.components.get(target)) throw new Error('short_circuit fault needs a target component id');
        this.faults.short_circuit = { target };
        this.log(`FAULT injected: short circuit at ${target}`, 'fault');
        break;
      }
      default:
        throw new Error(`unknown fault type "${type}" (have: phase_loss, overload, stall, short_circuit)`);
    }
    this.version++;
    this.maybeStep();
  }

  clearFault(type) {
    if (type && !this.faults[type]) throw new Error(`no active fault "${type}" (active: ${Object.keys(this.faults).join(', ') || 'none'})`);
    if (type) {
      delete this.faults[type];
      this.log(`FAULT cleared: ${type}`, 'warn');
    } else {
      const had = Object.keys(this.faults);
      this.faults = {};
      if (had.length) this.log(`FAULTS cleared: ${had.join(', ')}`, 'warn');
    }
    this.version++;
    this.maybeStep();
  }

  // ---------- circuit persistence ----------

  serialize(name) {
    return {
      name: name || this.circuitName,
      description: '',
      components: [...this.components.values()].map(c => {
        const persist = {};
        if ('closed' in c.state) persist.closed = c.state.closed;
        if ('blown' in c.state) persist.blown = Array.isArray(c.state.blown) ? [...c.state.blown] : c.state.blown;
        if ('pos' in c.state) persist.pos = c.state.pos;
        if ('energized' in c.state) persist.energized = c.state.energized;
        if ('done' in c.state) persist.done = c.state.done;
        if ('value' in c.state) persist.value = c.state.value;
        if ('floor' in c.state) persist.floor = c.state.floor;
        if (c.type === 'estop' && c.state.pressed) persist.pressed = true;
        if (c.type === 'overload' && c.state.tripped) persist.tripped = true;
        return { id: c.id, type: c.type, label: c.label, x: c.x, y: c.y, params: { ...c.params }, ...(Object.keys(persist).length ? { state: persist } : {}) };
      }),
      wires: this.wires.map(w => ({ from: w.from, to: w.to, ...(w.waypoints ? { waypoints: w.waypoints } : {}) }))
    };
  }

  loadCircuit(json, name) {
    if (!json || !Array.isArray(json.components)) throw new Error('circuit JSON must have a components array');
    this._loading = true;
    this.components.clear();
    this.wires = [];
    this.faults = {};
    this.events = [];
    this._idSeed = {};
    this.t = 0;
    this.circuitName = name || json.name || 'circuit';
    this.circuitJson = json;
    for (const def of json.components) {
      try { this.addComponent(def); }
      catch (e) { this.log(`skipped component: ${e.message}`, 'warn'); }
    }
    for (const w of json.wires || []) {
      try { this.connect(w.from, w.to, w.waypoints); }
      catch (e) { this.log(`skipped wire ${w.from}–${w.to}: ${e.message}`, 'warn'); }
    }
    // resolve label duplicates: components with explicit id keep id as label source
    for (const c of this.components.values()) if (!c.label) c.label = c.id;
    this._loading = false;
    this.log(`circuit "${this.circuitName}" loaded (${this.components.size} components, ${this.wires.length} wires)`);
    this.maybeStep();
    return this.circuitName;
  }

  resetSim() {
    if (this.circuitJson) {
      this.loadCircuit(this.circuitJson, this.circuitName);
    } else {
      this.clearCircuit();
    }
  }

  clearCircuit() {
    this.components.clear();
    this.wires = [];
    this.faults = {};
    this.t = 0;
    this.circuitName = '(empty)';
    this.circuitJson = null;
    this.log('circuit cleared');
  }

  // ---------- simulation step ----------

  step(dt = this.tickRate) {
    const comps = [...this.components.values()];

    // ---- 1. terminal index + union-find over wires and conducting poles ----
    const termKeys = [];
    const termIdx = new Map();
    for (const c of comps) {
      for (const t of Object.keys(DEVICE_TYPES[c.type].terminals)) {
        termIdx.set(`${c.id}.${t}`, termKeys.length);
        termKeys.push(`${c.id}.${t}`);
      }
    }
    let dsu = new DSU(termKeys.length);
    let rootPhases = new Map();
    let rootAnalog = new Map(); // root -> analog level 0..1 (pedal references)
    const seed = (term, phase) => {
      const root = dsu.find(termIdx.get(term));
      if (!rootPhases.has(root)) rootPhases.set(root, new Set());
      rootPhases.get(root).add(phase);
    };

    // Rebuilds the netlist from the CURRENT device states. Real contactors act
    // sequentially: the one that picks up first immediately opens its NC aux, so
    // an electrically cross-interlocked pair can never energize together. The
    // solver mirrors that: whenever a coil changes state mid-tick, the netlist
    // is rebuilt before the next device in the same tick is evaluated.
    const buildNets = () => {
      dsu = new DSU(termKeys.length);
      const U = (a, b) => dsu.union(termIdx.get(a), termIdx.get(b));
      for (const w of this.wires) U(w.from, w.to);
      for (const c of comps) {
        for (const [a, b] of conductingPoles(c)) U(`${c.id}.${a}`, `${c.id}.${b}`);
      }
      rootPhases = new Map();
      rootAnalog = new Map();
      for (const c of comps) {
        if (c.type === 'supply3') {
          const lost = this.faults.phase_loss?.phase;
          for (const p of ['L1', 'L2', 'L3', 'N']) {
            if (p === lost) continue;
            seed(`${c.id}.${p}`, p);
          }
        } else if (c.type === 'pedal') {
          // analog 0-100% reference, seeded like a supply phase (0-10 V on R+)
          const root = dsu.find(termIdx.get(`${c.id}.R+`));
          rootAnalog.set(root, c.state.value || 0);
        } else if (c.type === 'vfd' && c.state.running && c.state.dir) {
          // the drive synthesizes its own rotating field on U/V/W
          const fwd = c.state.dir > 0;
          seed(`${c.id}.U`, `${c.id}.a`);
          seed(`${c.id}.V`, `${c.id}.${fwd ? 'b' : 'c'}`);
          seed(`${c.id}.W`, `${c.id}.${fwd ? 'c' : 'b'}`);
        }
      }
    };
    buildNets();

    const phasesOf = (ref) => rootPhases.get(dsu.find(termIdx.get(ref))) || EMPTY_SET;
    const analogOf = (ref) => {
      const v = rootAnalog.get(dsu.find(termIdx.get(ref)));
      return v === undefined ? 0 : v;
    };
    const across = (a, b) => {
      const A = phasesOf(a), B = phasesOf(b);
      if (!A.size || !B.size) return false;
      for (const p of A) if (!B.has(p)) return true; // distinct phases = potential difference
      return false;
    };
    const connected = (a, b) => dsu.find(termIdx.get(a)) === dsu.find(termIdx.get(b));

    // ---- 2. evaluate devices against this tick's netlist ----
    for (const c of comps) {
      switch (c.type) {
        case 'contactor': {
          const v = across(`${c.id}.A1`, `${c.id}.A2`);
          if (v !== c.state.energized) {
            c.state.energized = v;
            this.log(`${c.label} coil ${v ? 'ENERGIZED' : 'DROPPED'}`, v ? 'info' : 'warn');
            buildNets(); // poles changed — later devices see the new circuit
          }
          break;
        }
        case 'timer_on': {
          const v = across(`${c.id}.A1`, `${c.id}.A2`);
          if (v) {
            c._internal.elapsed = (c._internal.elapsed || 0) + dt;
            if (!c.state.done && c._internal.elapsed >= (c.params.delay ?? 3)) {
              c.state.done = true;
              this.log(`${c.label} timed out — contact 15-16 closed`);
            }
          } else if (c.state.done || c._internal.elapsed) {
            if (c.state.done) this.log(`${c.label} reset — contact 15-16 opened`, 'warn');
            c.state.done = false;
            c._internal.elapsed = 0;
          }
          c.state.energized = v;
          break;
        }
        case 'lamp':
          c.state.lit = across(`${c.id}.1`, `${c.id}.2`);
          break;
        case 'buzzer':
          c.state.on = across(`${c.id}.1`, `${c.id}.2`);
          break;
        case 'floordisplay': {
          let lit = 0, count = 0;
          for (let k = 1; k <= 10; k++) {
            if (across(`${c.id}.${k}`, `${c.id}.N`)) { lit = k; count++; }
          }
          c.state.floor = count > 1 ? -1 : lit; // -1 = ambiguous → shows E
          c.state.up = across(`${c.id}.U`, `${c.id}.N`);
          c.state.down = across(`${c.id}.D`, `${c.id}.N`);
          break;
        }
        case 'vfd': {
          const pL1 = phasesOf(`${c.id}.L1`), pL2 = phasesOf(`${c.id}.L2`), pL3 = phasesOf(`${c.id}.L3`);
          const powered = distinct3(pL1, pL2, pL3);
          const fwd = across(`${c.id}.FWD`, `${c.id}.COM`);
          const rev = across(`${c.id}.REV`, `${c.id}.COM`);
          const fault = fwd && rev ? 'FWD+REV' : '';
          const wantDir = fault ? 0 : fwd ? 1 : rev ? -1 : 0;
          const base = c.params.base ?? 50;
          const ramp = Math.max(1, c.params.ramp ?? 25);
          const minF = c.params.min_freq ?? 1.5;
          // speed reference: wired analog pedal wins over the manual ref param
          const ref = Math.max(analogOf(`${c.id}.R+`), Math.min(1, c.params.ref ?? 0));
          const targetHz = powered && wantDir && ref > 0 ? ref * base : 0;
          const freq = c.state.freq || 0;
          let nf = freq + Math.max(-ramp * dt, Math.min(ramp * dt, targetHz - freq));
          if (!powered || !wantDir) nf = Math.max(0, nf - ramp * dt); // coast the ramp down
          nf = Math.max(0, Math.min(base, nf));
          const running = powered && wantDir !== 0 && nf > minF && !fault;
          const dir = running ? wantDir : (c.state.dir || 0);
          const changed = running !== c.state.running || dir !== c.state.dir || fault !== (c.state.fault || '');
          c.state.freq = Math.round(nf * 10) / 10;
          c.state.running = running;
          c.state.dir = running ? wantDir : dir;
          c.state.fault = fault;
          if (!c._internal.wasPowered && powered) this.log(`VFD ${c.label} powered up — ${(c.params.base ?? 50).toFixed(0)} Hz drive ready`);
          if (c._internal.wasPowered && !powered) this.log(`VFD ${c.label} lost power — output off`, 'warn');
          c._internal.wasPowered = powered;
          if (fault && !c._internal.faultLogged) { this.log(`VFD ${c.label} FAULT: FWD and REV commanded together`, 'fault'); c._internal.faultLogged = true; }
          if (!fault) c._internal.faultLogged = false;
          if (c._internal.wasRunning === undefined) c._internal.wasRunning = false;
          if (running && !c._internal.wasRunning) this.log(`VFD ${c.label} RUNNING ${dir > 0 ? 'forward' : 'reverse'} — ramping to ${(ref * base).toFixed(1)} Hz`);
          if (!running && c._internal.wasRunning) this.log(`VFD ${c.label} stopped — output off`, 'warn');
          c._internal.wasRunning = running;
          if (changed) buildNets(); // synthetic output phases changed state
          break;
        }
        case 'motor3': {
          const pU = phasesOf(`${c.id}.U`), pV = phasesOf(`${c.id}.V`), pW = phasesOf(`${c.id}.W`);
          const anyHot = pU.size + pV.size + pW.size > 0;
          const powered = anyHot && distinct3(pU, pV, pW);
          c._internal.powered = powered;
          c._internal.anyHot = anyHot;
          c._internal.seq = powered ? sequenceDir(pU, pV, pW) : { dir: 0, order: '' };
          break;
        }
        case 'overload': {
          // measure current of a motor electrically downstream of the main poles
          let I = 0;
          for (const m of comps) {
            if (m.type !== 'motor3') continue;
            const tTerms = ['T1', 'T2', 'T3'].map(t => `${c.id}.${t}`);
            const mTerms = ['U', 'V', 'W'].map(t => `${m.id}.${t}`);
            if (tTerms.some(a => mTerms.some(b => connected(a, b)))) {
              I = Math.max(I, m.state.current || 0);
            }
          }
          c._internal.current = I;
          break;
        }
        case 'fuse3': {
          const sc = this.faults.short_circuit;
          if (sc) {
            const target = this.components.get(sc.target);
            if (target) {
              const tRoots = new Set(Object.keys(DEVICE_TYPES[target.type].terminals)
                .map(t => dsu.find(termIdx.get(`${target.id}.${t}`))));
              for (let i = 0; i < 3; i++) {
                if (c.state.blown[i]) continue;
                const tRoot = dsu.find(termIdx.get(`${c.id}.T${i + 1}`));
                if (tRoots.has(tRoot)) {
                  c.state.blown[i] = true;
                  this.log(`fuse ${c.label} pole ${i + 1} BLEW (short circuit)`, 'fault');
                }
              }
            }
          }
          break;
        }
        case 'fuse1': {
          const sc = this.faults.short_circuit;
          if (sc && !c.state.blown) {
            const target = this.components.get(sc.target);
            if (target) {
              const tRoots = new Set(Object.keys(DEVICE_TYPES[target.type].terminals)
                .map(t => dsu.find(termIdx.get(`${target.id}.${t}`))));
              if (tRoots.has(dsu.find(termIdx.get(`${c.id}.T`)))) {
                c.state.blown = true;
                this.log(`fuse ${c.label} BLEW (short circuit)`, 'fault');
              }
            }
          }
          break;
        }
      }
    }

    // ---- 4. dynamics ----
    for (const c of comps) {
      if (c.type === 'motor3') {
        const flc = c.params.flc ?? 10;
        let load = c.params.load ?? 0.9;
        const jam = this.faults.stall?.target === c.id;
        if (this.faults.overload?.target === c.id) load *= this.faults.overload.multiplier;
        const powered = c._internal.powered, anyHot = c._internal.anyHot;
        const seq = c._internal.seq || { dir: 0, order: '' };
        const speed = c.state.speed || 0; // signed: + forward, − reverse
        const mag = Math.abs(speed);
        // drive frequency: a VFD feeding this motor scales its speed target
        // (mains at 50 Hz = full speed, a drive at 15 Hz = 30% speed)
        let fScale = 0, driven = false;
        for (const d of comps) {
          if (d.type !== 'vfd' || !d.state.running) continue;
          if (connected(`${d.id}.U`, `${c.id}.U`) || connected(`${d.id}.V`, `${c.id}.V`) || connected(`${d.id}.W`, `${c.id}.W`)) {
            fScale = Math.max(fScale, (d.state.freq || 0) / (d.params.base ?? 50));
            driven = true;
          }
        }
        if (!driven) fScale = 1; // mains supply — full speed
        const target = seq.dir * fScale; // signed speed setpoint
        const decay = (rate) => { // decay magnitude toward 0, keep sign; rate clamped for big dt
          const m = mag * (1 - Math.min(1, rate));
          return speed < 0 ? -m : m;
        };
        c.state.dir = powered ? seq.dir : 0;

        if (powered) {
          if (jam) {
            c.state.current = 6 * flc;
            c.state.speed = decay(dt / 0.3);
          } else if (seq.dir === 0) {
            // terminals hot but no rotating field (miswire): motor hums, speed bleeds off
            c.state.current = flc * load * 6;
            c.state.speed = decay(dt / 0.5);
          } else {
            // plugging: rotor still turning against the applied field —
            // counter-torque brakes it through zero, then it spins up reversed
            const plugging = speed * target < -0.02;
            if (plugging) {
              c.state.current = 2 * flc * load;
              c.state.speed = speed + (dt / 0.6) * (target - speed);
            } else {
              const inrush = 1 + 5 * Math.max(0, 1 - mag / 0.3); // 6x at standstill → 1x above 0.3
              c.state.current = flc * load * inrush;
              c.state.speed = speed + (dt / 1.2) * (target - speed);
            }
          }
        } else if (anyHot) { // single-phasing
          c.state.current = flc * load * (mag > 0.2 ? 1.7 : 6);
          c.state.speed = decay(dt / 2.5);
        } else {
          c.state.current = 0;
          c.state.speed = decay(dt / 2);
        }
        c.state.speed = Math.max(-1, Math.min(1, c.state.speed));

        const wasRunning = c._internal.running;
        const running = powered && Math.abs(c.state.speed) > 0.03;
        if (running !== wasRunning) {
          c._internal.running = running;
          this.log(`${c.label} ${running ? 'STARTED — spinning up' : 'STOPPED'}`, running ? 'info' : 'warn');
        }
        if (powered && seq.dir !== 0) {
          if (c._internal.lastDir === undefined) c._internal.lastDir = seq.dir;
          else if (c._internal.lastDir !== seq.dir) {
            c._internal.lastDir = seq.dir;
            this.log(`${c.label} REVERSED — phase order ${seq.order}`, 'warn');
          }
        }
        if (jam && powered && Math.abs(c.state.speed) < 0.02 && !c._internal.stallLogged) {
          c._internal.stallLogged = true;
          this.log(`${c.label} STALLED — locked rotor, ${Math.round(6 * flc)} A`, 'fault');
        }
        if (!jam) c._internal.stallLogged = false;
      }

      if (c.type === 'overload') {
        const In = c.params.flc ?? 10;
        const cls = c.params.trip_class ?? 10;
        const I = c._internal.current || 0;
        let th = c._internal.thermal || 0;
        const ratio = I / In;
        if (ratio > 1.05) {
          // Class 10: trips in `cls` seconds at 7.2x In. dTh/dt = (r^2 - 1) / ((7.2^2 - 1) * cls)
          th += dt * (ratio * ratio - 1) / ((7.2 * 7.2 - 1) * cls);
        } else {
          th -= dt * th / 180; // ~3 min cooling time constant
        }
        th = Math.max(0, th);
        c._internal.thermal = th;
        c.state.thermal = Math.round(th * 1000) / 1000;
        if (th >= 1 && !c.state.tripped) {
          c.state.tripped = true;
          this.log(`overload ${c.label} TRIPPED (thermal 100%)`, 'fault');
        }
      }
    }

    // ---- 4b. mechanical service brake ----
    // A brake pedal bound to a motor decelerates it directly (and fights the
    // drive: current rises while braking under power).
    for (const c of comps) {
      if (c.type !== 'brake') continue;
      const v = c.state.value || 0;
      if (v <= 0.02) continue;
      const m = this.components.get(String(c.params.motor || ''));
      if (!m || m.type !== 'motor3') continue;
      const rate = 0.8 + 4.2 * v; // decay rate 1/s — full brake stops in ~1 s
      m.state.speed *= Math.max(0, 1 - Math.min(1, rate * dt));
      if (m._internal.powered) {
        const flc = m.params.flc ?? 10, load = m.params.load ?? 0.9;
        m.state.current = Math.max(m.state.current || 0, flc * load * (1 + 1.6 * v));
      }
    }

    this.t += dt;
    this.version++;
  }

  advance(seconds) {
    const n = Math.max(1, Math.round(seconds / this.tickRate));
    for (let i = 0; i < n; i++) this.step(this.tickRate);
    return { advanced: seconds, ticks: n, t: Math.round(this.t * 10) / 10 };
  }

  // ---------- state snapshot ----------

  snapshot(logLimit = 50) {
    const nets = new Map(); // root -> {id, phases:[], terminals:[]}
    // recompute net membership cheaply from last tick's view is complex; rebuild wires' nets here
    // by re-running a DSU — acceptable (small circuits).
    const comps = [...this.components.values()];
    const termIdx = new Map();
    const termKeys = [];
    for (const c of comps) {
      for (const t of Object.keys(DEVICE_TYPES[c.type].terminals)) {
        termIdx.set(`${c.id}.${t}`, termKeys.length);
        termKeys.push(`${c.id}.${t}`);
      }
    }
    const dsu = new DSU(termKeys.length);
    for (const w of this.wires) dsu.union(termIdx.get(w.from), termIdx.get(w.to));
    for (const c of comps) {
      for (const [a, b] of conductingPoles(c)) dsu.union(termIdx.get(`${c.id}.${a}`), termIdx.get(`${c.id}.${b}`));
    }
    // seed phases against THIS dsu (post-evaluation connectivity) — never reuse
    // step-time roots, which diverge whenever a device changed state in the tick
    const rootPhases = new Map();
    for (const c of comps) {
      if (c.type === 'supply3') {
        const lost = this.faults.phase_loss?.phase;
        for (const ph of ['L1', 'L2', 'L3', 'N']) {
          if (ph === lost) continue;
          const root = dsu.find(termIdx.get(`${c.id}.${ph}`));
          if (!rootPhases.has(root)) rootPhases.set(root, new Set());
          rootPhases.get(root).add(ph);
        }
      } else if (c.type === 'vfd' && c.state.running && c.state.dir) {
        const fwd = c.state.dir > 0;
        for (const [term, ph] of [['U', 'a'], ['V', fwd ? 'b' : 'c'], ['W', fwd ? 'c' : 'b']]) {
          const root = dsu.find(termIdx.get(`${c.id}.${term}`));
          if (!rootPhases.has(root)) rootPhases.set(root, new Set());
          rootPhases.get(root).add(`${c.id}.${ph}`);
        }
      }
    }
    const netOf = (ref) => {
      const root = dsu.find(termIdx.get(ref));
      let net = nets.get(root);
      if (!net) {
        net = { id: `n${nets.size + 1}`, phases: [...(rootPhases.get(root) || [])].sort(), terminals: [] };
        nets.set(root, net);
      }
      return net;
    };

    const components = comps.map(c => {
      const s = { ...c.state };
      if (c.type === 'overload') s.thermal = c.state.thermal ?? 0;
      return {
        id: c.id, type: c.type, label: c.label, x: c.x, y: c.y,
        params: { ...c.params }, state: s
      };
    });

    const wires = this.wires.map(w => {
      const na = netOf(w.from), nb = netOf(w.to);
      return { id: w.id, from: w.from, to: w.to, netA: na.id, netB: nb.id, hot: na.phases.length > 0 };
    });

    const terminals = {};
    for (const ref of termKeys) terminals[ref] = netOf(ref).id;

    return {
      circuit: this.circuitName,
      t: Math.round(this.t * 10) / 10,
      running: this.running,
      tickRate: this.tickRate,
      faults: this.faults,
      components,
      terminals,
      nets: [...nets.values()].map(n => ({ id: n.id, phases: n.phases })),
      wires,
      log: this.events.slice(-logLimit),
      version: this.version
    };
  }
}

const EMPTY_SET = new Set();

function distinct3(a, b, c) {
  if (!a.size || !b.size || !c.size) return false;
  for (const p of a) if (b.has(p) || c.has(p)) return false;
  for (const p of b) if (c.has(p)) return false;
  return true;
}

// Rotation direction from the phase sequence across motor terminals U,V,W:
// +1 when the phases appear in cyclic sorted order (e.g. L1→L2→L3, or a VFD's
// a→b→c synthetic field), -1 when two phases are swapped, 0 when no clean
// 3-phase combo exists. Neutral never forms a rotating field.
function sequenceDir(pU, pV, pW) {
  for (const a of pU) for (const b of pV) for (const c of pW) {
    if (a === b || b === c || a === c) continue;
    if (a === 'N' || b === 'N' || c === 'N') continue;
    const order = [a, b, c].sort();
    const idx = { [order[0]]: 0, [order[1]]: 1, [order[2]]: 2 };
    const fwd = (((idx[b] - idx[a]) % 3) + 3) % 3 === 1;
    return { dir: fwd ? 1 : -1, order: `${a}-${b}-${c}` };
  }
  return { dir: 0, order: '' };
}

// Conducting pole pairs per device, based on current device state.
function conductingPoles(c) {
  switch (c.type) {
    case 'breaker3':
      return c.state.closed ? [['L1', 'T1'], ['L2', 'T2'], ['L3', 'T3']] : [];
    case 'breaker1':
      return c.state.closed ? [['L', 'T']] : [];
    case 'fuse3': {
      const pairs = [];
      for (let i = 0; i < 3; i++) if (!c.state.blown?.[i]) pairs.push([`L${i + 1}`, `T${i + 1}`]);
      return pairs;
    }
    case 'fuse1':
      return c.state.blown ? [] : [['L', 'T']];
    case 'contactor': {
      const e = !!c.state.energized;
      const pairs = [];
      if (e) {
        pairs.push(['L1', 'T1'], ['L2', 'T2'], ['L3', 'T3'], ['13', '14'], ['43', '44']);
      } else {
        pairs.push(['21', '22']);
      }
      return pairs;
    }
    case 'overload': {
      if (c.state.tripped) return [['97', '98']];
      return [['L1', 'T1'], ['L2', 'T2'], ['L3', 'T3'], ['95', '96']];
    }
    case 'pushbutton_no':
      return c.state.pressed ? [['13', '14']] : [];
    case 'pushbutton_nc':
      return c.state.pressed ? [] : [['11', '12']];
    case 'selector2':
      return c.state.pos === '1' ? [['13', '14']] : [];
    case 'selector3':
      return c.state.pos === '1' ? [['COM', 'P1']] : c.state.pos === '2' ? [['COM', 'P2']] : [];
    case 'estop':
      return c.state.pressed ? [['13', '14']] : [['11', '12']];
    case 'pedal':
      return (c.state.value || 0) >= (c.params.cutoff ?? 0.05) ? [['13', '14']] : [];
    case 'brake':
      return (c.state.value || 0) > 0.02 ? [['13', '14']] : [['11', '12']];
    case 'floorselector':
      return (c.state.floor || 0) > 0 ? [['COM', String(c.state.floor)]] : [];
    case 'timer_on':
      return c.state.done ? [['15', '16']] : [];
    case 'cam10': {
      const pos = Math.min(10, Math.max(1, c.state.position || 1));
      const pairs = [['COM', `F${pos}`], ['ICOM', `IF${pos}`]];
      for (let i = 1; i <= 10; i++) {
        if (i !== pos) pairs.push([`G${i}`, `GH${i}`], [`H${i}`, `HH${i}`]);
      }
      return pairs;
    }
    default:
      return [];
  }
}
