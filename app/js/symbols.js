// app/js/symbols.js — IEC-style SVG symbol drawing per device type.
// Geometry is identical to the engine's terminal registry; colors come from theme
// classes (s-body / s-stroke / s-dim / s-hi / s-rotor / s-blade) so light and dark
// modes both render correctly. State-dependent colors use inline style (beats classes).

const label = (comp, dx, dy, size = 11) =>
  `<text class="comp-label" x="${comp.x + dx}" y="${comp.y + dy}" font-size="${size}">${esc(comp.label)}</text>`;

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');

const stub = (x1, y1, x2, y2) => `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" class="s-stroke" stroke-width="2"/>`;

const BLADE = (x, y, closed, len = 20) => {
  // vertical power contact blade: pivot at top point (x,y)
  if (closed) return `<line x1="${x}" y1="${y}" x2="${x}" y2="${y + len}" class="s-blade" stroke-width="2.6"/>`;
  return `<line x1="${x}" y1="${y}" x2="${x + len * 0.55}" y2="${y + len * 0.85}" class="s-stroke" stroke-width="2.6"/>`;
};

const HBLADE = (x, y, closed, len = 40) => {
  // horizontal control contact: pivot left at (x,y)
  if (closed) return `<line x1="${x}" y1="${y}" x2="${x + len}" y2="${y}" class="s-blade" stroke-width="2.6"/>`;
  return `<line x1="${x}" y1="${y}" x2="${x + len}" y2="${y - 13}" class="s-stroke" stroke-width="2.6"/>`;
};

const NCBLADE = (x, y, closed, len = 40) => {
  // NC contact: blade rests horizontal; opens by lifting the far end with a hook
  if (closed) return `<line x1="${x}" y1="${y}" x2="${x + len}" y2="${y}" class="s-blade" stroke-width="2.6"/>`;
  return `<line x1="${x}" y1="${y}" x2="${x + len}" y2="${y - 14}" class="s-stroke" stroke-width="2.6"/>` +
         `<line x1="${x + len}" y1="${y - 14}" x2="${x + len - 8}" y2="${y - 20}" class="s-stroke" stroke-width="2"/>`;
};

export const SYMBOLS = {
  supply3(comp) {
    const { x, y } = comp;
    let s = `<rect x="${x}" y="${y}" width="130" height="34" rx="5" class="s-body s-stroke2" stroke-width="1.4"/>`;
    s += `<text x="${x + 65}" y="${y + 15}" text-anchor="middle" font-size="11" class="s-hi">3~ 400V 50Hz</text>`;
    s += `<text x="${x + 65}" y="${y + 28}" text-anchor="middle" font-size="9" class="s-dim">SUPPLY</text>`;
    for (const px of [20, 50, 80, 110]) {
      s += stub(x + px, y + 34, x + px, y + 60);
    }
    return s + label(comp, 65, 82);
  },

  breaker3(comp, state) {
    const { x, y } = comp;
    const closed = !!state.closed;
    let s = '';
    for (const px of [20, 50, 80]) {
      s += stub(x + px, y, x + px, y + 45);
      s += BLADE(x + px, y + 45, closed);
      s += stub(x + px, y + 85, x + px, y + 120);
    }
    s += closed
      ? `<path d="M ${x + 14} ${y + 52} q 31 22 62 0" fill="none" style="stroke:var(--ok)" stroke-width="2.2"/>`
      : `<path d="M ${x + 14} ${y + 66} q 31 -22 62 0" fill="none" style="stroke:var(--bad)" stroke-width="2.2"/>`;
    return s + label(comp, 50, 142);
  },

  breaker1(comp, state) {
    const { x, y } = comp;
    const closed = !!state.closed;
    let s = stub(x + 20, y, x + 20, y + 45);
    s += BLADE(x + 20, y + 45, closed);
    s += stub(x + 20, y + 85, x + 20, y + 100);
    return s + label(comp, 20, 122);
  },

  fuse3(comp, state) {
    const { x, y } = comp;
    let s = '';
    for (const [i, px] of [20, 50, 80].entries()) {
      const blown = !!state.blown?.[i];
      s += stub(x + px, y, x + px, y + 35);
      s += `<rect x="${x + px - 7}" y="${y + 35}" width="14" height="30" rx="2" class="s-body" style="stroke: ${blown ? 'var(--bad)' : 'var(--sym-idle)'}" stroke-width="1.6"/>`;
      if (blown) s += `<line x1="${x + px - 6}" y1="${y + 36}" x2="${x + px + 6}" y2="${y + 64}" style="stroke:var(--bad)" stroke-width="2"/>`;
      s += stub(x + px, y + 65, x + px, y + 100);
    }
    return s + label(comp, 50, 122);
  },

  fuse1(comp, state) {
    const { x, y } = comp;
    const blown = !!state.blown;
    let s = stub(x + 20, y, x + 20, y + 20);
    s += `<rect x="${x + 13}" y="${y + 20}" width="14" height="30" rx="2" class="s-body" style="stroke: ${blown ? 'var(--bad)' : 'var(--sym-idle)'}" stroke-width="1.6"/>`;
    if (blown) s += `<line x1="${x + 14}" y1="${y + 21}" x2="${x + 26}" y2="${y + 49}" style="stroke:var(--bad)" stroke-width="2"/>`;
    s += stub(x + 20, y + 50, x + 20, y + 70);
    return s + label(comp, 20, 90);
  },

  contactor(comp, state) {
    const { x, y } = comp;
    const on = !!state.energized;
    let s = '';
    for (const px of [20, 50, 80]) {
      s += stub(x + px, y, x + px, y + 40);
      s += BLADE(x + px, y + 40, on, 20);
      s += stub(x + px, y + 60, x + px, y + 100);
    }
    // aux NO 13-14
    s += stub(x + 110, y + 20, x + 122, y + 20);
    s += HBLADE(x + 122, y + 20, on, 26);
    s += stub(x + 148, y + 20, x + 160, y + 20);
    // aux NC 21-22
    s += stub(x + 110, y + 50, x + 122, y + 50);
    s += NCBLADE(x + 122, y + 50, !on, 26);
    s += stub(x + 148, y + 50, x + 160, y + 50);
    // aux NO 43-44 (second block)
    s += stub(x + 110, y + 80, x + 122, y + 80);
    s += HBLADE(x + 122, y + 80, on, 26);
    s += stub(x + 148, y + 80, x + 160, y + 80);
    // coil
    s += stub(x + 135, y + 110, x + 135, y + 128);
    s += `<circle cx="${x + 135}" cy="${y + 150}" r="22" class="s-body" style="fill: ${on ? 'var(--accent)' : 'var(--sym-body)'}; stroke: ${on ? 'var(--accent)' : 'var(--sym-idle)'}" stroke-width="2" ${on ? 'filter="url(#glow)"' : ''}/>`;
    s += `<text x="${x + 135}" y="${y + 155}" text-anchor="middle" font-size="12" class="${on ? 's-body' : 's-dim'}" style="${on ? 'fill: var(--bg)' : ''}">X</text>`;
    s += stub(x + 135, y + 172, x + 135, y + 190);
    s += `<text x="${x + 112}" y="${y + 14}" font-size="8" class="s-dim">13</text>`;
    s += `<text x="${x + 112}" y="${y + 44}" font-size="8" class="s-dim">21</text>`;
    return s + label(comp, 75, 122);
  },

  overload(comp, state) {
    const { x, y } = comp;
    const tripped = !!state.tripped;
    const th = Math.min(1, state.thermal ?? 0);
    let s = '';
    for (const px of [20, 50, 80]) {
      s += stub(x + px, y, x + px, y + 38);
      s += `<path d="M ${x + px} ${y + 38} l 7 6 l -14 7 l 14 7 l -14 7 l 7 6" fill="none" style="stroke: ${tripped ? 'var(--bad)' : 'var(--sym-idle)'}" stroke-width="1.8"/>`;
      s += stub(x + px, y + 71, x + px, y + 110);
    }
    // aux NC 95-96 (closed when healthy)
    s += stub(x + 125, y + 20, x + 137, y + 20);
    s += NCBLADE(x + 137, y + 20, !tripped, 26);
    s += stub(x + 163, y + 20, x + 175, y + 20);
    // aux NO 97-98 (closed when tripped)
    s += stub(x + 125, y + 50, x + 137, y + 50);
    s += HBLADE(x + 137, y + 50, tripped, 26);
    s += stub(x + 163, y + 50, x + 175, y + 50);
    s += `<text x="${x + 122}" y="${y + 14}" font-size="8" class="s-dim">95</text>`;
    s += `<text x="${x + 122}" y="${y + 44}" font-size="8" class="s-dim">97</text>`;
    // thermal load bar + reset button when tripped
    s += `<rect x="${x + 106}" y="${y + 88}" width="70" height="9" rx="3" class="s-body s-stroke2"/>`;
    s += `<rect x="${x + 107}" y="${y + 89}" width="${68 * th}" height="7" rx="2" style="fill: ${th > 0.75 ? 'var(--bad)' : th > 0.4 ? 'var(--accent)' : 'var(--ok)'}"/>`;
    if (tripped) {
      s += `<g class="reset-btn" data-reset="${comp.id}" cursor="pointer">
              <rect x="${x + 106}" y="${y + 100}" width="70" height="16" rx="4" style="fill: var(--bad-bg); stroke: var(--bad)"/>
              <text x="${x + 141}" y="${y + 112}" text-anchor="middle" font-size="9.5" style="fill: var(--bad-text)">RESET</text>
            </g>`;
    }
    return s + label(comp, 60, 133);
  },

  motor3(comp, state) {
    const { x, y } = comp;
    const powered = Math.abs(state.speed) > 0.02;
    let s = '';
    for (const px of [20, 50, 80]) s += stub(x + px, y, x + px, y + 47);
    s += `<circle cx="${x + 50}" cy="${y + 85}" r="38" class="s-body" style="stroke: ${powered ? 'var(--ok)' : 'var(--sym-idle)'}" stroke-width="2.2" ${powered ? 'filter="url(#glow)"' : ''}/>`;
    s += `<g data-rotor="${comp.id}" opacity="0.9">
            <line x1="${x + 50}" y1="${y + 55}" x2="${x + 50}" y2="${y + 115}" class="s-rotor" stroke-width="3"/>
            <line x1="${x + 24}" y1="${y + 70}" x2="${x + 76}" y2="${y + 100}" class="s-rotor" stroke-width="3"/>
            <line x1="${x + 76}" y1="${y + 70}" x2="${x + 24}" y2="${y + 100}" class="s-rotor" stroke-width="3"/>
          </g>`;
    s += `<text x="${x + 50}" y="${y + 90}" text-anchor="middle" font-size="15" font-weight="700" class="s-hi">M</text>`;
    s += `<text x="${x + 50}" y="${y + 104}" text-anchor="middle" font-size="9" class="s-dim">3~</text>`;
    return s + label(comp, 50, 143);
  },

  pushbutton_no(comp, state) {
    const { x, y } = comp;
    const pressed = !!state.pressed;
    const col = comp.params?.color || '#38c172';
    let s = stub(x + 30, y, x + 30, y + 30);
    s += BLADE(x + 30, y + 30, pressed, 20);
    s += stub(x + 30, y + 50, x + 30, y + 80);
    s += `<g class="press-area" data-press="${comp.id}" cursor="pointer">
            <rect x="${x - 26}" y="${y + 18}" width="26" height="24" rx="6" style="fill: ${pressed ? col : 'var(--sym-body)'}; stroke: ${col}" stroke-width="2"/>
            <line x1="${x}" y1="${y + 30}" x2="${x - 10}" y2="${y + 30}" style="stroke: ${col}" stroke-width="1.6"/>
          </g>`;
    s += `<text x="${x + 44}" y="${y + 6}" font-size="8" class="s-dim">13</text>`;
    s += `<text x="${x + 44}" y="${y + 84}" font-size="8" class="s-dim">14</text>`;
    return s + label(comp, 30, 103);
  },

  pushbutton_nc(comp, state) {
    const { x, y } = comp;
    const pressed = !!state.pressed;
    const col = comp.params?.color || '#e3342f';
    let s = stub(x + 30, y, x + 30, y + 30);
    s += NCBLADE(x + 30, y + 30, !pressed, 20);
    s += stub(x + 30, y + 50, x + 30, y + 80);
    s += `<g class="press-area" data-press="${comp.id}" cursor="pointer">
            <rect x="${x - 26}" y="${y + 18}" width="26" height="24" rx="6" style="fill: ${pressed ? col : 'var(--sym-body)'}; stroke: ${col}" stroke-width="2"/>
            <line x1="${x}" y1="${y + 30}" x2="${x - 10}" y2="${y + 30}" style="stroke: ${col}" stroke-width="1.6"/>
          </g>`;
    s += `<text x="${x + 44}" y="${y + 6}" font-size="8" class="s-dim">11</text>`;
    s += `<text x="${x + 44}" y="${y + 84}" font-size="8" class="s-dim">12</text>`;
    return s + label(comp, 30, 103);
  },

  selector2(comp, state) {
    const { x, y } = comp;
    const on = state.pos === '1';
    let s = stub(x + 30, y, x + 30, y + 30);
    s += BLADE(x + 30, y + 30, on, 20);
    s += stub(x + 30, y + 50, x + 30, y + 80);
    s += `<g class="toggle-area" data-toggle="${comp.id}" cursor="pointer">
            <circle cx="${x - 14}" cy="${y + 40}" r="9" class="s-body" style="stroke: ${on ? 'var(--accent2)' : 'var(--sym-idle)'}" stroke-width="2"/>
            <line x1="${x - 14}" y1="${y + 40}" x2="${x - 14 + (on ? 8 : -8)}" y2="${y + 40 - (on ? 0 : 6)}" style="stroke: ${on ? 'var(--accent2)' : 'var(--sym-idle)'}" stroke-width="2.4"/>
          </g>`;
    return s + label(comp, 30, 103);
  },

  timer_on(comp, state) {
    const { x, y } = comp;
    const done = !!state.done;
    const e = !!state.energized;
    let s = stub(x + 30, y, x + 30, y + 13);
    s += `<circle cx="${x + 30}" cy="${y + 25}" r="12" class="s-body" style="stroke: ${e ? 'var(--accent)' : 'var(--sym-idle)'}" stroke-width="1.8"/>`;
    s += `<text x="${x + 30}" y="${y + 29}" text-anchor="middle" font-size="9" class="s-dim">t</text>`;
    s += stub(x + 30, y + 37, x + 30, y + 50);
    s += stub(x + 30, y + 90, x + 30, y + 98);
    s += done
      ? `<line x1="${x + 30}" y1="${y + 98}" x2="${x + 30}" y2="${y + 122}" class="s-blade" stroke-width="2.6"/>`
      : `<path d="M ${x + 30} ${y + 98} q 16 12 0 24" fill="none" class="s-stroke" stroke-width="2.6"/>`;
    s += stub(x + 30, y + 122, x + 30, y + 130);
    return s + label(comp, 30, 153);
  },

  lamp(comp, state) {
    const { x, y } = comp;
    const lit = !!state.lit;
    const col = comp.params?.color || '#38c172';
    let s = stub(x + 25, y, x + 25, y + 26);
    s += `<circle cx="${x + 25}" cy="${y + 40}" r="14" class="s-body" style="fill: ${lit ? col : 'var(--sym-body)'}; stroke: ${lit ? col : 'var(--sym-idle)'}" stroke-width="2" ${lit ? 'filter="url(#glow)"' : ''}/>`;
    s += stub(x + 25, y + 54, x + 25, y + 80);
    if (lit) {
      for (const [dx, dy] of [[-22, -22], [22, -22], [-22, 22], [22, 22]]) {
        s += `<line x1="${x + 25 + dx * 0.72}" y1="${y + 40 + dy * 0.72}" x2="${x + 25 + dx}" y2="${y + 40 + dy}" style="stroke: ${col}" stroke-width="1.6" opacity="0.8"/>`;
      }
    }
    return s + label(comp, 25, 98);
  },

  buzzer(comp, state) {
    const { x, y } = comp;
    const on = !!state.on;
    const col = comp.params?.color || '#e3342f';
    let s = stub(x + 25, y, x + 25, y + 26);
    s += `<path d="M ${x + 11} ${y + 48} a 14 14 0 0 1 28 0 z" class="s-body" style="stroke: ${on ? col : 'var(--sym-idle)'}" stroke-width="2" ${on ? 'filter="url(#glow)"' : ''}/>`;
    s += stub(x + 25, y + 54, x + 25, y + 80);
    if (on) {
      s += `<path d="M ${x + 42} ${y + 30} a 12 12 0 0 1 0 20" fill="none" style="stroke: ${col}" stroke-width="1.6"/>
            <path d="M ${x + 47} ${y + 26} a 17 17 0 0 1 0 28" fill="none" style="stroke: ${col}" stroke-width="1.4" opacity="0.7"/>`;
    }
    return s + label(comp, 25, 98);
  },

  estop(comp, state) {
    const { x, y } = comp;
    const tripped = !!state.pressed;
    let s = stub(x + 20, y, x + 20, y + 32);
    s += NCBLADE(x + 20, y + 32, !tripped, 20);
    s += stub(x + 20, y + 56, x + 20, y + 120);
    s += stub(x + 80, y, x + 80, y + 42);
    s += BLADE(x + 80, y + 42, tripped, 20);
    s += stub(x + 80, y + 66, x + 80, y + 120);
    s += `<g class="estop-area" data-estop="${comp.id}" cursor="pointer">
            <rect x="${x + 26}" y="${y + 30}" width="48" height="48" rx="8" style="fill: #f6c445; stroke: #b58900" stroke-width="2"/>
            <circle cx="${x + 50}" cy="${y + 54}" r="14" style="fill: radial-gradient(circle at 35% 30%, #ff6b5e, var(--bad) 60%, #8c1f1c); stroke: #7a1a17" stroke-width="2"/>
            ${tripped ? `<text x="${x + 50}" y="${y + 96}" text-anchor="middle" font-size="9" style="fill: var(--bad-text)">TRIPPED</text>`
                      : `<text x="${x + 50}" y="${y + 96}" text-anchor="middle" font-size="9" class="s-dim">push = trip</text>`}
          </g>`;
    s += `<text x="${x + 6}" y="${y + 8}" font-size="8" class="s-dim">11</text>`;
    s += `<text x="${x + 66}" y="${y + 8}" font-size="8" class="s-dim">13</text>`;
    return s + label(comp, 55, 128);
  },

  selector3(comp, state) {
    const { x, y } = comp;
    const pos = String(state.pos ?? '0');
    let s = stub(x + 30, y, x + 30, y + 30);
    s += BLADE(x + 30, y + 30, pos === '1' || pos === '2', 20);
    s += stub(x + 30, y + 50, x + 30, y + 80);
    s += `<g class="toggle-area" data-toggle3="${comp.id}" cursor="pointer">
            <circle cx="${x - 14}" cy="${y + 40}" r="9" class="s-body" style="stroke: ${pos !== '0' ? 'var(--accent2)' : 'var(--sym-idle)'}" stroke-width="2"/>
            <line x1="${x - 14}" y1="${y + 40}" x2="${x - 14 + (pos === '1' ? 8 : pos === '2' ? 8 : -8)}" y2="${y + 40 - (pos === '2' ? 6 : 0)}" style="stroke: ${pos !== '0' ? 'var(--accent2)' : 'var(--sym-idle)'}" stroke-width="2.4"/>
          </g>`;
    s += `<text x="${x + 12}" y="${y + 74}" font-size="8" class="s-dim">P1</text>`;
    s += `<text x="${x + 38}" y="${y + 74}" font-size="8" class="s-dim">P2</text>`;
    return s + label(comp, 30, 103);
  },

  pedal(comp, state) {
    const { x, y } = comp;
    const v = Math.max(0, Math.min(1, state.value || 0));
    const engaged = v >= (comp.params?.cutoff ?? 0.05);
    const col = comp.params?.color || '#4fc3f7';
    const a = v * 38; // lever deflection, degrees
    let s = stub(x + 20, y, x + 20, y + 58);
    s += BLADE(x + 20, y + 58, engaged, 24);
    s += stub(x + 20, y + 100, x + 20, y + 140);
    s += `<text x="${x + 34}" y="${y + 6}" font-size="8" class="s-dim">13</text>`;
    s += `<text x="${x + 34}" y="${y + 144}" font-size="8" class="s-dim">14</text>`;
    // the pedal: pivot bottom, lever + foot plate deflect with travel
    s += `<g transform="rotate(${-a} ${x + 58} ${y + 128})">
            <line x1="${x + 58}" y1="${y + 128}" x2="${x + 58}" y2="${y + 36}" style="stroke: ${col}" stroke-width="3.4" stroke-linecap="round"/>
            <rect x="${x + 42}" y="${y + 18}" width="32" height="12" rx="3" style="fill: ${v > 0.02 ? col : 'var(--sym-body)'}; stroke: ${col}" stroke-width="2"/>
          </g>`;
    s += `<circle cx="${x + 58}" cy="${y + 128}" r="4.5" style="fill: var(--sym-idle)"/>`;
    s += `<path d="M ${x + 36} ${y + 124} a 22 22 0 0 0 22 -22" fill="none" class="s-stroke" stroke-width="1.2" stroke-dasharray="3 3"/>`;
    s += `<text x="${x + 58}" y="${y + 146}" text-anchor="middle" font-size="9" class="s-hi">${Math.round(v * 100)}%</text>`;
    // analog reference terminals
    s += `<circle cx="${x + 70}" cy="${y + 30}" r="3" style="fill: ${v > 0.02 ? col : 'var(--sym-idle)'}"/>`;
    s += `<text x="${x + 46}" y="${y + 28}" font-size="7.5" class="s-dim">R+</text>`;
    s += `<circle cx="${x + 70}" cy="${y + 120}" r="3" style="fill: var(--sym-idle)"/>`;
    s += `<text x="${x + 46}" y="${y + 118}" font-size="7.5" class="s-dim">R-</text>`;
    return s + label(comp, 45, 166);
  },

  brake(comp, state) {
    const { x, y } = comp;
    const v = Math.max(0, Math.min(1, state.value || 0));
    const applied = v > 0.02;
    const col = comp.params?.color || '#e3342f';
    const a = v * 38;
    let s = '';
    // NC pole 11-12 (drive interlock) — opens when pressed
    s += stub(x + 20, y, x + 20, y + 15);
    s += NCBLADE(x + 20, y + 15, !applied, 20);
    s += stub(x + 20, y + 39, x + 20, y + 55);
    s += `<text x="${x + 34}" y="${y + 6}" font-size="8" class="s-dim">11</text>`;
    s += `<text x="${x + 34}" y="${y + 59}" font-size="8" class="s-dim">12</text>`;
    // NO pole 13-14 (brake lamps) — closes when pressed
    s += stub(x + 20, y + 95, x + 20, y + 110);
    s += BLADE(x + 20, y + 110, applied, 20);
    s += stub(x + 20, y + 134, x + 20, y + 140);
    s += `<text x="${x + 34}" y="${y + 101}" font-size="8" class="s-dim">13</text>`;
    s += `<text x="${x + 34}" y="${y + 144}" font-size="8" class="s-dim">14</text>`;
    s += `<g transform="rotate(${-a} ${x + 58} ${y + 128})">
            <line x1="${x + 58}" y1="${y + 128}" x2="${x + 58}" y2="${y + 36}" style="stroke: ${col}" stroke-width="3.4" stroke-linecap="round"/>
            <rect x="${x + 42}" y="${y + 18}" width="32" height="12" rx="3" style="fill: ${applied ? col : 'var(--sym-body)'}; stroke: ${col}" stroke-width="2"/>
          </g>`;
    s += `<circle cx="${x + 58}" cy="${y + 128}" r="4.5" style="fill: var(--sym-idle)"/>`;
    s += `<text x="${x + 58}" y="${y + 146}" text-anchor="middle" font-size="9" class="s-hi">${Math.round(v * 100)}%</text>`;
    s += `<text x="${x + 62}" y="${y + 10}" font-size="8" style="fill: ${applied ? 'var(--bad-text)' : 'var(--dim)'}">BRAKE</text>`;
    return s + label(comp, 45, 166);
  },

  vfd(comp, state) {
    const { x, y } = comp;
    const running = !!state.running;
    const fault = !!state.fault;
    const freq = state.freq || 0;
    const dir = state.dir || 0;
    let s = '';
    for (const px of [30, 60, 90]) s += stub(x + px, y, x + px, y + 40);
    s += `<text x="${x + 22}" y="${y + 8}" font-size="8" class="s-dim">L1</text>`;
    s += `<text x="${x + 130}" y="${y + 8}" font-size="8" class="s-dim">R+</text>`;
    s += `<text x="${x + 148}" y="${y + 8}" font-size="8" class="s-dim">R-</text>`;
    // body
    s += `<rect x="${x + 14}" y="${y + 40}" width="140" height="118" rx="8" class="s-body" style="stroke: ${fault ? 'var(--bad)' : running ? 'var(--ok)' : 'var(--sym-idle)'}" stroke-width="2" ${running ? 'filter="url(#glow)"' : ''}/>`;
    s += `<text x="${x + 84}" y="${y + 62}" text-anchor="middle" font-size="13" font-weight="700" class="s-hi">VFD</text>`;
    s += `<text x="${x + 84}" y="${y + 88}" text-anchor="middle" font-size="15" font-weight="700" class="${running ? 's-hi' : 's-dim'}" style="${running ? 'fill: var(--ok)' : ''}">${freq.toFixed(1)}<tspan font-size="9"> Hz</tspan></text>`;
    s += `<text x="${x + 84}" y="${y + 110}" text-anchor="middle" font-size="10" class="s-dim">${fault ? 'FAULT FWD+REV' : running ? (dir > 0 ? '▶ forward' : '◀ reverse') : 'output off'}</text>`;
    // ramp bar
    s += `<rect x="${x + 30}" y="${y + 122}" width="108" height="8" rx="3" class="s-stroke2" fill="none" stroke-width="1"/>`;
    s += `<rect x="${x + 31}" y="${y + 123}" width="${106 * Math.min(1, freq / (comp.params?.base || 50))}" height="6" rx="2" style="fill: ${running ? 'var(--ok)' : 'var(--sym-idle)'}"/>`;
    // digital inputs on the right edge
    for (const [t, dy] of [['FWD', 40], ['REV', 80], ['COM', 120]]) {
      s += stub(x + 154, y + dy, x + 160, y + dy);
      s += `<text x="${x + 124}" y="${y + dy - 5}" font-size="8" class="s-dim">${t}</text>`;
    }
    // motor output
    for (const px of [30, 60, 90]) s += stub(x + px, y + 158, x + px, y + 198);
    s += `<text x="${x + 96}" y="${y + 182}" font-size="8" class="s-dim">U V W</text>`;
    return s + label(comp, 84, 220);
  },

  floorselector(comp, state) {
    const { x, y } = comp;
    const sel = state.floor || 0;
    const max = Math.min(10, Math.max(2, Math.round(comp.params?.floors ?? 10)));
    let s = stub(x + 20, y + 30, x + 20, y + 66);
    s += `<text x="${x + 2}" y="${y + 24}" font-size="8" class="s-dim">COM</text>`;
    s += `<rect x="${x + 28}" y="${y + 60}" width="58" height="${Math.max(4, max) * 25 + 18}" rx="8" class="s-body s-stroke2"/>`;
    s += `<text x="${x + 57}" y="${y + 78}" text-anchor="middle" font-size="8.5" class="s-dim">CAR CALLS</text>`;
    for (let i = 1; i <= 10; i++) {
      const row = (i - 1) % 5, col = i <= 5 ? 0 : 1;
      const bx = x + 42 + col * 26, by = y + 96 + row * 25;
      const active = sel === i, wired = i <= max;
      if (!wired) continue;
      s += `<g class="cop-floor" data-copfloor="${comp.id}:${i}" cursor="pointer">
              <circle cx="${bx}" cy="${by}" r="9" style="fill: ${active ? 'var(--accent)' : 'var(--sym-body)'}; stroke: ${active ? 'var(--accent)' : 'var(--sym-idle)'}" stroke-width="1.8"/>
              <text x="${bx}" y="${by + 3.5}" text-anchor="middle" font-size="9" class="${active ? 's-body' : 's-dim'}" style="${active ? 'fill: var(--bg)' : ''}">${i}</text>
            </g>`;
    }
    for (let i = 1; i <= 10; i++) {
      const ty = y + 70 + (i - 1) * 26;
      const wired = i <= max;
      s += `<circle cx="${x + 100}" cy="${ty}" r="2.6" style="fill: ${wired ? 'var(--sym-idle)' : 'var(--sym-idle)'}; opacity: ${wired ? 1 : 0.25}"/>`;
      if (wired) s += `<line x1="${x + 88}" y1="${ty}" x2="${x + 100}" y2="${ty}" class="s-stroke" stroke-width="1.4"/>`;
      s += `<text x="${x + 108}" y="${ty + 3.5}" font-size="8" class="${sel === i ? 's-hi' : 's-dim'}">${i}</text>`;
    }
    return s + label(comp, 60, 345);
  },

  floordisplay(comp, state) {
    const { x, y } = comp;
    const f = state.floor ?? 0;
    const col = comp.params?.color || '#ffb454';
    const txt = f === -1 ? 'E' : f === 0 ? '' : String(f);
    let s = '';
    s += stub(x + 15, y, x + 15, y + 42);
    s += `<text x="${x + 2}" y="${y + 8}" font-size="8" class="s-dim">U</text>`;
    s += stub(x + 35, y, x + 35, y + 42);
    s += `<text x="${x + 28}" y="${y + 8}" font-size="8" class="s-dim">D</text>`;
    s += stub(x + 135, y, x + 135, y + 42);
    s += `<text x="${x + 122}" y="${y + 8}" font-size="8" class="s-dim">N</text>`;
    s += `<rect x="${x + 14}" y="${y + 42}" width="122" height="66" rx="8" class="s-body s-stroke2"/>`;
    s += `<rect x="${x + 22}" y="${y + 50}" width="106" height="50" rx="4" style="fill: #10151d; stroke: var(--sym-idle)" stroke-width="1"/>`;
    s += `<text x="${x + 75}" y="${y + 88}" text-anchor="middle" font-size="34" font-weight="700" style="fill: ${txt ? col : '#2a2f38'}; font-family: var(--mono, monospace)" ${txt ? 'filter="url(#glow)"' : ''}>${txt || '8'}</text>`;
    s += `<path d="M ${x + 34} ${y + 66} l 8 -12 l 8 12 z" style="fill: ${state.up ? col : '#2a2f38'}; stroke: ${state.up ? col : 'var(--sym-idle)'}" stroke-width="1"/>`;
    s += `<path d="M ${x + 106} ${y + 62} l 8 12 l 8 -12 z" style="fill: ${state.down ? col : '#2a2f38'}; stroke: ${state.down ? col : 'var(--sym-idle)'}" stroke-width="1"/>`;
    for (let i = 1; i <= 10; i++) {
      const tx = 55 + (i - 1) * 8;
      s += `<circle cx="${x + tx}" cy="${y + 138}" r="2.2" style="fill: ${f === i ? col : 'var(--sym-idle)'}"/>`;
    }
    return s + label(comp, 75, 160);
  },

  cam10(comp, state) {
    const { x, y } = comp;
    const pos = Math.min(10, Math.max(1, state.position || 1));
    const wy = y + 70 + (pos - 1) * 33;
    let s = stub(x + 20, y + 8, x + 20, y + 30);
    s += `<text x="${x + 6}" y="${y + 4}" font-size="8" class="s-dim">COM</text>`;
    s += `<line x1="${x + 20}" y1="${y + 30}" x2="${x + 20}" y2="${wy}" class="s-blade" stroke-width="2.6"/>`;
    // deck B and C rails jump over the current floor (complement contacts)
    for (const [railX, deck] of [[95, 'G'], [165, 'H']]) {
      const gapTop = wy - 8, gapBot = wy + 8;
      s += `<line x1="${x + railX}" y1="${y + 70}" x2="${x + railX}" y2="${gapTop}" class="s-blade" stroke-width="2"/>`;
      s += `<line x1="${x + railX}" y1="${gapBot}" x2="${x + railX}" y2="${y + 70 + 9 * 33 + 10}" class="s-blade" stroke-width="2"/>`;
    }
    // deck D: isolated indicator deck (ICOM → IF position)
    s += stub(x + 270, y + 8, x + 270, y + 30);
    s += `<text x="${x + 252}" y="${y + 4}" font-size="8" class="s-dim">ICOM</text>`;
    s += `<line x1="${x + 270}" y1="${y + 30}" x2="${x + 270}" y2="${wy}" style="stroke: var(--accent2)" stroke-width="2.6"/>`;
    for (let i = 1; i <= 10; i++) {
      const ry = y + 70 + (i - 1) * 33;
      const at = i === pos;
      for (const [px, name] of [[20, `F${i}`], [95, `G${i}`], [130, `GH${i}`], [165, `H${i}`], [210, `HH${i}`], [270, `IF${i}`]]) {
        const ind = px === 270;
        s += `<circle cx="${x + px}" cy="${ry}" r="2.6" style="fill: ${at && (px === 20 || ind) ? (ind ? 'var(--accent2)' : 'var(--accent)') : 'var(--sym-idle)'}"/>`;
        s += `<text x="${x + px + (px === 20 ? 8 : -10)}" y="${ry + 3.5}" font-size="8" class="${at && (px === 20 || ind) ? 's-hi' : 's-dim'}">${name}</text>`;
      }
    }
    s += `<circle cx="${x + 62}" cy="${wy}" r="11" class="s-body" style="stroke: var(--accent)" stroke-width="2"/>`;
    s += `<text x="${x + 62}" y="${wy + 4}" text-anchor="middle" font-size="12" font-weight="700" class="s-hi">${pos}</text>`;
    return s + label(comp, 150, 425);
  },

  junction(comp) {
    return `<circle cx="${comp.x + 10}" cy="${comp.y + 10}" r="5" style="fill: var(--sym-idle)"/>` + label(comp, 10, 30, 10);
  }
};

export const PALETTE_GROUPS = [
  ['Sources', ['supply3']],
  ['Protection', ['breaker3', 'breaker1', 'fuse3', 'fuse1', 'overload']],
  ['Switching', ['contactor', 'vfd']],
  ['Control', ['pushbutton_no', 'pushbutton_nc', 'selector2', 'selector3', 'timer_on', 'estop', 'pedal', 'brake']],
  ['Loads', ['motor3']],
  ['Signalling', ['lamp', 'buzzer', 'floordisplay', 'junction']],
  ['Elevator', ['floorselector', 'cam10']]
];
