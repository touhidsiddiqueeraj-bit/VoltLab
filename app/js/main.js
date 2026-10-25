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
  if (ui.pendingFit && s.circuit === ui.pendingFit && s.components.length > 0) { ui.pendingFit = null; zoomFit(); }
  const btn = $('#btn-run');
  btn.textContent = s.running ? '⏸ Pause' : '▶ Run';
  btn.classList.toggle('paused', !s.running);
  const faults = Object.keys(s.faults || {});
  $('#st-faults').textContent = faults.length ? `FAULTS: ${faults.join(', ')}` : '';
}

// ---------- operator panel: round mimic buttons + motor rotation display ----------
// Rebuilt only when the circuit's button/motor set changes (signature check), so the
// press targets are stable across the 10 Hz status updates.
let mimicSig = null;
let mimicHeld = null;
const mimicStallSince = new Map();

function mimicRole(c) {
  const rest = c.label.startsWith(c.id) ? c.label.slice(c.id.length).trim() : c.label;
  return rest || (c.type === 'pushbutton_nc' ? 'NC contact' : 'NO contact');
}

function updateMimic(s) {
  const rel = s.components.filter(c =>
    c.type === 'pushbutton_no' || c.type === 'pushbutton_nc' || c.type === 'motor3');
  const sig = rel.map(c => `${c.id}:${c.type}:${c.label}`).join('|');
  if (sig !== mimicSig) {
    mimicSig = sig;
    const btns = rel.filter(c => c.type !== 'motor3');
    const motors = rel.filter(c => c.type === 'motor3');
    $('#mimic-buttons').innerHTML = btns.map(c => `
      <div class="mimic-btn-wrap">
        <button class="mimic-btn ${c.type === 'pushbutton_nc' ? 'nc' : 'no'}" data-mimic="${c.id}"
                aria-label="hold ${escapeHtml(c.label)}"><span>${c.id}</span></button>
        <span class="mimic-cap" title="${escapeHtml(c.label)}">${escapeHtml(mimicRole(c))}</span>
      </div>`).join('') || '<span class="mimic-empty">no push buttons</span>';
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
  body.querySelectorAll('button[data-act]').forEach(b => {
    b.onclick = () => {
      const id = b.dataset.comp;
      switch (b.dataset.act) {
        case 'press': cmd(c.state.pressed ? 'release_button' : 'press_button', { id }); break;
        case 'toggle': cmd('set_switch', { id, closed: !(c.state.closed || c.state.pos === '1') }); break;
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
  applyZoom(Math.min((wrap.clientWidth - 30) / mx, (wrap.clientHeight - 30) / my));
}
$('#btn-zoom-fit').onclick = zoomFit;
$('#zoom-slider').oninput = (e) => applyZoom(Number(e.target.value) / 100);
svg.addEventListener('wheel', (e) => {
  if (!e.ctrlKey) return;
  e.preventDefault();
  const rect = svg.getBoundingClientRect();
  const scaleF = ui.zoom; // current effective scale incl. transform
  const cx = (e.clientX - rect.left) / scaleF, cy = (e.clientY - rect.top) / scaleF;
  applyZoom(ui.zoom * (e.deltaY < 0 ? 1.12 : 0.89), { x: cx, y: cy });
}, { passive: false });

// ---------- touch gestures: two-finger pinch zoom, one-finger pan ----------
// The wrap's CSS touch-action is none, so these own the whole gesture space.
const touchWrap = document.querySelector('#canvas-wrap');
const activePointers = new Map();  // pointerId -> {x, y}
let pinch = null;                   // {startDist, startZoom}
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
    const [a, b] = [...activePointers.values()];
    pinch = { startDist: Math.hypot(a.x - b.x, a.y - b.y) || 1, startZoom: ui.zoom };
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
    const dist = Math.hypot(a.x - b.x, a.y - b.y);
    if (Math.abs(dist - pinch.startDist) > 4) {
      const rect = svg.getBoundingClientRect();
      const midX = (a.x + b.x) / 2 - rect.left;
      const midY = (a.y + b.y) / 2 - rect.top;
      applyZoom(pinch.startZoom * (dist / pinch.startDist), { x: midX / ui.zoom, y: midY / ui.zoom });
      gestureEndsAt = Date.now() + 350;
    }
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
           pos: '0', speed: 0, tripped: false, thermal: 0, done: false, on: false, position: 1 };
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

// track loads through the command channel: fit the view to a newly loaded circuit
window.addEventListener('vl-action', (ev) => {
  const { tool, result } = ev.detail;
  if (tool === 'load_circuit' && result.ok) ui.pendingFit = result.loaded || true;
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
