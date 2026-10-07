// app/js/main.js — UI bootstrap: theme, SSE state stream, command channel, interactions.
import { DEVICE_TYPES } from '/sim/devices.js';
import { PALETTE_GROUPS, SYMBOLS } from './symbols.js';
import { renderScene, parseRef } from './render.js';
import { recordDemo } from './video.js';
import { buildReport } from './report.js';
import { startTutorial } from './tutorial.js';

const $ = (sel) => document.querySelector(sel);
const svg = $('#canvas');

const ui = {
  selected: null,
  pendingTerm: null,   // first terminal clicked when wiring
  placing: null,       // palette type being placed
  dragging: null,      // {id, dx, dy}
  cursor: { x: 0, y: 0 },
  zoom: 1,
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

// ---------- command channel ----------
async function cmd(tool, args = {}) {
  try {
    const res = await fetch('/api/command', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tool, args })
    });
    const r = await res.json();
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

// ---------- SSE ----------
function connect() {
  const es = new EventSource('/api/events');
  es.addEventListener('state', (ev) => {
    $('#st-conn').className = 'dot on';
    ui.snapshot = JSON.parse(ev.data);
    updateStatus(ui.snapshot);
    renderNow();
    renderLog(ui.snapshot);
  });
  es.addEventListener('hello', () => { $('#st-conn').className = 'dot on'; });
  es.addEventListener('export-request', handleExportRequest);
  es.onerror = () => { $('#st-conn').className = 'dot off'; };
}

function updateStatus(s) {
  $('#st-circuit').textContent = s.circuit;
  const sel = $('#circuit-select');
  if (s.circuit && sel.value !== s.circuit && [...sel.options].some(o => o.value === s.circuit)) sel.value = s.circuit;
  $('#st-time').textContent = `t = ${s.t.toFixed(1)} s`;
  $('#st-run').textContent = s.running ? 'running' : 'paused';
  const btn = $('#btn-run');
  btn.textContent = s.running ? '⏸ Pause' : '▶ Run';
  btn.classList.toggle('paused', !s.running);
  const faults = Object.keys(s.faults || {});
  $('#st-faults').textContent = faults.length ? `FAULTS: ${faults.join(', ')}` : '';
}

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
  if (!s || !ui.selected) { body.className = 'empty'; body.innerHTML = 'Nothing selected.<br>Click a component on the canvas.'; return; }
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

svg.addEventListener('mousemove', (e) => {
  const p = svgPoint(e);
  if (ui.dragging) {
    const c = ui.snapshot?.components.find(x => x.id === ui.dragging.id);
    if (c) { c.x = p.x - ui.dragging.dx; c.y = p.y - ui.dragging.dy; }
    ui.dragging.dirty = true;
    renderNow();
    return;
  }
  if (ui.dragging && !ui.dragging.moved) {
    const c = ui.snapshot?.components.find(x => x.id === ui.dragging.id);
    if (c && (Math.abs(p.x - ui.dragging.dx - c.x) > 4 || Math.abs(p.y - ui.dragging.dy - c.y) > 4)) ui.dragging.moved = true;
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
    if (c) ui.dragging = { id, dx: p.x - c.x, dy: p.y - c.y, moved: false };
    renderNow();
  }
});

// placing a component happens on click (empty canvas area)
svg.addEventListener('click', async (e) => {
  if (ui.placing && !e.target.closest('.sym') && !e.target.closest('.terminal')) {
    const p = svgPoint(e);
    const r = await cmd('add_component', { type: ui.placing, x: p.x, y: p.y });
    if (r.ok) { ui.selected = r.id; }
    cancelPlace();
  }
});

window.addEventListener('pointerup', (e) => {
  if (ui.dragging) {
    const c = ui.snapshot?.components.find(x => x.id === ui.dragging.id);
    if (c && ui.dragging.moved) cmd('move_component', { id: c.id, x: c.x, y: c.y });
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
$('#btn-save').onclick = () => { closeMenus(); const name = prompt('Save circuit as:', 'my-circuit'); if (name) cmd('save_circuit', { name: name.trim().replace(/[^A-Za-z0-9._-]/g, '-') }).then(r => r.ok && refreshCircuits()); };
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
$('#btn-zoom-fit').onclick = () => {
  if (!ui.snapshot) return;
  let mx = 1000, my = 800;
  for (const c of ui.snapshot.components) mx = Math.max(mx, c.x + 150), my = Math.max(my, c.y + 150);
  const wrap = document.querySelector('#canvas-wrap');
  applyZoom(Math.min((wrap.clientWidth - 30) / mx, (wrap.clientHeight - 30) / my));
};
$('#zoom-slider').oninput = (e) => applyZoom(Number(e.target.value) / 100);
svg.addEventListener('wheel', (e) => {
  if (!e.ctrlKey) return;
  e.preventDefault();
  const rect = svg.getBoundingClientRect();
  const scaleF = ui.zoom; // current effective scale incl. transform
  const cx = (e.clientX - rect.left) / scaleF, cy = (e.clientY - rect.top) / scaleF;
  applyZoom(ui.zoom * (e.deltaY < 0 ? 1.12 : 0.89), { x: cx, y: cy });
}, { passive: false });

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
    const r = await (await fetch('/api/export/report', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ html, circuit: ui.snapshot?.circuit })
    })).json();
    toast(`report saved → ${r.path}${r.note ? ' (' + r.note + ')' : ''}`);
  } catch (e) {
    toast(`pdf export failed: ${e.message}`);
  }
};

// agent-initiated export requests arrive over SSE
function handleExportRequest(ev) {
  const { kind, name } = JSON.parse(ev.data);
  if (kind === 'video') {
    recordDemo(name).then(r => toast(`video saved → ${r.path}`)).catch(e => toast(`video export failed: ${e.message}`));
  } else if (kind === 'pdf') {
    buildReport(ui.snapshot).then(html =>
      fetch('/api/export/report', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ html, circuit: name }) })
    ).catch(() => {});
  }
}

// ---------- circuits dropdown ----------
async function refreshCircuits() {
  try {
    const r = await (await fetch('/api/health')).json();
    $('#circuit-select').innerHTML = (r.circuits || []).map(c => `<option>${c}</option>`).join('');
  } catch { /* offline */ }
}

// ---------- boot ----------
initTheme();
buildPalette();
buildLegend();
refreshCircuits();
connect();
requestAnimationFrame(frame);
applyZoom(1);

// resume the circuit that was open last session (client-side override of autoload)
(async () => {
  const last = localStorage.getItem('vl-last-circuit');
  if (!last) return;
  await new Promise(r => setTimeout(r, 600)); // let the server autoload settle
  try {
    const r = await (await fetch('/api/health')).json();
    if ((r.circuits || []).includes(last)) cmd('load_circuit', { name: last });
  } catch { /* offline */ }
})();
