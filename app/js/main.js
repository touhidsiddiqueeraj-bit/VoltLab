// app/js/main.js — UI bootstrap: theme, host transport (server or in-page), interactions.
import { DEVICE_TYPES } from '/sim/devices.js';
import { PALETTE_GROUPS, SYMBOLS } from './symbols.js';
import { renderScene, parseRef } from './render.js';
import { recordDemo } from './video.js';
import { buildReport } from './report.js';
import { startTutorial } from './tutorial.js';
import { initHost } from './host.js';

const $ = (sel) => document.querySelector(sel);
const svg = $('#canvas');

const ui = {
  selected: null,
  pendingTerm: null,   // first terminal clicked when wiring
  placing: null,       // palette type being placed
  dragging: null,      // {id, dx, dy}
  cursor: { x: 0, y: 0 },
  zoom: 1,
  pendingFit: false,   // auto-fit once after a circuit load
  snapshot: null
};
const rotorAngles = new Map();  // motor id -> visual angle (deg), animated between snapshots
let lastFrame = performance.now();
let unseenEvents = 0;

// ---------- theme ----------
function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  $('#btn-theme').textContent = theme === 'dark' ? '☀️' : '🌙';
  localStorage.setItem('vl-theme', theme);
}
function initTheme() {
  const saved = localStorage.getItem('vl-theme');
  const prefersLight = window.matchMedia?.('(prefers-color-scheme: light)').matches;
  applyTheme(saved || (prefersLight ? 'light' : 'dark'));
  $('#btn-theme').onclick = () =>
    applyTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark');
}

// ---------- transport (server.js or in-page engine — app/js/host.js) ----------
let host = null;   // wired in boot(); every command flows through it

async function cmd(tool, args = {}) {
  if (!host) return { ok: false, error: 'starting up…' };
  try {
    const r = await host.call(tool, args);
    if (r.ok === false) toast(`${tool}: ${r.error}`);
    else window.dispatchEvent(new CustomEvent('vl-action', { detail: { tool, args, result: r } }));
    return r;
  } catch (e) {
    toast(`command failed: ${e.message}`);
    return { ok: false };
  }
}

let toastTimer;
function toast(msg) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.add('hidden'), 3200);
}

function closeMenus() {
  document.querySelectorAll('details.menu[open]').forEach(d => d.removeAttribute('open'));
}

// ---------- state stream ----------
function handleState(snap) {
  $('#st-conn').className = 'dot on';
  // A drag in progress owns the dragged component's position — keep the
  // locally-tracked coordinates instead of snapping back to the engine copy.
  if (ui.dragging?.moved) {
    const c = snap.components.find(x => x.id === ui.dragging.id);
    if (c) { c.x = ui.dragging.x; c.y = ui.dragging.y; }
  }
  ui.snapshot = snap;
  updateStatus(ui.snapshot);
  renderNow();
  renderLog(ui.snapshot);
}

function handleExportRequest({ kind, name }) {
  if (kind === 'video') {
    recordDemo(name).then(r => toast(`video saved → ${r.path}`)).catch(e => toast(`video export failed: ${e.message}`));
  } else if (kind === 'pdf') {
    buildReport(ui.snapshot).then(html => host.submitReport(html, name)).catch(() => {});
  }
}

function updateStatus(s) {
  updateMimic(s);
  $('#st-circuit').textContent = s.circuit;
  const sel = $('#circuit-select');
  if (s.circuit && sel.value !== s.circuit && [...sel.options].some(o => o.value === s.circuit)) sel.value = s.circuit;
  $('#st-time').textContent = `t = ${s.t.toFixed(1)} s`;
  $('#st-run').textContent = s.running ? 'running' : 'paused';
  $('#st-count').textContent = `${s.components.length} comps · ${s.wires.length} wires`;
  $('#welcome').classList.toggle('hidden', s.components.length > 0);
  consumePendingFit();
  const btn = $('#btn-run');
  btn.textContent = s.running ? '⏸ Pause' : '▶ Run';
  btn.classList.toggle('paused', !s.running);
  const faults = Object.keys(s.faults || {});
  $('#st-faults').textContent = faults.length ? `FAULTS: ${faults.join(', ')}` : '';
}

// ---------- operator console: mimic buttons, pedals, drives, car panel, motors ----------
// Rebuilt only when the circuit's device set changes (signature check), so the
// press targets are stable across the 10 Hz status updates.
let mimicSig = null;
let mimicHeld = null;
const mimicStallSince = new Map();
const pedalLocal = new Map();   // pedal id -> locally dragged value (until snapshot confirms)
const pedalSentAt = new Map();  // throttle set_pedal traffic while dragging
let pedalDragging = null;       // { id, trackEl } while a pedal is being dragged

function mimicRole(c) {
  const rest = c.label.startsWith(c.id) ? c.label.slice(c.id.length).trim() : c.label;
  return rest || (c.type === 'pushbutton_nc' ? 'NC contact' : 'NO contact');
}

function updateMimic(s) {
  const rel = s.components.filter(c =>
    c.type === 'pushbutton_no' || c.type === 'pushbutton_nc' || c.type === 'motor3' ||
    c.type === 'estop' || c.type === 'pedal' || c.type === 'brake' || c.type === 'vfd' ||
    c.type === 'floorselector' || c.type === 'floordisplay' || c.type === 'cam10');
  const sig = rel.map(c => `${c.id}:${c.type}:${c.label}:${c.type === 'floorselector' ? (c.params.floors ?? 10) : ''}`).join('|');
  if (sig !== mimicSig) {
    mimicSig = sig;
    const byType = (t) => rel.filter(c => c.type === t);
    const btns = rel.filter(c => c.type === 'pushbutton_no' || c.type === 'pushbutton_nc');
    const motors = byType('motor3');

    $('#mimic-buttons').innerHTML = btns.map(c => `
      <div class="mimic-btn-wrap">
        <button class="mimic-btn ${c.type === 'pushbutton_nc' ? 'nc' : 'no'}" data-mimic="${c.id}"
                aria-label="hold ${escapeHtml(c.label)}"><span>${c.id}</span></button>
        <span class="mimic-cap" title="${escapeHtml(c.label)}">${escapeHtml(mimicRole(c))}</span>
      </div>`).join('') || '<span class="mimic-empty">no push buttons</span>';

    const estops = byType('estop');
    $('#mg-estop').hidden = estops.length === 0;
    $('#mimic-estops').innerHTML = estops.map(c => `
      <div class="mimic-btn-wrap">
        <button class="estop-btn" data-mestop="${c.id}" aria-label="emergency stop ${escapeHtml(c.label)}"><span>STOP</span></button>
        <span class="mimic-cap">${escapeHtml(c.label)}</span>
      </div>`).join('');

    const pedals = [...byType('pedal'), ...byType('brake')];
    $('#mg-pedals').hidden = pedals.length === 0;
    $('#mimic-pedals').innerHTML = pedals.map(c => `
      <div class="pedal-widget" data-pedal-widget="${c.id}">
        <div class="pedal-track ${c.type === 'brake' ? 'brk' : 'acc'}" data-pedal-track="${c.id}" role="slider"
             aria-label="${c.type === 'brake' ? 'brake' : 'throttle'} ${escapeHtml(c.label)}" tabindex="0"
             aria-valuemin="0" aria-valuemax="100" aria-valuenow="0">
          <div class="pedal-fill"></div>
          <div class="pedal-knob"></div>
        </div>
        <span class="pedal-id">${c.id}</span>
        <span class="pedal-val">0%</span>
      </div>`).join('');

    const elev = [...byType('floorselector'), ...byType('floordisplay'), ...byType('cam10')];
    $('#mg-elevator').hidden = elev.length === 0;
    const fsel = byType('floorselector')[0];
    const cam = byType('cam10')[0];
    const floors = fsel ? Math.min(10, Math.max(2, fsel.params.floors ?? 10)) : (cam ? 10 : 0);
    let elevHtml = '';
    if (elev.length) {
      elevHtml += `<div class="car-display" data-car-display>
          <span class="car-arrow up" data-car-up>▲</span>
          <span class="car-digit" data-car-digit>&nbsp;</span>
          <span class="car-arrow down" data-car-down>▼</span>
        </div>`;
    }
    if (fsel) {
      elevHtml += `<div class="car-calls">` + Array.from({ length: floors }, (_, i) => i + 1).map(f => `
          <button class="car-call" data-carcall="${fsel.id}:${f}">${f}</button>`).join('') + `</div>`;
    }
    if (cam) {
      // simulate the hoist: move the car position (kept alongside real car calls,
      // because something still has to advance the floor cam between floors)
      elevHtml += `<div class="car-calls demo">` + Array.from({ length: floors }, (_, i) => i + 1).map(f => `
          <button class="car-call demo" data-carmove="${cam.id}:${f}" title="move the car to floor ${f} (demo)">${f}</button>`).join('')
        + `<span class="car-note">move car</span></div>`;
    }
    $('#mimic-elevator').innerHTML = elevHtml;

    const drives = byType('vfd');
    $('#mg-drives').hidden = drives.length === 0;
    $('#mimic-drives').innerHTML = drives.map(c => `
      <div class="mimic-motor" data-mdrive="${c.id}">
        <span class="drive-freq">0.0<span class="hz">Hz</span></span>
        <span class="mimic-mot-meta">
          <span class="mimic-mot-id">${escapeHtml(c.id)}</span>
          <span class="mimic-mot-state">off</span>
        </span>
      </div>`).join('');

    $('#mimic-motors').innerHTML = motors.map(c => `
      <div class="mimic-motor" data-mmotor="${c.id}">
        <span class="mimic-disc"><span class="rotor"><i></i></span></span>
        <span class="mimic-mot-meta">
          <span class="mimic-mot-id">${escapeHtml(c.id)}</span>
          <span class="mimic-mot-state">stopped</span>
        </span>
      </div>`).join('') || '<span class="mimic-empty">no motors</span>';
    $('#mimic-panel').hidden = rel.length === 0;
  }

  for (const c of s.components) {
    if (c.type === 'pushbutton_no' || c.type === 'pushbutton_nc') {
      const el = document.querySelector(`[data-mimic="${c.id}"]`);
      if (el) el.classList.toggle('pressed', !!c.state.pressed);
    } else if (c.type === 'estop') {
      const el = document.querySelector(`[data-mestop="${c.id}"]`);
      if (el) el.classList.toggle('tripped', !!c.state.pressed);
    } else if (c.type === 'pedal' || c.type === 'brake') {
      const widget = document.querySelector(`[data-pedal-widget="${c.id}"]`);
      if (!widget) continue;
      const local = pedalDragging?.id === c.id ? pedalLocal.get(c.id) : undefined;
      const v = local !== undefined ? local : (c.state.value || 0);
      const track = widget.querySelector('.pedal-track');
      const fill = widget.querySelector('.pedal-fill');
      const knob = widget.querySelector('.pedal-knob');
      const valEl = widget.querySelector('.pedal-val');
      fill.style.height = `${Math.round(v * 100)}%`;
      knob.style.bottom = `calc(${Math.round(v * 100)}% - 9px)`;
      valEl.textContent = `${Math.round(v * 100)}%`;
      valEl.classList.toggle('on', v > 0.02);
      track.setAttribute('aria-valuenow', Math.round(v * 100));
    } else if (c.type === 'vfd') {
      const wrap = document.querySelector(`[data-mdrive="${c.id}"]`);
      if (!wrap) continue;
      const freqEl = wrap.querySelector('.drive-freq');
      const stateEl = wrap.querySelector('.mimic-mot-state');
      freqEl.firstChild.textContent = (c.state.freq || 0).toFixed(1);
      let cls = '', txt = 'off';
      if (c.state.fault) { cls = 'stall'; txt = 'FAULT'; }
      else if (c.state.running) { cls = 'run'; txt = c.state.dir > 0 ? 'forward' : 'reverse'; }
      stateEl.className = `mimic-mot-state ${cls}`;
      stateEl.textContent = txt;
    } else if (c.type === 'motor3') {
      const wrap = document.querySelector(`[data-mmotor="${c.id}"]`);
      if (!wrap) continue;
      const disc = wrap.querySelector('.mimic-disc');
      const rotor = disc.querySelector('.rotor');
      const stateEl = wrap.querySelector('.mimic-mot-state');
      const sp = c.state.speed || 0;
      const flc = c.params.flc || 10;
      // a jammed rotor sits at ~6x FLC while still powered; a normal start passes
      // that only for ~0.1 s, so require the condition to persist before alarming
      const stallCond = !!c.state.dir && Math.abs(sp) < 0.05 && Math.abs(c.state.current || 0) >= 5 * flc;
      if (!stallCond) mimicStallSince.delete(c.id);
      else if (!mimicStallSince.has(c.id)) mimicStallSince.set(c.id, performance.now());
      const stalled = stallCond && performance.now() - mimicStallSince.get(c.id) > 800;

      let cls = '', txt;
      if (stalled) { cls = 'stall'; txt = 'stalled'; }
      else if (Math.abs(sp) <= 0.01) { txt = 'stopped'; }
      else if (!c.state.dir) { cls = 'coast'; txt = 'coasting'; }
      else { cls = 'run'; txt = sp > 0 ? 'clockwise' : 'counter-clockwise'; }

      disc.className = `mimic-disc ${cls}`;
      if (cls === 'run' || cls === 'coast') {
        rotor.style.animationPlayState = 'running';
        rotor.style.animationDuration = `${Math.max(0.28, 1.4 / Math.abs(sp)).toFixed(2)}s`;
        rotor.style.animationDirection = sp < 0 ? 'reverse' : 'normal';
      } else {
        rotor.style.animationPlayState = 'paused';
      }
      stateEl.className = `mimic-mot-state ${cls}`;
      stateEl.textContent = Math.abs(sp) > 0.01 ? `${txt} · ${Math.round(Math.abs(sp) * 100)} %` : txt;
    }
  }

  // ---- car display (floor indicator) ----
  const digitEl = document.querySelector('[data-car-digit]');
  if (digitEl) {
    const fds = s.components.filter(c => c.type === 'floordisplay');
    const cams = s.components.filter(c => c.type === 'cam10');
    let floor = null, up = false, down = false;
    if (fds.length) {
      floor = fds[0].state.floor ?? 0;
      up = !!fds[0].state.up; down = !!fds[0].state.down;
    } else if (cams.length) {
      floor = cams[0].state.position ?? 0;
    }
    if (floor !== null) {
      const motors = s.components.filter(c => c.type === 'motor3');
      const running = motors.find(c => Math.abs(c.state.speed || 0) > 0.05);
      if (!fds.length && running) { up = (running.state.speed || 0) > 0; down = !up; }
      digitEl.textContent = floor === -1 ? 'E' : (floor === 0 ? '\u00a0' : String(floor));
      digitEl.classList.toggle('lit', floor !== 0);
    }
    const upEl = document.querySelector('[data-car-up]');
    const dnEl = document.querySelector('[data-car-down]');
    if (upEl) upEl.classList.toggle('lit', up);
    if (dnEl) dnEl.classList.toggle('lit', down);
  }

  // ---- car call buttons ----
  const fsel = s.components.find(c => c.type === 'floorselector');
  if (fsel) {
    document.querySelectorAll('[data-carcall]').forEach(b => {
      const f = Number(b.dataset.carcall.split(':')[1]);
      b.classList.toggle('lit', fsel.state.floor === f);
    });
  }
  const cam2 = s.components.find(c => c.type === 'cam10');
  if (cam2) {
    document.querySelectorAll('[data-carmove]').forEach(b => {
      const f = Number(b.dataset.carmove.split(':')[1]);
      b.classList.toggle('lit', cam2.state.position === f);
    });
  }
}

// panel buttons behave like the physical ones: hold to press, release anywhere
$('#mimic-panel').addEventListener('pointerdown', (e) => {
  const btn = e.target.closest?.('[data-mimic]');
  if (!btn) return;
  e.preventDefault();
  mimicHeld = btn.dataset.mimic;
  cmd('press_button', { id: mimicHeld });
});
const releaseMimicHeld = () => {
  if (!mimicHeld) return;
  const id = mimicHeld;
  mimicHeld = null;
  // keep the press alive across at least one sim tick, like canvas presses
  setTimeout(() => cmd('release_button', { id }), 120);
};
window.addEventListener('pointerup', releaseMimicHeld);
window.addEventListener('pointercancel', releaseMimicHeld);

// ---- e-stop mushroom: click trips it; click again twist-releases ----
function toggleEstop(id) {
  const c = ui.snapshot?.components.find(x => x.id === id);
  if (!c) return;
  cmd('set_switch', { id, closed: !!c.state.pressed }); // pressed → release (closed)
}
$('#mimic-panel').addEventListener('click', (e) => {
  const stop = e.target.closest?.('[data-mestop]');
  if (stop) { toggleEstop(stop.dataset.mestop); return; }
  const call = e.target.closest?.('[data-carcall]');
  if (call) {
    const [id, f] = call.dataset.carcall.split(':');
    const c = ui.snapshot?.components.find(x => x.id === id);
    if (c) cmd('set_floor', { id, floor: c.state.floor === Number(f) ? 0 : Number(f) }); // toggle
    return;
  }
  const move = e.target.closest?.('[data-carmove]');
  if (move) {
    const [id, f] = move.dataset.carmove.split(':');
    cmd('set_position', { id, position: Number(f) });
  }
});

// ---- analog pedal sliders: drag the knob like a real pedal ----
function pedalFromEvent(track, clientY) {
  const r = track.getBoundingClientRect();
  return Math.max(0, Math.min(1, (r.bottom - clientY) / r.height));
}
function sendPedal(id, value, final = false) {
  const now = performance.now();
  if (!final && now - (pedalSentAt.get(id) || 0) < 90) return;
  pedalSentAt.set(id, now);
  pedalLocal.set(id, value);
  cmd('set_pedal', { id, value });
}
$('#mimic-pedals').addEventListener('pointerdown', (e) => {
  const track = e.target.closest?.('[data-pedal-track]');
  if (!track) return;
  e.preventDefault();
  pedalDragging = { id: track.dataset.pedalTrack, track };
  track.setPointerCapture?.(e.pointerId);
  sendPedal(pedalDragging.id, pedalFromEvent(track, e.clientY), true);
});
window.addEventListener('pointermove', (e) => {
  if (!pedalDragging) return;
  sendPedal(pedalDragging.id, pedalFromEvent(pedalDragging.track, e.clientY));
});
const endPedalDrag = () => {
  if (!pedalDragging) return;
  const { id } = pedalDragging;
  pedalDragging = null;
  sendPedal(id, pedalLocal.get(id) ?? 0, true);
  setTimeout(() => pedalLocal.delete(id), 500); // let the snapshot confirm
};
window.addEventListener('pointerup', endPedalDrag);
window.addEventListener('pointercancel', endPedalDrag);
// keyboard: focus a pedal track, press up/down to feather it
$('#mimic-pedals').addEventListener('keydown', (e) => {
  const track = e.target.closest?.('[data-pedal-track]');
  if (!track) return;
  const id = track.dataset.pedalTrack;
  const c = ui.snapshot?.components.find(x => x.id === id);
  const v = pedalLocal.get(id) ?? (c?.state.value || 0);
  if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
    e.preventDefault();
    const step = e.shiftKey ? 0.25 : 0.05;
    sendPedal(id, Math.max(0, Math.min(1, v + (e.key === 'ArrowUp' ? step : -step))), true);
  } else if (e.key === 'Home' || e.key === 'End') {
    e.preventDefault();
    sendPedal(id, e.key === 'End' ? 0 : 1, true);
  }
});

function renderLog(s) {
  const last = s.log[s.log.length - 1];
  if (last) $('#log-ticker').textContent = `${last.t.toFixed(1)}s · ${last.msg}`;
  if (!$('#log-drawer').open && last) {
    unseenEvents++;
    $('.log-label').textContent = `Log (${unseenEvents})`;
  }
  const el = $('#eventlog');
  el.innerHTML = s.log.map(v =>
    `<div class="ev ${v.level}"><span class="t">${v.t.toFixed(1)}s</span>${escapeHtml(v.msg)}</div>`
  ).join('');
  el.scrollTop = el.scrollHeight;
}
$('#log-drawer').addEventListener('toggle', () => {
  if ($('#log-drawer').open) { unseenEvents = 0; $('.log-label').textContent = 'Log'; }
});

const escapeHtml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');

// exposed for agent-driven exports via evaluate()
window.__voltlab = { recordDemo, buildReport, snapshot: () => ui.snapshot };

// ---------- render loop ----------
function renderNow() {
  if (!ui.snapshot) return;
  renderScene(svg, ui.snapshot, ui, rotorAngles);
  renderInspector();
}

function frame(now) {
  const dt = (now - lastFrame) / 1000;
  lastFrame = now;
  if (ui.snapshot) {
    let spinning = false;
    for (const c of ui.snapshot.components) {
      if (c.type === 'motor3' && Math.abs(c.state.speed) > 0.01) {
        // signed speed — negative = reverse, so the rotor visibly spins both ways
        rotorAngles.set(c.id, ((rotorAngles.get(c.id) || 0) + c.state.speed * dt * 320) % 360);
        spinning = true;
      }
    }
    if (spinning || ui.placing || ui.pendingTerm || ui.dragging) renderScene(svg, ui.snapshot, ui, rotorAngles);
  }
  requestAnimationFrame(frame);
}

// ---------- palette ----------
function buildPalette() {
  const root = $('#palette-groups');
  for (const [group, types] of PALETTE_GROUPS) {
    const div = document.createElement('div');
    div.className = 'palette-group';
    div.innerHTML = `<h3>${group}</h3>` + types.map(t =>
      `<div class="palette-item" data-type="${t}"><span>${DEVICE_TYPES[t].label}</span></div>`).join('');
    root.appendChild(div);
  }
  root.addEventListener('click', (e) => {
    const item = e.target.closest('.palette-item');
    if (!item) return;
    const type = item.dataset.type;
    if (ui.placing === type) { cancelPlace(); return; }
    ui.placing = type;
    document.querySelectorAll('.palette-item').forEach(i => i.classList.toggle('active', i.dataset.type === type));
  });

  // live component filter — hides items and whole groups with no match
  $('#palette-filter').addEventListener('input', (e) => {
    const q = e.target.value.trim().toLowerCase();
    for (const group of root.querySelectorAll('.palette-group')) {
      let visible = 0;
      for (const item of group.querySelectorAll('.palette-item')) {
        const type = item.dataset.type;
        const spec = DEVICE_TYPES[type];
        const hit = !q || spec.label.toLowerCase().includes(q) || type.toLowerCase().includes(q);
        item.style.display = hit ? '' : 'none';
        if (hit) visible++;
      }
      group.style.display = visible ? '' : 'none';
    }
  });
  $('#palette-filter').addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { e.target.value = ''; e.target.dispatchEvent(new Event('input')); e.target.blur(); }
  });
}

function cancelPlace() {
  ui.placing = null;
  document.querySelectorAll('.palette-item').forEach(i => i.classList.remove('active'));
  renderNow();
}

// ---------- inspector ----------
function renderInspector() {
  const s = ui.snapshot;
  const body = $('#inspector-body');
  if (!s || !ui.selected) {
    // circuit overview instead of a dead panel
    body.className = 'empty';
    if (s && s.components.length) {
      const faults = Object.keys(s.faults || {});
      const motors = s.components.filter(c => c.type === 'motor3');
      const running = motors.filter(c => Math.abs(c.state.speed || 0) > 0.05);
      body.innerHTML = `
        <div class="insp-overview">
          <div class="insp-title">${escapeHtml(s.circuit || 'canvas')}</div>
          <div class="kv">
            <span class="k">components</span><span class="v">${s.components.length}</span>
            <span class="k">wires</span><span class="v">${s.wires.length}</span>
            <span class="k">sim time</span><span class="v">${s.t.toFixed(1)} s</span>
            <span class="k">motors</span><span class="v">${motors.length ? `${running.length}/${motors.length} running` : 'none'}</span>
            <span class="k">faults</span><span class="v ${faults.length ? 'fault' : 'off'}">${faults.length ? faults.join(', ') : 'none'}</span>
          </div>
          <p class="insp-tip">Click a component to inspect and edit it.</p>
        </div>`;
    } else {
      body.innerHTML = 'Nothing selected.<br>Click a component on the canvas.';
    }
    return;
  }
  const c = s.components.find(x => x.id === ui.selected);
  if (!c) { ui.selected = null; return; }
  body.className = '';
  const spec = DEVICE_TYPES[c.type];
  const stateRows = Object.entries(c.state).map(([k, v]) => {
    let cls = typeof v === 'boolean' ? (v ? 'on' : 'off') : '';
    let val = typeof v === 'boolean' ? (v ? 'true' : 'false') : String(v);
    if (k === 'tripped' && v) cls = 'fault';
    if (k === 'blown' && Array.isArray(v) && v.some(x => x)) cls = 'fault';
    if (k === 'dir' && c.type === 'motor3') val = v > 0 ? 'forward' : v < 0 ? 'reverse' : '—';
    return `<span class="k">${k}</span><span class="v ${cls}">${escapeHtml(val)}</span>`;
  }).join('');
  const params = Object.entries(spec.params || {}).map(([k, p]) =>
    `<div class="param-row">
       <label>${k}</label>
       <input type="number" step="any" value="${c.params[k]}" data-param="${k}" data-comp="${c.id}">
       <span class="unit">${p.unit || ''}</span>
     </div>`).join('');
  const actions = [];
  if (c.type === 'pushbutton_no' || c.type === 'pushbutton_nc') {
    actions.push(`<button data-act="press" data-comp="${c.id}">${c.state.pressed ? 'Release' : 'Press'}</button>`);
  }
  if (c.type === 'breaker3' || c.type === 'breaker1' || c.type === 'selector2') {
    actions.push(`<button data-act="toggle" data-comp="${c.id}">${c.state.closed || c.state.pos === '1' ? 'Open' : 'Close'}</button>`);
  }
  if (c.type === 'selector3') {
    actions.push(`<button data-act="sel3" data-comp="${c.id}" data-pos="0">0</button>` +
                 `<button data-act="sel3" data-comp="${c.id}" data-pos="1">I</button>` +
                 `<button data-act="sel3" data-comp="${c.id}" data-pos="2">II</button>`);
  }
  if (c.type === 'estop') {
    actions.push(`<button data-act="estop" data-comp="${c.id}" style="${c.state.pressed ? '' : 'color:var(--bad-text);border-color:var(--bad)'}">${c.state.pressed ? 'Twist-release' : 'TRIP'}</button>`);
  }
  if (c.type === 'pedal' || c.type === 'brake') {
    actions.push(`<input type="range" min="0" max="100" value="${Math.round((c.state.value || 0) * 100)}" data-act="pedal" data-comp="${c.id}" style="width:100px">`);
  }
  if (c.type === 'overload') {
    actions.push(`<button data-act="resetol" data-comp="${c.id}">Reset</button>`);
  }
  body.innerHTML = `
    <div class="insp-title">${escapeHtml(c.label)}</div>
    <div class="insp-type">${spec.label} · id ${c.id}</div>
    ${c.type === 'overload' ? `<div class="thermal-bar"><div style="width:${Math.round((c.state.thermal || 0) * 100)}%"></div></div>` : ''}
    <div class="kv">${stateRows}</div>
    ${params ? `<h2 style="margin-top:0">Parameters</h2>${params}` : ''}
    <div class="insp-actions">${actions.join('')}
      <button data-act="delete" data-comp="${c.id}" style="margin-left:auto;color:var(--bad-text)">Delete</button>
    </div>`;

  body.querySelectorAll('input[data-param]').forEach(inp => {
    inp.onchange = () => cmd('set_param', { id: inp.dataset.comp, param: inp.dataset.param, value: Number(inp.value) });
  });
  body.querySelectorAll('input[data-act="pedal"]').forEach(inp => {
    inp.oninput = () => cmd('set_pedal', { id: inp.dataset.comp, value: Number(inp.value) / 100 });
  });
  body.querySelectorAll('button[data-act]').forEach(b => {
    b.onclick = () => {
      const id = b.dataset.comp;
      switch (b.dataset.act) {
        case 'press': cmd(c.state.pressed ? 'release_button' : 'press_button', { id }); break;
        case 'toggle': cmd('set_switch', { id, closed: !(c.state.closed || c.state.pos === '1') }); break;
        case 'sel3': cmd('set_selector', { id, position: b.dataset.pos }); break;
        case 'estop': cmd('set_switch', { id, closed: !!c.state.pressed }); break;
        case 'resetol': cmd('reset_overload', { id }); break;
        case 'delete': cmd('remove_component', { id }); ui.selected = null; break;
      }
    };
  });
}

// ---------- canvas interactions ----------
function svgPoint(evt) {
  const pt = new DOMPoint(evt.clientX, evt.clientY);
  const m = svg.getScreenCTM();
  const p = pt.matrixTransform(m.inverse());
  return { x: Math.round(p.x / 10) * 10, y: Math.round(p.y / 10) * 10 };
}

// Pointer events (mouse + touch + pen) drive drags; hover preview keeps working
// for mouse because pointermove is a superset of mousemove.
svg.addEventListener('pointermove', (e) => {
  const p = svgPoint(e);
  if (ui.dragging) {
    if (!ui.dragging.moved && (Math.abs(p.x - ui.dragging.startX) > 3 || Math.abs(p.y - ui.dragging.startY) > 3)) {
      ui.dragging.moved = true;
    }
    if (ui.dragging.moved) {
      const c = ui.snapshot?.components.find(x => x.id === ui.dragging.id);
      if (c) {
        c.x = p.x - ui.dragging.dx;
        c.y = p.y - ui.dragging.dy;
        ui.dragging.x = c.x;
        ui.dragging.y = c.y;
      }
      renderNow();
    }
    return;
  }
  if (p.x !== ui.cursor.x || p.y !== ui.cursor.y) {
    ui.cursor = p;
    if (ui.placing || ui.pendingTerm) renderNow();
  }
});

// All symbol interactions happen on pointerdown: the event always fires on the live
// element, so 10Hz re-renders can never swallow a click mid-press.
svg.addEventListener('pointerdown', (e) => {
  const p = svgPoint(e);
  const resetEl = e.target.closest?.('[data-reset]');
  if (resetEl) { cmd('reset_overload', { id: resetEl.dataset.reset }); return; }

  const estopEl = e.target.closest?.('[data-estop]');
  if (estopEl) { toggleEstop(estopEl.dataset.estop); return; }

  const copEl = e.target.closest?.('[data-copfloor]');
  if (copEl) {
    const [id, f] = copEl.dataset.copfloor.split(':');
    const c = ui.snapshot?.components.find(x => x.id === id);
    if (c) cmd('set_floor', { id, floor: c.state.floor === Number(f) ? 0 : Number(f) });
    return;
  }

  const sel3El = e.target.closest?.('[data-toggle3]');
  if (sel3El) {
    const id = sel3El.dataset.toggle3;
    const c = ui.snapshot?.components.find(x => x.id === id);
    if (c) {
      const next = c.state.pos === '0' ? '1' : c.state.pos === '1' ? '2' : '0';
      cmd('set_selector', { id, position: next });
    }
    return;
  }

  const pressEl = e.target.closest?.('[data-press]');
  if (pressEl) { cmd('press_button', { id: pressEl.dataset.press }); return; }

  const toggleEl = e.target.closest?.('[data-toggle]');
  if (toggleEl) {
    const id = toggleEl.dataset.toggle;
    const c = ui.snapshot?.components.find(x => x.id === id);
    if (c) cmd('set_switch', { id, closed: !(c.state.closed || c.state.pos === '1') });
    return;
  }

  const termEl = e.target.closest?.('.terminal');
  if (termEl) {
    const ref = termEl.dataset.term;
    (async () => {
      if (!ui.pendingTerm) { ui.pendingTerm = ref; }
      else if (ui.pendingTerm === ref) { ui.pendingTerm = null; }
      else {
        const r = await cmd('connect', { from: ui.pendingTerm, to: ref });
        if (r.ok) ui.pendingTerm = null;
      }
      renderNow();
    })();
    return;
  }

  const sym = e.target.closest?.('.sym');
  if (sym && !ui.placing) {
    const id = sym.dataset.comp;
    ui.selected = id;
    const c = ui.snapshot?.components.find(x => x.id === id);
    if (c) ui.dragging = { id, dx: p.x - c.x, dy: p.y - c.y, startX: p.x, startY: p.y, x: c.x, y: c.y, moved: false };
    renderNow();
  }
});

// placing a component happens on click (empty canvas area) — unless a
// touch gesture (pan/pinch) just ended, in which case this click is a stray.
svg.addEventListener('click', async (e) => {
  if (Date.now() < gestureEndsAt) return;
  if (ui.placing && !e.target.closest('.sym') && !e.target.closest('.terminal')) {
    const p = svgPoint(e);
    const r = await cmd('add_component', { type: ui.placing, x: p.x, y: p.y });
    if (r.ok) { ui.selected = r.id; }
    cancelPlace();
  }
});

window.addEventListener('pointerup', (e) => {
  if (ui.dragging) {
    if (ui.dragging.moved) {
      cmd('move_component', { id: ui.dragging.id, x: ui.dragging.x, y: ui.dragging.y });
    }
    ui.dragging = null;
  }
  if (!ui.snapshot || !(e.target.closest && e.target.closest('#canvas-wrap'))) return;
  // delay release slightly so a quick click still spans at least one sim tick
  setTimeout(() => {
    for (const c of ui.snapshot?.components || []) {
      if ((c.type === 'pushbutton_no' || c.type === 'pushbutton_nc') && c.state.pressed) {
        cmd('release_button', { id: c.id });
      }
    }
  }, 120);
});

window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') { closeMenus(); cancelPlace(); ui.pendingTerm = null; renderNow(); }
  if ((e.key === 'Delete' || e.key === 'Backspace') && ui.selected && document.activeElement.tagName !== 'INPUT') {
    cmd('remove_component', { id: ui.selected }); ui.selected = null;
  }
});

// ---------- toolbar ----------
$('#btn-run').onclick = () => cmd('sim_control', { action: ui.snapshot?.running ? 'pause' : 'run' });
$('#btn-step').onclick = () => cmd('sim_control', { action: 'step' });
$('#btn-advance').onclick = () => { cmd('sim_control', { action: 'advance', seconds: Number($('#advance-sec').value) || 1 }); closeMenus(); };
$('#btn-clear').onclick = () => { cmd('clear_circuit'); closeMenus(); };
$('#btn-reset').onclick = () => { cmd('sim_control', { action: 'reset' }); closeMenus(); };
$('#btn-save').onclick = async () => {
  closeMenus();
  const name = await uiPrompt('Save circuit as', localStorage.getItem('vl-last-save') || 'my-circuit');
  if (!name) return;
  const clean = name.replace(/[^A-Za-z0-9._-]/g, '-');
  const r = await cmd('save_circuit', { name: clean });
  if (r.ok) { localStorage.setItem('vl-last-save', clean); refreshCircuits(); }
};
$('#btn-load').onclick = () => {
  cmd('load_circuit', { name: $('#circuit-select').value }).then(r => {
    if (r.ok) localStorage.setItem('vl-last-circuit', r.loaded || $('#circuit-select').value);
  });
  closeMenus();
};
$('#btn-screenshot').onclick = () => { closeMenus(); cmd('screenshot', {}).then(r => { if (r.ok) toast(`screenshot → ${r.saved}`); }); };

// faults menu
document.querySelectorAll('#menu-faults [data-fault]').forEach(b => {
  b.onclick = () => {
    const type = b.dataset.fault;
    const args = { type };
    if (type === 'phase_loss') args.phase = b.dataset.phase;
    if (type !== 'phase_loss') {
      const sel = ui.selected && ui.snapshot?.components.find(c => c.id === ui.selected);
      args.target = (sel && (sel.type === 'motor3' || type === 'short_circuit')) ? sel.id : 'M1';
      if (type === 'overload') args.multiplier = 2.5;
    }
    cmd('inject_fault', args);
    closeMenus();
  };
});
$('#btn-clearfaults').onclick = () => { cmd('clear_fault', {}); closeMenus(); };
$('#btn-fuses').onclick = () => { cmd('replace_fuses', {}); closeMenus(); };
$('#btn-kk-reset').onclick = () => {
  const sel = ui.selected && ui.snapshot?.components.find(c => c.id === ui.selected);
  cmd('reset_overload', { id: sel && sel.type === 'overload' ? sel.id : 'KK1' });
  closeMenus();
};

// close any open menu when clicking elsewhere
window.addEventListener('pointerdown', (e) => {
  if (!e.target.closest('details.menu')) closeMenus();
}, true);

// ---------- zoom ----------
const canvasScale = document.getElementById('canvas-scale');
function applyZoom(z, focusClient) {
  z = Math.min(3, Math.max(0.25, z));
  const old = ui.zoom;
  if (Math.abs(z - old) < 0.001) return;
  const wrap = document.querySelector('#canvas-wrap');
  if (focusClient) {
    wrap.scrollLeft = (wrap.scrollLeft + focusClient.x) * (z / old) - focusClient.x;
    wrap.scrollTop = (wrap.scrollTop + focusClient.y) * (z / old) - focusClient.y;
  }
  ui.zoom = z;
  $('#zoom-slider').value = Math.round(z * 100);
  renderNow();
}
$('#btn-zoom-in').onclick = () => applyZoom(ui.zoom * 1.25);
$('#btn-zoom-out').onclick = () => applyZoom(ui.zoom / 1.25);
function zoomFit() {
  if (!ui.snapshot || !ui.snapshot.components.length) return;
  let mx = 1000, my = 800;
  for (const c of ui.snapshot.components) mx = Math.max(mx, c.x + 150), my = Math.max(my, c.y + 150);
  const wrap = document.querySelector('#canvas-wrap');
  let z = Math.min((wrap.clientWidth - 30) / mx, (wrap.clientHeight - 30) / my);
  // Phones: a fit that shrinks the drawing to a speck is worse than a legible,
  // pannable view — keep symbols/labels readable and let pinch + pan cover the rest.
  if (window.matchMedia('(max-width: 900px)').matches) z = Math.max(z, 0.7);
  applyZoom(z);
}
$('#btn-zoom-fit').onclick = zoomFit;
$('#zoom-slider').oninput = (e) => applyZoom(Number(e.target.value) / 100);
svg.addEventListener('wheel', (e) => {
  if (!e.ctrlKey) return;
  e.preventDefault();
  // anchor: screen offset inside the scroll viewport (not the moving svg rect)
  const rect = document.querySelector('#canvas-wrap').getBoundingClientRect();
  applyZoom(ui.zoom * (e.deltaY < 0 ? 1.12 : 0.89), { x: e.clientX - rect.left, y: e.clientY - rect.top });
}, { passive: false });

// ---------- touch gestures: two-finger pinch zoom, one-finger pan ----------
// The wrap's CSS touch-action is none, so these own the whole gesture space.
const touchWrap = document.querySelector('#canvas-wrap');
const activePointers = new Map();  // pointerId -> {x, y}
let pinch = null;                   // {mid, dist} — two-finger zoom+pan state
let pan = null;                    // {sx, sy, sl, st, moved}
let gestureEndsAt = 0;             // suppress stray clicks right after a gesture

const onInteractive = (t) => t.closest?.('.sym') || t.closest?.('.terminal') ||
  t.closest?.('[data-press]') || t.closest?.('[data-toggle]') || t.closest?.('[data-reset]');

touchWrap.addEventListener('pointerdown', (e) => {
  activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (activePointers.size === 2) {
    // second finger: a pinch takes over — commit and drop any drag in progress
    if (ui.dragging?.moved) cmd('move_component', { id: ui.dragging.id, x: ui.dragging.x, y: ui.dragging.y });
    ui.dragging = null;
    pinch = { mid: null, dist: null };   // first pointermove seeds mid/dist
    pan = null;
  } else if (activePointers.size === 1 && e.pointerType !== 'mouse' && !onInteractive(e.target)) {
    // touch on empty canvas → pan the viewport
    pan = { sx: e.clientX, sy: e.clientY, sl: touchWrap.scrollLeft, st: touchWrap.scrollTop, moved: false };
  }
});

touchWrap.addEventListener('pointermove', (e) => {
  if (!activePointers.has(e.pointerId)) return;
  activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (pinch && activePointers.size >= 2) {
    const [a, b] = [...activePointers.values()];
    const dist = Math.hypot(a.x - b.x, a.y - b.y) || 1;
    const midX = (a.x + b.x) / 2, midY = (a.y + b.y) / 2;
    // pan: keep the drawing glued to the fingers' midpoint, 1:1 — works over
    // symbols too (one-finger pan there would drag the component instead)
    if (pinch.mid) {
      touchWrap.scrollLeft -= midX - pinch.mid.x;
      touchWrap.scrollTop -= midY - pinch.mid.y;
    }
    // zoom: spread ratio vs the previous frame, anchored at the current
    // midpoint — the content between the fingers stays between the fingers.
    // (Below 2px of change the delta is skipped but pinch.dist still advances,
    // so slow spreads accumulate losslessly while finger jitter is ignored.)
    if (pinch.dist && Math.abs(dist - pinch.dist) > 2) {
      const wrapRect = touchWrap.getBoundingClientRect();
      applyZoom(ui.zoom * (dist / pinch.dist), { x: midX - wrapRect.left, y: midY - wrapRect.top });
    }
    pinch.mid = { x: midX, y: midY };
    pinch.dist = dist;
    gestureEndsAt = Date.now() + 350;
  } else if (pan && activePointers.size === 1) {
    touchWrap.scrollLeft = pan.sl - (e.clientX - pan.sx);
    touchWrap.scrollTop = pan.st - (e.clientY - pan.sy);
    if (Math.abs(e.clientX - pan.sx) + Math.abs(e.clientY - pan.sy) > 12) {
      pan.moved = true;
      gestureEndsAt = Date.now() + 350;
    }
  }
});

const endTouchPointer = (e) => {
  activePointers.delete(e.pointerId);
  if (activePointers.size < 2) pinch = null;
  if (activePointers.size === 0) pan = null;
};
touchWrap.addEventListener('pointerup', endTouchPointer);
touchWrap.addEventListener('pointercancel', endTouchPointer);

// ---------- mobile drawers (palette / inspector become overlays) ----------
const drawerPalette = $('#btn-drawer-palette');
const drawerInspector = $('#btn-drawer-inspector');
function setDrawer(name, open) {
  const el = $(name);
  el.classList.toggle('open', open);
  const aria = name === '#palette' ? drawerPalette : drawerInspector;
  aria.setAttribute('aria-expanded', String(open));
}
drawerPalette.onclick = () => {
  const open = !$('#palette').classList.contains('open');
  setDrawer('#palette', open);
  if (open) setDrawer('#inspector', false);
};
drawerInspector.onclick = () => {
  const open = !$('#inspector').classList.contains('open');
  setDrawer('#inspector', open);
  if (open) setDrawer('#palette', false);
};
// close drawers when a canvas interaction starts
svg.addEventListener('pointerdown', () => {
  if ($('#palette').classList.contains('open') || $('#inspector').classList.contains('open')) {
    setDrawer('#palette', false);
    setDrawer('#inspector', false);
  }
});

// ---------- MCP activation panel ----------
let mcpHealth = { mcpScript: '/mcp/server.mjs' };
const MCP_CONFIG = () => JSON.stringify({
  mcpServers: {
    voltlab: {
      command: 'node',
      args: [mcpHealth.mcpScript],
      env: { VOLTLAB_URL: location.origin }
    }
  }
}, null, 2);

async function pollMcp() {
  if (!$('#menu-mcp').open) return;
  if (host?.mode === 'local') {
    // offline mode: the engine runs in this page, there is no agent endpoint
    $('#mcp-api').textContent = 'local (offline)';
    $('#mcp-api').className = 'v';
    $('#mcp-agent').textContent = 'requires desktop mode';
    $('#mcp-agent').className = 'v';
    $('#mcp-config').textContent = '// MCP agent control needs the desktop app:\n//   npm start        (Electron + server)\n//   node server.js   (browser + server)';
    return;
  }
  try {
    const r = await (await fetch('/api/health')).json();
    mcpHealth = r;
    const el = $('#mcp-agent');
    if (r.agentLastSeenSec == null) {
      el.textContent = 'never connected';
      el.className = 'v';
    } else {
      const ago = r.agentLastSeenSec;
      el.textContent = ago < 60 ? `active (${ago}s ago)` : `last call ${ago}s ago`;
      el.className = 'v on';
    }
  } catch { /* offline */ }
}
$('#menu-mcp').addEventListener('toggle', () => {
  if ($('#menu-mcp').open) {
    pollMcp().then(() => { $('#mcp-config').textContent = MCP_CONFIG(); });
  }
});
setInterval(pollMcp, 2000);
$('#mcp-copy').onclick = async () => {
  const text = MCP_CONFIG();
  try {
    await navigator.clipboard.writeText(text);
    toast('MCP config copied to clipboard');
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text; document.body.appendChild(ta);
    ta.select(); document.execCommand('copy'); ta.remove();
    toast('MCP config copied to clipboard');
  }
  closeMenus();
};

// ---------- legend ----------
function buildLegend() {
  const grid = $('#legend-grid');
  grid.innerHTML = Object.entries(DEVICE_TYPES).map(([type, spec]) => `
    <div class="legend-item">
      <svg viewBox="-16 -10 ${spec.size.w + 32} ${spec.size.h + 34}">${SYMBOLS[type]({ x: 0, y: 0, label: '', params: {} }, idleLegendState(type))}</svg>
      <div><div class="lt">${escapeHtml(spec.label)}</div><div class="ld">${escapeHtml(spec.desc || '')}</div></div>
    </div>`).join('');
}
function idleLegendState(type) {
  return { closed: false, energized: false, pressed: false, lit: false, blown: [false, false, false],
           pos: '0', speed: 0, tripped: false, thermal: 0, done: false, on: false, position: 1,
           value: 0, floor: 0, up: false, down: false, freq: 0, running: false, dir: 0, fault: '' };
}
$('#btn-legend').onclick = () => { closeMenus(); $('#legend-dialog').showModal(); };
$('#legend-close').onclick = () => $('#legend-dialog').close();
$('#btn-tutorial').onclick = () => startTutorial();
$('#btn-tutorial-menu').onclick = () => { closeMenus(); startTutorial(); };

// ---------- video + pdf exports ----------
$('#btn-video').onclick = async () => {
  closeMenus();
  toast('Recording demo video…');
  try {
    const r = await recordDemo(ui.snapshot?.circuit);
    toast(`video saved → ${r.path}`);
  } catch (e) {
    toast(`video export failed: ${e.message}`);
  }
};
$('#btn-pdf').onclick = async () => {
  closeMenus();
  try {
    const html = await buildReport(ui.snapshot);
    const r = await host.submitReport(html, ui.snapshot?.circuit);
    toast(`report saved → ${r.path}${r.note ? ' (' + r.note + ')' : ''}`);
  } catch (e) {
    toast(`pdf export failed: ${e.message}`);
  }
};

// agent-initiated export requests arrive through the host (SSE or local)
// → handleExportRequest(), defined next to the state stream above.

// ---------- circuits dropdown ----------
async function refreshCircuits() {
  if (!host) return;
  try {
    const r = await host.health();
    $('#circuit-select').innerHTML = (r.circuits || []).map(c => `<option>${c}</option>`).join('');
  } catch { /* offline */ }
}

// Fit the view once after a circuit load. The SSE frame that announces the
// loaded circuit can arrive BEFORE the load_circuit response sets pendingFit
// (server mode), so check immediately when setting it, and again on every state.
function consumePendingFit() {
  if (!ui.pendingFit) return;
  const s = ui.snapshot;
  if (s && (ui.pendingFit === true || s.circuit === ui.pendingFit) && s.components.length > 0) {
    ui.pendingFit = null;
    zoomFit();
  }
}

// track loads through the command channel: fit the view to a newly loaded circuit
window.addEventListener('vl-action', (ev) => {
  const { tool, result } = ev.detail;
  if (tool === 'load_circuit' && result.ok) { ui.pendingFit = result.loaded || true; consumePendingFit(); }
});

// ---------- save-as dialog (window.prompt is unavailable on Android WebView) ----------
function uiPrompt(title, def = '') {
  return new Promise(resolve => {
    const dlg = $('#save-dialog');
    $('#save-dialog-title').textContent = title;
    const inp = $('#save-dialog-input');
    inp.value = def;
    const cleanup = () => {
      dlg.querySelector('form').removeEventListener('submit', onSubmit);
      dlg.removeEventListener('close', onClose);
      $('#save-dialog-cancel').onclick = null;
    };
    const onSubmit = (ev) => {
      ev.preventDefault();
      cleanup();
      resolve(inp.value.trim() || null);
    };
    const onClose = () => { cleanup(); resolve(null); };   // Esc / cancel
    dlg.querySelector('form').addEventListener('submit', onSubmit);
    dlg.addEventListener('close', onClose);
    $('#save-dialog-cancel').onclick = () => dlg.close();
    dlg.showModal();
    setTimeout(() => { inp.focus(); inp.select(); }, 40);
  });
}

// ---------- boot ----------
initTheme();
buildPalette();
buildLegend();
requestAnimationFrame(frame);
applyZoom(1);

(async () => {
  // canvas → PNG for the local-mode screenshot tool
  const pngDataUrl = async () => {
    const SVGNS = 'http://www.w3.org/2000/svg';
    const vb = svg.viewBox?.baseVal;
    const scale = 1.5;
    const w = Math.max(64, Math.round((vb?.width || 1200) * scale));
    const h = Math.max(64, Math.round((vb?.height || 800) * scale));
    const clone = svg.cloneNode(true);
    clone.setAttribute('xmlns', SVGNS);
    let css = '';
    try { css = await (await fetch('/css/app.css')).text(); } catch { /* keep going without it */ }
    const style = document.createElementNS(SVGNS, 'style');
    style.textContent = css;
    clone.insertBefore(style, clone.firstChild);
    clone.setAttribute('width', w);
    clone.setAttribute('height', h);
    const str = new XMLSerializer().serializeToString(clone);
    const img = new Image();
    await new Promise((ok, bad) => { img.onload = ok; img.onerror = bad; img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(str); });
    const cv = document.createElement('canvas');
    cv.width = w; cv.height = h;
    const ctx = cv.getContext('2d');
    ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim() || '#0d1117';
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(img, 0, 0, w, h);
    return cv.toDataURL('image/png');
  };

  host = await initHost({
    onState: handleState,
    onExportRequest: handleExportRequest,
    onStatus: (on) => { $('#st-conn').className = 'dot ' + (on ? 'on' : 'off'); },
    getPngDataUrl: pngDataUrl
  });
  refreshCircuits();

  // phones: the palette is a drawer, not a fixed left panel
  if (window.matchMedia('(max-width: 900px)').matches) {
    const p = $('#welcome p');
    if (p) p.innerHTML = 'Tap the <b>☰ components</b> drawer to pick a part, then tap the canvas to place it,<br>or load a worked example from the <b>Circuit ▸ Load selected circuit</b> menu.';
  }

  // resume the circuit that was open last session
  const last = localStorage.getItem('vl-last-circuit');
  if (last) {
    await new Promise(r => setTimeout(r, host.mode === 'http' ? 600 : 50)); // let the server autoload settle
    try {
      const h = await host.health();
      if ((h.circuits || []).includes(last)) cmd('load_circuit', { name: last });
    } catch { /* offline */ }
  }
})();
