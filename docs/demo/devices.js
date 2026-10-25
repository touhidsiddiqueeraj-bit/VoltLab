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
    state: { speed: 0, current: 0, dir: 0 },
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

  estop: {
    label: 'Emergency Stop',
    group: 'Control',
    defaults: { label: 'SE1', color: '#e3342f' },
    state: { pressed: false },
    size: { w: 110, h: 130 },
    terminals: {
      11: { x: 20, y: 0 }, 12: { x: 20, y: 120 },
      13: { x: 80, y: 0 }, 14: { x: 80, y: 120 }
    },
    desc: 'Emergency stop mushroom. Maintained NC pole 11-12 (opens while tripped, killing the control circuit) + NO aux 13-14 (trip signalling). Twist to release.'
  },

  selector3: {
    label: 'Selector Switch 3-Pos',
    group: 'Control',
    defaults: { label: 'S3' },
    size: { w: 60, h: 90 },
    terminals: { COM: { x: 30, y: 0 }, P1: { x: 30, y: 80 }, P2: { x: 52, y: 80 } },
    state: { pos: '0' },
    desc: 'Maintained 3-position selector: 0 = all open, I = COM-P1 closed, II = COM-P2 closed. FWD/OFF/REV or Hand/Off/Auto.'
  },

  pedal: {
    label: 'Accelerator Pedal',
    group: 'Control',
    defaults: { label: 'P1', color: '#4fc3f7' },
    state: { value: 0 },
    size: { w: 90, h: 150 },
    terminals: {
      13: { x: 20, y: 0 }, 14: { x: 20, y: 140 },
      'R+': { x: 70, y: 30 }, 'R-': { x: 70, y: 120 }
    },
    params: { cutoff: { value: 0.05, unit: 'x', desc: 'Pole 13-14 closes above this travel' } },
    desc: 'Analog accelerator pedal, 0..100% travel. Pole 13-14 closes above the cutoff (pedal-start interlock); R+/R- emit a 0-100% analog reference — wire them to a VFD speed input.'
  },

  brake: {
    label: 'Brake Pedal',
    group: 'Control',
    defaults: { label: 'P2', color: '#e3342f' },
    state: { value: 0 },
    size: { w: 90, h: 150 },
    terminals: {
      11: { x: 20, y: 0 }, 12: { x: 20, y: 55 },
      13: { x: 20, y: 95 }, 14: { x: 20, y: 140 }
    },
    params: { motor: { value: 0, unit: 'id', desc: 'Motor id the brake mechanically acts on (0 = none)' } },
    desc: 'Service brake pedal, 0..100%. NC pole 11-12 opens when pressed (cuts the drive), NO pole 13-14 closes (brake lamps); also mechanically decelerates the bound motor.'
  },

  vfd: {
    label: 'VFD (Variable Frequency Drive)',
    group: 'Switching',
    defaults: { label: 'U1' },
    state: { freq: 0, running: false, dir: 0, fault: '' },
    size: { w: 180, h: 200 },
    terminals: {
      L1: { x: 30, y: 0 }, L2: { x: 60, y: 0 }, L3: { x: 90, y: 0 },
      U: { x: 30, y: 198 }, V: { x: 60, y: 198 }, W: { x: 90, y: 198 },
      FWD: { x: 160, y: 40 }, REV: { x: 160, y: 80 }, COM: { x: 160, y: 120 },
      'R+': { x: 130, y: 0 }, 'R-': { x: 150, y: 0 }
    },
    params: {
      base: { value: 50, unit: 'Hz', desc: 'Base (max output) frequency' },
      ramp: { value: 25, unit: 'Hz/s', desc: 'Frequency ramp rate' },
      min_freq: { value: 1.5, unit: 'Hz', desc: 'Output below this = stop' },
      ref: { value: 0, unit: 'x', desc: 'Manual speed reference 0..1 (used when no pedal is wired)' }
    },
    desc: 'Variable frequency drive. Powers up on 3-phase at L1/L2/L3; runs when FWD-COM or REV-COM see a potential difference, at the speed set by the R+/R- analog reference (or the manual ref param). Generates its own rotating field on U/V/W — swap direction with FWD/REV. Both directions at once = fault.'
  },

  floorselector: {
    label: 'Floor Selector (Car Calls)',
    group: 'Control',
    defaults: { label: 'CS1' },
    state: { floor: 0 },
    size: { w: 170, h: 330 },
    params: { floors: { value: 10, unit: 'n', desc: 'Highest served floor (2..10)' } },
    desc: 'Car operating panel: maintained floor selection. Selecting floor k closes COM-k (registers the car call); selecting again cancels (0 = no call).'
      + ' Terminals: COM + one NO contact per floor.',
    terminals: (() => {
      const t = { COM: { x: 20, y: 30 } };
      for (let i = 1; i <= 10; i++) t[String(i)] = { x: 100, y: 70 + (i - 1) * 26 };
      return t;
    })()
  },

  floordisplay: {
    label: 'Floor Indicator Display',
    group: 'Signalling',
    defaults: { label: 'FD1', color: '#ffb454' },
    state: { floor: 0, up: false, down: false },
    size: { w: 150, h: 140 },
    desc: 'Car/hall floor indicator: 7-segment digit + up/down arrows. Wire the floor number inputs (1..10, e.g. from a floor cam F-deck) against return N; digit shows the energized input. U/D inputs light the travel arrows.',
    terminals: (() => {
      const t = { U: { x: 15, y: 0 }, D: { x: 35, y: 0 }, N: { x: 135, y: 0 } };
      for (let i = 1; i <= 10; i++) t[String(i)] = { x: 55 + (i - 1) * 8, y: 138 };
      return t;
    })()
  },

  cam10: {
    label: 'Floor Cam (10-Pos, 4-Deck)',
    group: 'Control',
    defaults: { label: 'CAM1' },
    state: { position: 1 },
    size: { w: 300, h: 400 },
    desc: 'Four-deck rotary floor cam = car position. Deck A: COM-F(position). Decks B/C: G(n)-GH(n) and H(n)-HH(n) close for every floor EXCEPT the current one (per-floor isolation contacts). Deck D: ICOM-IF(position) — an isolated indicator deck, so a floor display wired there can never backfeed the control decks. Advance with set_position.',
    terminals: (() => {
      const t = { COM: { x: 20, y: 30 }, ICOM: { x: 270, y: 30 } };
      for (let i = 1; i <= 10; i++) t[`F${i}`] = { x: 20, y: 70 + (i - 1) * 33 };
      for (let i = 1; i <= 10; i++) t[`G${i}`] = { x: 95, y: 70 + (i - 1) * 33 };
      for (let i = 1; i <= 10; i++) t[`GH${i}`] = { x: 130, y: 70 + (i - 1) * 33 };
      for (let i = 1; i <= 10; i++) t[`H${i}`] = { x: 165, y: 70 + (i - 1) * 33 };
      for (let i = 1; i <= 10; i++) t[`HH${i}`] = { x: 210, y: 70 + (i - 1) * 33 };
      for (let i = 1; i <= 10; i++) t[`IF${i}`] = { x: 270, y: 70 + (i - 1) * 33 };
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
