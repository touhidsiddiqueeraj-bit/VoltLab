// app/js/video.js — demo video export: scripts button presses, records the live
// simulation off an offscreen canvas via MediaRecorder, uploads the webm.

import { DEVICE_TYPES } from '/sim/devices.js';

const W = 1280, H = 720;

let svgCssCache = null;
async function getSvgCss() {
  if (svgCssCache) return svgCssCache;
  try {
    const css = await (await fetch('/css/app.css')).text();
    // keep only what the SVG needs: theme vars + canvas/symbol rules
    svgCssCache = css;
  } catch { svgCssCache = ''; }
  return svgCssCache;
}

function svgToDataUrl(svgEl, css) {
  const clone = svgEl.cloneNode(true);
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  const style = document.createElementNS('http://www.w3.org/2000/svg', 'style');
  style.textContent = css;
  clone.insertBefore(style, clone.firstChild);
  const str = new XMLSerializer().serializeToString(clone);
  return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(str);
}

// camera: eases toward the active component, falls back to fit-all
const cam = { cx: 0, cy: 0, scale: 0, init: false };
const camTarget = { cx: 0, cy: 0, scale: 0 };
let snapshotForCam = null;

function fitAll(img) {
  if (!img || !img.complete || !img.naturalWidth) return { cx: 0, cy: 0, scale: 1 };
  const scale = Math.min((W - 80) / img.naturalWidth, (H - 140) / img.naturalHeight);
  return { cx: img.naturalWidth / 2, cy: img.naturalHeight / 2, scale };
}

function drawFrame(ctx, img, caption, step) {
  ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--bg') || '#0d1117';
  ctx.fillRect(0, 0, W, H);

  if (img && img.complete && img.naturalWidth) {
    if (!cam.init) { Object.assign(cam, fitAll(img)); cam.init = true; }
    cam.cx += (camTarget.cx - cam.cx) * 0.07;
    cam.cy += (camTarget.cy - cam.cy) * 0.07;
    cam.scale += (camTarget.scale - cam.scale) * 0.07;
    ctx.save();
    ctx.translate(W / 2, 60 + (H - 140) / 2);
    ctx.scale(cam.scale, cam.scale);
    ctx.translate(-cam.cx, -cam.cy);
    ctx.drawImage(img, 0, 0);
    ctx.restore();
  }

  // brand
  ctx.fillStyle = '#ffb454';
  ctx.font = '700 20px "Segoe UI", system-ui, sans-serif';
  ctx.fillText('⚡ VoltLab', 28, 38);
  ctx.fillStyle = 'rgba(128,140,160,0.9)';
  ctx.font = '13px "Segoe UI", system-ui, sans-serif';
  ctx.fillText('motor control simulator — live simulation', 150, 37);

  // caption bar
  if (caption) {
    ctx.fillStyle = 'rgba(20,27,36,0.92)';
    ctx.fillRect(0, H - 64, W, 64);
    ctx.fillStyle = '#ffb454';
    ctx.fillRect(0, H - 64, 6, 64);
    ctx.fillStyle = '#e8eef7';
    ctx.font = '600 22px "Segoe UI", system-ui, sans-serif';
    ctx.fillText(caption, 24, H - 26);
  }

  // progress
  if (step) {
    ctx.fillStyle = 'rgba(128,140,160,0.9)';
    ctx.font = '12px "Segoe UI", system-ui, sans-serif';
    ctx.fillText(step, W - 130, H - 12);
  }
}

function buildGenericDemo(snapshot) {
  const steps = [{ caption: `VoltLab — ${snapshot.circuit} (live demo)` }, { wait: 2 }];
  const buttons = snapshot.components.filter(c => c.type === 'pushbutton_no' || c.type === 'pushbutton_nc');
  const toggles = snapshot.components.filter(c => c.type === 'breaker3' && c.state.closed);
  for (const b of buttons.slice(0, 6)) {
    steps.push({ caption: `Press ${b.label}` }, { press: b.id }, { wait: 2.2 }, { release: b.id }, { wait: 2.4 });
  }
  for (const t of toggles.slice(0, 1)) {
    steps.push({ caption: `Toggle ${t.label}` }, { toggle: t.id }, { wait: 2.2 }, { toggle: t.id }, { wait: 1.5 });
  }
  steps.push({ caption: 'End of demo' }, { wait: 2 });
  return steps;
}

export async function recordDemo(name, onProgress) {
  const svgEl = document.querySelector('#canvas');
  const css = await getSvgCss();

  // circuit demo script (from the circuit JSON) or a generic sweep
  let script;
  try {
    const health = await (await fetch('/api/health')).json();
    const list = health.circuits || [];
    if (list.includes(name)) {
      const json = await (await fetch(`/circuits/${name}.json`)).json();
      script = json.demo;
    }
  } catch { /* fall through */ }
  if (!script && window.__vlSnapshot) script = window.__vlSnapshot.circuitDemo;
  if (!script) {
    const r = await (await fetch('/api/state')).json();
    script = buildGenericDemo(r.state);
  }

  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d');
  document.body.appendChild(canvas);
  canvas.style.cssText = 'position:fixed;left:-9999px;top:0;';

  let img = new Image();
  let lastSvg = '';
  let currentCaption = '';
  let stepLabel = '';

  const stateRes = await (await fetch('/api/state')).json();
  snapshotForCam = stateRes.state;
  const compById = new Map(snapshotForCam.components.map(c => [c.id, c]));
  const aimAt = (id) => {
    const c = compById.get(id);
    if (!c) return;
    const size = (c.type in {}) ? null : null;
    camTarget.cx = c.x + 60; camTarget.cy = c.y + 60; camTarget.scale = 1.15;
  };
  camTarget.cx = snapshotForCam.components.reduce((m, c) => Math.max(m, c.x), 0) / 2;
  camTarget.cy = snapshotForCam.components.reduce((m, c) => Math.max(m, c.y), 0) / 2;

  const drawLoop = setInterval(() => {
    const str = svgToDataUrl(svgEl, css);
    if (str !== lastSvg) {
      lastSvg = str;
      const next = new Image();
      next.onload = () => { img = next; };
      next.src = str;
    }
    drawFrame(ctx, img, currentCaption, stepLabel);
  }, 40);

  const stream = canvas.captureStream(25);
  const mime = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm']
    .find(m => MediaRecorder.isTypeSupported(m)) || 'video/webm';
  const recorder = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 4_000_000 });
  const chunks = [];
  recorder.ondataavailable = e => { if (e.data.size) chunks.push(e.data); };

  const done = new Promise(resolve => { recorder.onstop = resolve; });
  recorder.start(250);

  const total = script.filter(s => s.caption !== undefined).length || 1;
  let captionIdx = 0;
  const sleep = (s) => new Promise(r => setTimeout(r, s * 1000));

  try {
    for (const step of script) {
      if (step.caption !== undefined) {
        captionIdx++;
        currentCaption = step.caption;
        stepLabel = `step ${captionIdx}/${total}`;
        onProgress?.(currentCaption, captionIdx, total);
      } else if (step.wait !== undefined) {
        await sleep(step.wait);
      } else if (step.press) {
        aimAt(step.press);
        await fetch('/api/command', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tool: 'press_button', args: { id: step.press } }) });
      } else if (step.release) {
        await fetch('/api/command', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tool: 'release_button', args: { id: step.release } }) });
      } else if (step.toggle) {
        aimAt(step.toggle);
        const r = await (await fetch('/api/state')).json();
        const c = r.state.components.find(x => x.id === step.toggle);
        const closed = c.state.closed ?? c.state.pos === '1';
        await fetch('/api/command', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tool: 'set_switch', args: { id: step.toggle, closed: !closed } }) });
      } else if (step.cam) {
        aimAt(step.cam[0]);
        await fetch('/api/command', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tool: 'set_position', args: { id: step.cam[0], position: step.cam[1] } }) });
      } else if (step.fit) {
        Object.assign(camTarget, fitAll(img));
      }
      await sleep(0.15); // pacing between actions
    }
  } finally {
    await sleep(0.6);
    clearInterval(drawLoop);
    recorder.stop();
  }

  await done;
  canvas.remove();
  const blob = new Blob(chunks, { type: 'video/webm' });
  const res = await fetch(`/api/export/video?circuit=${encodeURIComponent(name || 'circuit')}`, { method: 'POST', body: blob });
  return await res.json();
}
