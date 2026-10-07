// sim/devices.js — device type registry shared by the simulation engine and the renderer.
// Pure data, no imports, works in Node and browser.

export const DEVICE_TYPES = {
  supply3: {
    label: '3-Phase Supply',
    group: 'Sources',
    defaults: { label: 'X1' },
    size: { w: 130, h: 70 },
    terminals: {
      L1: { x: 20, y: 60 }, L2: { x: 50, y: 60 },
      L3: { x: 80, y: 60 }, N: { x: 110, y: 60 }
    },
    desc: 'Three-phase + neutral source. Always energized (400V L-L / 230V L-N).'
  },

  breaker3: {
    label: 'Circuit Breaker 3P',
    group: 'Protection',
    defaults: { label: 'Q1' },
    size: { w: 90, h: 130 },
    terminals: {
      L1: { x: 20, y: 0 }, L2: { x: 50, y: 0 }, L3: { x: 80, y: 0 },
      T1: { x: 20, y: 120 }, T2: { x: 50, y: 120 }, T3: { x: 80, y: 120 }
    },
    state: { closed: false },
    desc: '3-pole molded-case breaker. Toggle open/closed; carries all three phases.'
  },

  breaker1: {
    label: 'Circuit Breaker 1P',
    group: 'Protection',
    defaults: { label: 'Q2' },
    size: { w: 40, h: 110 },
    terminals: { L: { x: 20, y: 0 }, T: { x: 20, y: 100 } },
    state: { closed: false },
    desc: 'Single-pole breaker.'
  },

  fuse3: {
    label: 'Fuses 3P',
    group: 'Protection',
    defaults: { label: 'F1' },
    size: { w: 90, h: 110 },
    terminals: {
      L1: { x: 20, y: 0 }, L2: { x: 50, y: 0 }, L3: { x: 80, y: 0 },
      T1: { x: 20, y: 100 }, T2: { x: 50, y: 100 }, T3: { x: 80, y: 100 }
    },
    state: { blown: [false, false, false] },
    params: { rating: { value: 16, unit: 'A', desc: 'Fuse rating (cosmetic)' } },
    desc: 'Three ganged fuses. Blow instantly on short-circuit; replace with replace_fuses.'
  },

  fuse1: {
    label: 'Fuse 1P',
    group: 'Protection',
    defaults: { label: 'F4' },
    size: { w: 40, h: 80 },
    terminals: { L: { x: 20, y: 0 }, T: { x: 20, y: 70 } },
    state: { blown: false },
    params: { rating: { value: 6, unit: 'A', desc: 'Fuse rating (cosmetic)' } },
    desc: 'Single fuse, typically for the control circuit.'
  },

  contactor: {
    label: 'Contactor',
    group: 'Switching',
    defaults: { label: 'KM1' },
    state: { energized: false },
    size: { w: 170, h: 210 },
    terminals: {
      L1: { x: 20, y: 0 }, L2: { x: 50, y: 0 }, L3: { x: 80, y: 0 },
      T1: { x: 20, y: 100 }, T2: { x: 50, y: 100 }, T3: { x: 80, y: 100 },
      13: { x: 110, y: 20 }, 14: { x: 160, y: 20 },
      21: { x: 110, y: 50 }, 22: { x: 160, y: 50 },
      43: { x: 110, y: 80 }, 44: { x: 160, y: 80 },
      A1: { x: 135, y: 110 }, A2: { x: 135, y: 190 }
    },
    desc: 'Contactor: 3 main poles + 1 NO aux (13-14) + 1 NC aux (21-22) + coil (A1-A2). Coil energizes when its two terminals see different phases.'
  },

  overload: {
    label: 'Thermal Overload Relay',
    group: 'Protection',
    defaults: { label: 'KK1' },
    state: { tripped: false, thermal: 0 },
    terminals: {
      L1: { x: 20, y: 0 }, L2: { x: 50, y: 0 }, L3: { x: 80, y: 0 },
      T1: { x: 20, y: 110 }, T2: { x: 50, y: 110 }, T3: { x: 80, y: 110 },
      95: { x: 125, y: 20 }, 96: { x: 175, y: 20 },
      97: { x: 125, y: 50 }, 98: { x: 175, y: 50 }
    },
    size: { w: 200, h: 120 },
    params: {
      flc: { value: 10, unit: 'A', desc: 'Set current (motor FLC)' },
      trip_class: { value: 10, unit: 'class', desc: 'Trip class (10 = 10s @ 7.2x)' }
    },
    desc: 'Thermal overload: 3 main poles + NC aux 95-96 (drops coil on trip) + NO aux 97-98 (trip lamp). Heats with motor current, trips at 1.0, resets via reset_overload.'
  },

  motor3: {
    label: 'Motor 3~',
    group: 'Loads',
    defaults: { label: 'M1' },
    state: { speed: 0, current: 0 },
    size: { w: 110, h: 130 },
    terminals: { U: { x: 20, y: 0 }, V: { x: 50, y: 0 }, W: { x: 80, y: 0 } },
    params: {
      flc: { value: 10, unit: 'A', desc: 'Full load current' },
      load: { value: 0.9, unit: 'x', desc: 'Mechanical load factor' }
    },
    desc: 'Squirrel-cage induction motor. Runs on 3 distinct phases; ~6x FLC inrush at standstill; coasts to stop when de-energized.'
  },

  pushbutton_no: {
    label: 'Push Button NO',
    group: 'Control',
    defaults: { label: 'S1', color: '#38c172' },
    size: { w: 60, h: 90 },
    terminals: { 13: { x: 30, y: 0 }, 14: { x: 30, y: 80 } },
    state: { pressed: false },
    desc: 'Momentary NO push button (start). Held while pressed.'
  },

  pushbutton_nc: {
    label: 'Push Button NC',
    group: 'Control',
    defaults: { label: 'S0', color: '#e3342f' },
    size: { w: 60, h: 90 },
    terminals: { 11: { x: 30, y: 0 }, 12: { x: 30, y: 80 } },
    state: { pressed: false },
    desc: 'Momentary NC push button (stop). Opens while pressed.'
  },

  selector2: {
    label: 'Selector Switch 2-Pos',
    group: 'Control',
    defaults: { label: 'S2' },
    size: { w: 60, h: 90 },
    terminals: { 13: { x: 30, y: 0 }, 14: { x: 30, y: 80 } },
    state: { pos: '0' },
    desc: 'Maintained selector switch. Position I (1) = closed, 0 = open.'
  },

  timer_on: {
    label: 'Timer On-Delay',
    group: 'Control',
    defaults: { label: 'KT1' },
    state: { energized: false, done: false },
    size: { w: 80, h: 140 },
    terminals: { A1: { x: 30, y: 0 }, A2: { x: 30, y: 50 }, 15: { x: 30, y: 90 }, 16: { x: 30, y: 130 } },
    params: { delay: { value: 3, unit: 's', desc: 'On-delay time' } },
    desc: 'On-delay timer relay. Contact 15-16 closes `delay` seconds after coil energizes; resets instantly.'
  },

  lamp: {
    label: 'Indicator Lamp',
    group: 'Signalling',
    defaults: { label: 'H1', color: '#38c172' },
    state: { lit: false },
    size: { w: 50, h: 90 },
    terminals: { 1: { x: 25, y: 0 }, 2: { x: 25, y: 80 } },
    desc: 'Indicator lamp. Lit when its terminals see different phases.'
  },

  buzzer: {
    label: 'Buzzer',
    group: 'Signalling',
    defaults: { label: 'B1', color: '#e3342f' },
    state: { on: false },
    size: { w: 50, h: 90 },
    terminals: { 1: { x: 25, y: 0 }, 2: { x: 25, y: 80 } },
    desc: 'Audible alarm. On when its terminals see different phases.'
  },

  cam10: {
    label: 'Floor Cam (10-Pos, 3-Deck)',
    group: 'Control',
    defaults: { label: 'CAM1' },
    state: { position: 1 },
    size: { w: 240, h: 400 },
    desc: 'Three-deck rotary floor cam = car position. Deck A: COM-F(position). Decks B/C: G(n)-GH(n) and H(n)-HH(n) close for every floor EXCEPT the current one (per-floor isolation contacts). Advance with set_position.',
    terminals: (() => {
      const t = { COM: { x: 20, y: 30 } };
      for (let i = 1; i <= 10; i++) t[`F${i}`] = { x: 20, y: 70 + (i - 1) * 33 };
      for (let i = 1; i <= 10; i++) t[`G${i}`] = { x: 95, y: 70 + (i - 1) * 33 };
      for (let i = 1; i <= 10; i++) t[`GH${i}`] = { x: 130, y: 70 + (i - 1) * 33 };
      for (let i = 1; i <= 10; i++) t[`H${i}`] = { x: 165, y: 70 + (i - 1) * 33 };
      for (let i = 1; i <= 10; i++) t[`HH${i}`] = { x: 210, y: 70 + (i - 1) * 33 };
      return t;
    })()
  },

  junction: {
    label: 'Junction',
    group: 'Signalling',
    defaults: { label: 'N1' },
    size: { w: 20, h: 20 },
    terminals: { T: { x: 10, y: 10 } },
    desc: 'Plain electrical node — handy as a rail/common point.'
  }
};

export const PHASE_COLORS = {
  L1: '#c98a3d',  // brown
  L2: '#8f8f98',  // black/grey
  L3: '#b06a72',  // brick
  N:  '#4f83b8'   // blue
};

// Terminal names that carry a known phase (used for wire coloring fallback)
export const TERMINAL_PHASE = {
  L1: 'L1', T1: 'L1', U: 'L1',
  L2: 'L2', T2: 'L2', V: 'L2',
  L3: 'L3', T3: 'L3', W: 'L3',
  N: 'N'
};
