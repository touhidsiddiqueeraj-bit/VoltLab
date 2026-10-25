// app/js/tutorial.js — interactive guided tutorial.
// Overlay with a spotlight on the relevant UI region, step cards with
// Back/Next, and completion gates that wait for the learner to actually
// perform actions (place, wire, press…). Events come from main.js
// ('vl-action' dispatched after every successful command).

const $ = (sel) => document.querySelector(sel);
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

let active = false;
let stepIdx = 0;
let gateHandler = null;
let pollTimer = null;

function ensureDom() {
  if (document.querySelector('#tut-overlay')) return;
  const ov = document.createElement('div');
  ov.id = 'tut-overlay';
  ov.innerHTML = `
    <div id="tut-spot"></div>
    <div id="tut-card">
      <div id="tut-step"></div>
      <div id="tut-text"></div>
      <div id="tut-gate" class="hidden">👆 do this to continue</div>
      <div class="tut-btns">
        <button id="tut-skip">Skip</button>
        <span class="spacer"></span>
        <button id="tut-back">Back</button>
        <button id="tut-next" class="accent">Next</button>
      </div>
    </div>`;
  document.body.appendChild(ov);
  document.querySelector('#tut-skip').onclick = () => end(true);
  document.querySelector('#tut-back').onclick = () => { if (stepIdx > 0) { stepIdx -= 2; next(); } };
  document.querySelector('#tut-next').onclick = () => next();
}

function spotlight(sel) {
  const spot = $('#tut-spot');
  const card = $('#tut-card');
  const el = sel && document.querySelector(sel);
  if (!el) { spot.style.display = 'none'; }
  else {
    const r = el.getBoundingClientRect();
    const m = 8;
    spot.style.display = 'block';
    spot.style.left = (r.left - m) + 'px';
    spot.style.top = (r.top - m) + 'px';
    spot.style.width = (r.width + m * 2) + 'px';
    spot.style.height = (r.height + m * 2) + 'px';
    // keep the card out of the spotlight: opposite half of the screen
    const targetCenter = r.top + r.height / 2;
    card.style.top = targetCenter < window.innerHeight / 2 ? 'auto' : '90px';
    card.style.bottom = targetCenter < window.innerHeight / 2 ? '90px' : 'auto';
  }
}

function show(step, snapshot) {
  $('#tut-step').textContent = `Tutorial ${stepIdx + 1}/${STEPS.length}`;
  $('#tut-text').innerHTML = typeof step.text === 'function' ? step.text(snapshot) : step.text;
  spotlight(step.spot);
  const gate = $('#tut-gate');
  if (step.until) { gate.classList.remove('hidden'); $('#tut-next').disabled = true; }
  else { gate.classList.add('hidden'); $('#tut-next').disabled = false; }
  if (step.action) setTimeout(() => step.action(snapshot), 50);
}

function gateSatisfied(step, evt, snapshot) {
  if (!step.until) return true;
  try { return !!step.until(evt, snapshot); } catch { return false; }
}

function armGate(step) {
  disarmGate();
  if (!step.until) { $('#tut-next').disabled = false; return; }
  $('#tut-next').disabled = true;
  gateHandler = (evt) => {
    const snap = window.__voltlab?.snapshot?.() || null;
    if (gateSatisfied(step, evt, snap)) {
      disarmGate();
      $('#tut-gate').classList.add('hidden');
      $('#tut-next').disabled = false;
      $('#tut-gate').textContent = '✓ done — click Next';
      $('#tut-gate').classList.remove('hidden');
    }
  };
  window.addEventListener('vl-action', gateHandler);
  pollTimer = setInterval(() => gateHandler(null), 600); // passive conditions (trips etc.)
}

function disarmGate() {
  if (gateHandler) { window.removeEventListener('vl-action', gateHandler); gateHandler = null; }
  if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
}

async function next() {
  disarmGate();
  stepIdx++;
  if (stepIdx >= STEPS.length) return end(false);
  const step = STEPS[stepIdx];
  if (step.run) await step.run();
  const snap = window.__voltlab?.snapshot?.() || null;
  show(step, snap);
  armGate(step);
}

function end() {
  active = false;
  disarmGate();
  const ov = $('#tut-overlay');
  if (ov) ov.remove();
}

async function start() {
  if (active) return;
  active = true;
  stepIdx = -1;
  ensureDom();
  await next();
}

// ---------------------------------------------------------------------------
const kk1 = (snap) => snap?.components?.find(c => c.id === 'KK1')?.state || {};
const km1 = (snap) => snap?.components?.find(c => c.id === 'KM1')?.state || {};

const STEPS = [
  {
    text: `<b>Welcome to VoltLab!</b> This 3-minute tutorial teaches the basics:
           placing components, wiring, running a motor starter, and using faults.
           You can Skip anytime.`,
    spot: '#canvas-wrap'
  },
  {
    text: `<b>The palette</b> lists every device: supplies, breakers, fuses, contactors,
           push buttons, lamps and more. Click an entry, then click the dark canvas to
           place it.`,
    spot: '#palette'
  },
  {
    text: `<b>Try it:</b> click <i>Indicator Lamp</i> in the palette, then click an empty
           spot on the canvas.`,
    spot: '.palette-item[data-type="lamp"]',
    until: (evt) => evt?.detail?.tool === 'add_component' && evt.detail.args?.type === 'lamp'
  },
  {
    text: `<b>Wiring:</b> click one terminal (a small dot), then click another terminal —
           a wire runs between them. Try wiring your new lamp to something.
           (Two wires from the same terminal make a junction dot.)`,
    spot: '#canvas-wrap',
    until: (evt) => evt?.detail?.tool === 'connect'
  },
  {
    text: `<b>Now let's run a real motor starter.</b> I'm loading the DOL starter example…
           Make sure simulation is running (▶ Run in the toolbar).`,
    spot: '#toolbar',
    run: async () => {
      await window.__voltlab ? null : null;
      await fetch('/api/command', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tool: 'load_circuit', args: { name: 'dol-starter' } }) });
      await fetch('/api/command', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tool: 'sim_control', args: { action: 'run' } }) });
      await sleep(600);
    }
  },
  {
    text: `<b>Start the motor:</b> click and hold the green <b>S1 Start</b> button cap on the
           schematic. Watch contactor KM1 pick up and the motor spin up. You can release —
           the seal-in contact keeps it running.`,
    spot: '[data-press="S1"]',
    until: (evt, snap) => evt?.detail?.tool === 'press_button' && evt.detail.args?.id === 'S1' && km1(snap).energized
  },
  {
    text: `<b>It's running!</b> The green H2 lamp is lit, the motor spins. Now click the red
           <b>S0 Stop</b> button — the contactor drops and the motor coasts down.`,
    spot: '[data-press="S0"]',
    until: (evt) => evt?.detail?.tool === 'press_button' && evt.detail.args?.id === 'S0'
  },
  {
    text: `<b>Faults:</b> open the <b>Faults</b> menu and choose <i>Stall rotor</i>. Then press
           START again — the motor draws locked-rotor current and the thermal overload
           KK1 heats up (watch its bar) until it trips, ~15 s.`,
    spot: '#menu-faults',
    until: (evt, snap) => evt?.detail?.tool === 'inject_fault' && kk1(snap).tripped
  },
  {
    text: `<b>Tripped!</b> The contactor dropped and the red H3 lamp is lit. Click the red
           <b>RESET</b> button on the overload relay symbol, clear the fault
           (Faults ▸ Clear all faults) and restart. This exact choreography is what real
           motor protection does.`,
    spot: '[data-reset="KK1"]',
    until: (evt, snap) => evt?.detail?.tool === 'reset_overload' || kk1(snap)?.tripped === false
  },
  {
    text: `<b>Explore:</b> the <b>Circuit</b> menu loads example circuits (a 10-story relay
           elevator, a timer sequencer, a reversing starter…), exports a PDF drawing set
           and records demo videos. <b>Show symbol legend</b> explains every symbol.`,
    spot: '#menu-circuit'
  },
  {
    text: `<b>For agents:</b> the <b>MCP</b> menu (top right) copies a ready MCP config — AI
           agents can build, wire, break and inspect any circuit programmatically.
           Use the zoom slider or Ctrl+wheel to navigate large schematics.
           <b>Happy wiring!</b>`,
    spot: '#toolbar'
  }
];

export { start as startTutorial };
