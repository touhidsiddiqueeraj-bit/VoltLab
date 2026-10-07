// electron/main.mjs — Electron shell for the VoltLab simulator.
//
//   npm start                          — open the app window
//   npm start -- --smoke               — headless self-test (drives a DOL scenario, prints SMOKE OK)
//   npm start -- --screenshot=out.png  — load DOL demo, capture a PNG, exit
//   npm start -- --headless            — no window; host server + MCP API only
//
// The renderer is served over localhost HTTP by the same host used in browser mode,
// so the web build and the Electron build share one code path.

import { app, BrowserWindow, desktopCapturer } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHost } from '../server.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const APP_ICON = path.join(__dirname, '..', 'build', 'icon.png');

// dev (electron .): argv = [electron, appDir, ...flags]; packaged: [binary, ...flags]
const args = process.argv.slice(app.isPackaged ? 1 : 2);
const flag = (name) => args.some(a => a === name || a.startsWith(`${name}=`) || a === `--${name}`);
const flagValue = (name) => {
  const a = args.find(a => a.startsWith(`--${name}=`));
  return a ? a.split('=').slice(1).join('=') : undefined;
};

// Arch Linux and friends usually need this; harmless elsewhere.
if (process.platform === 'linux') {
  app.commandLine.appendSwitch('no-sandbox');
  app.commandLine.appendSwitch('disable-gpu-sandbox');
  app.commandLine.appendSwitch('disable-dev-shm-usage');
  // GPU compositing is the #1 cause of black/never-painting Electron windows on
  // Linux/Wayland — this app is 2D SVG, software rendering costs nothing.
  app.disableHardwareAcceleration();
  app.commandLine.appendSwitch('disable-gpu');
  // On hardened kernels (e.g. CachyOS 7.2.x) the Chromium zygote silently fails to
  // spawn renderer processes — the window loads forever and shows only the dark
  // background. Renderers spawn directly without it.
  app.commandLine.appendSwitch('no-zygote');
}
// escape hatch for odd environments: VL_CHROMIUM_FLAGS="no-zygote,disable-software-rasterizer"
for (const f of (process.env.VL_CHROMIUM_FLAGS || '').split(',').map(f => f.trim()).filter(Boolean)) {
  app.commandLine.appendSwitch(f);
}

// diagnostic + robustness: log every load/renderer event, never fail silently
function attachDiagnostics(wc, tag = 'win') {
  wc.on('did-finish-load', () => console.log(`[${tag}] did-finish-load`));
  wc.on('did-fail-load', (e, code, desc, url, isMain) => {
    if (isMain) console.error(`[${tag}] did-fail-load code=${code} ${desc} ${url}`);
  });
  wc.on('render-process-gone', (e, details) => console.error(`[${tag}] render-process-gone ${JSON.stringify(details)}`));
  wc.on('preload-error', (e, p, err) => console.error(`[${tag}] preload-error ${p} ${err}`));
  wc.on('console-message', (e, level, msg, line, source) => {
    if (level >= 2) console.error(`[${tag}] renderer error: ${msg} (${source}:${line})`);
  });
}

const SMOKE = flag('smoke');
const HEADLESS = flag('headless') || SMOKE || flag('screenshot');
const SHOT = flagValue('screenshot');

let win = null;

async function createWindow(url) {
  win = new BrowserWindow({
    width: 1560,
    height: 1020,
    icon: APP_ICON,
    title: 'VoltLab — Motor Control Simulator',
    backgroundColor: '#0d1117',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false
    }
  });
  await win.loadURL(url);
  return win;
}

// hidden window used for print-to-PDF (works without a visible compositor frame)
let pdfWindow = null;
async function pdfFromHtml(htmlPath, circuit) {
  if (!pdfWindow || pdfWindow.isDestroyed()) {
    pdfWindow = new BrowserWindow({
      show: false,
      width: 1240,
      height: 1754,
      webPreferences: { backgroundThrottling: false, sandbox: true, offscreen: true }
    });
  }
  await pdfWindow.loadFile(htmlPath);
  await new Promise(r => setTimeout(r, 700)); // let fonts/layout settle
  const out = htmlPath.replace(/-report\.html$/, '-report.pdf');
  const buf = await pdfWindow.webContents.printToPDF({ printBackground: true, preferCSSPageSize: true });
  fs.writeFileSync(out, buf);
  return out;
}

// Electron-only tool: capture the window as PNG, exposed to agents via the MCP `screenshot` tool.
// capturePage is flaky on Wayland/occluded windows, so fall back to a frame subscription.
async function screenshotTool({ path: outPath } = {}) {
  if (!win || win.isDestroyed()) throw new Error('no window (headless mode?)');
  const wc = win.webContents;
  wc.invalidate();

  const race = (p, ms) => Promise.race([p, new Promise(r => setTimeout(() => r(null), ms))]);
  let image = await race(wc.capturePage(), 2000);
  if (!image || image.isEmpty()) {
    image = await new Promise(resolve => {
      let settled = false;
      const timer = setTimeout(() => { if (!settled) { settled = true; wc.endFrameSubscription(sub); resolve(null); } }, 4000);
      const sub = (img) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        wc.endFrameSubscription(sub);
        resolve(img && !img.isEmpty() ? img : null);
      };
      wc.beginFrameSubscription(true, sub);
      wc.invalidate();
    });
  }
  if (!image || image.isEmpty()) {
    // last resort: grab the whole screen (works on X11 even when the window is occluded)
    try {
      const sources = await race(desktopCapturer.getSources({
        types: ['screen'],
        thumbnailSize: { width: win.getBounds().width * 2, height: win.getBounds().height * 2 }
      }), 4000);
      image = sources?.[0]?.thumbnail;
    } catch { /* fall through */ }
  }
  if (!image || image.isEmpty()) throw new Error('could not capture a frame (compositor did not paint the window)');
  const file = outPath || path.join(process.cwd(), 'out', `screenshot-${Date.now()}.png`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, image.toPNG());
  return { saved: file, size: image.getSize() };
}

async function runSmoke(host) {
  const call = (tool, args) => host.api.call(tool, args);
  const st = async () => {
    const r = await call('get_state', { logLimit: 0 });
    return r.state;
  };
  const comp = (s, id) => s.components.find(c => c.id === id);
  const assert = (cond, msg) => {
    if (!cond) throw new Error(`SMOKE FAIL: ${msg}`);
  };

  await call('load_circuit', { name: 'dol-starter' });
  await call('sim_control', { action: 'pause' });
  await call('sim_control', { action: 'advance', seconds: 0.2 });

  let s = await st();
  assert(comp(s, 'H1')?.state.lit === true, 'power lamp H1 should be lit after loading DOL circuit');
  assert(comp(s, 'KM1')?.state.energized === false, 'contactor must start de-energized');

  await call('set_switch', { id: 'Q1', closed: false });
  s = await st();
  assert(comp(s, 'H1')?.state.lit === false, 'H1 must go dark when Q1 opens');
  await call('set_switch', { id: 'Q1', closed: true });

  await call('press_button', { id: 'S1' });
  await call('sim_control', { action: 'advance', seconds: 0.5 });
  await call('release_button', { id: 'S1' });
  await call('sim_control', { action: 'advance', seconds: 2 });
  s = await st();
  assert(comp(s, 'KM1')?.state.energized === true, 'contactor must hold via seal-in after releasing START');
  assert(comp(s, 'M1')?.state.speed > 0.7, 'motor must spin up');
  assert(comp(s, 'H2')?.state.lit === true, 'run lamp H2 must be lit');

  await call('press_button', { id: 'S0' });
  await call('sim_control', { action: 'advance', seconds: 0.3 });
  await call('release_button', { id: 'S0' });
  s = await st();
  assert(comp(s, 'KM1')?.state.energized === false, 'STOP must drop the contactor');
  await call('sim_control', { action: 'advance', seconds: 6 });
  s = await st();
  assert(comp(s, 'M1')?.state.speed < 0.06, 'motor must coast to a stop');

  await call('inject_fault', { type: 'stall', target: 'M1' });
  await call('press_button', { id: 'S1' });
  await call('sim_control', { action: 'advance', seconds: 0.3 });
  await call('release_button', { id: 'S1' });
  await call('sim_control', { action: 'advance', seconds: 30 });
  s = await st();
  assert(comp(s, 'KK1')?.state.tripped === true, 'overload KK1 must trip on stalled motor');
  assert(comp(s, 'KM1')?.state.energized === false, 'overload trip must drop the contactor');
  assert(comp(s, 'H3')?.state.lit === true, 'trip lamp H3 must be lit');

  await call('clear_fault', { type: 'stall' });
  await call('reset_overload', { id: 'KK1' });
  s = await st();
  assert(comp(s, 'KK1')?.state.tripped === false, 'overload must reset');
  console.log('SMOKE OK — full DOL scenario passed inside Electron');
}

app.whenReady().then(async () => {
  try {
    // port 8123, fall back to a random free port if occupied
    let host;
    try { host = await createHost({ port: Number(process.env.VOLTLAB_PORT || process.env.EKTS_PORT) || 8123 }); }
    catch { host = await createHost({ port: 0 }); }
    host.api.registerExtra('screenshot', screenshotTool);
    host.registerExportHandler('export_pdf_renderer', pdfFromHtml);

    // preload demo circuit
    if (host.api.listCircuits().includes('dol-starter')) {
      await host.api.call('load_circuit', { name: 'dol-starter' });
      await host.api.call('sim_control', { action: 'run' });
    }

    console.log(`[voltlab-electron] API on ${host.url}`);

    if (SMOKE) {
      await new Promise(r => setTimeout(r, 800));
      await runSmoke(host);
      app.exit(0);
      return;
    }

    if (flag('check')) {
      // load diagnostics: proves/disproves page load, DOM, and painting
      const win2 = new BrowserWindow({
        show: true, width: 1200, height: 800,
        backgroundColor: '#ff00ff', // magenta marker: visible only if nothing paints over it
        webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: false }
      });
      const wc = win2.webContents;
      wc.on('did-fail-load', (e, code, desc, url, isMain) => console.error(`[check] did-fail-load code=${code} ${desc} ${url} main=${isMain}`));
      wc.on('render-process-gone', (e, d) => console.error(`[check] render-process-gone ${JSON.stringify(d)}`));
      wc.on('did-finish-load', () => console.log('[check] did-finish-load'));
      wc.on('console-message', (e, level, msg) => { if (level >= 2) console.log(`[check] renderer: ${msg}`); });
      console.log('[check] loading', host.url);
      try { await win2.loadURL(host.url); console.log('[check] loadURL resolved'); }
      catch (e) { console.log('[check] loadURL FAILED:', e.message); }
      await new Promise(r => setTimeout(r, 3000));
      try {
        const diag = await wc.executeJavaScript(`JSON.stringify({
          title: document.title,
          bodyLen: document.body.innerHTML.length,
          hasToolbar: !!document.querySelector('#toolbar'),
          hasCanvas: !!document.querySelector('#canvas'),
          circuits: document.querySelector('#circuit-select') ? document.querySelector('#circuit-select').length : -1,
          sse: !!window.EventSource && 'ok'
        })`);
        console.log('[check] DOM:', diag);
      } catch (e) { console.log('[check] executeJavaScript FAILED:', e.message); }
      try {
        const img = await wc.capturePage();
        console.log('[check] capturePage:', img.isEmpty() ? 'EMPTY' : `${img.getSize().width}x${img.getSize().height}`);
        if (!img.isEmpty()) {
          const out = '/home/touhid/Downloads/ekts/out/check.png';
          fs.mkdirSync(path.dirname(out), { recursive: true });
          fs.writeFileSync(out, img.toPNG());
          console.log('[check] capture written:', out);
        }
      } catch (e) { console.log('[check] capturePage failed:', e.message); }
      await new Promise(r => setTimeout(r, 1500));
      app.exit(0);
      return;
    }

    if (flag('pdf-test')) {
      // hidden-window print-to-PDF self test
      const win2 = new BrowserWindow({ show: false, width: 1240, height: 1754, webPreferences: { backgroundThrottling: false, offscreen: true } });
      await win2.loadURL(host.url);
      await new Promise(r => setTimeout(r, 2500));
      const out = process.env.PDF_OUT || path.join(process.cwd(), 'out', 'pdf-test.pdf');
      fs.mkdirSync(path.dirname(out), { recursive: true });
      const buf = await win2.webContents.printToPDF({ printBackground: true });
      fs.writeFileSync(out, buf);
      console.log(`[voltlab-electron] PDF saved: ${out} (${buf.length} bytes)`);
      app.exit(0);
      return;
    }

    if (SHOT) {
      await createWindow(host.url);
      await new Promise(r => setTimeout(r, 2000));
      const res = await screenshotTool({ path: SHOT });
      console.log(`[voltlab-electron] screenshot saved: ${res.saved}`);
      app.exit(0);
      return;
    }

    if (!HEADLESS) {
      await createWindow(host.url);
      attachDiagnostics(win.webContents, 'win');
      win.webContents.on('did-fail-load', async (e, code, desc, url, isMain) => {
        if (!isMain) return;
        // never leave the user with an unexplained black window
        const data = `<!DOCTYPE html><html><body style="font:16px system-ui;background:#141b24;color:#e8eef7;padding:40px">
          <h2>VoltLab couldn't load its UI</h2><p>code ${code}: ${desc}<br>${url}</p>
          <p>The simulator API is still running — open <code>${host.url}</code> in a browser meanwhile.</p></body></html>`;
        win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(data)).catch(() => {});
      });
      console.log('[voltlab-electron] window open — MCP agents can drive the app via mcp/server.mjs');
    } else {
      console.log('[voltlab-electron] headless mode — no window, API + MCP layer active');
    }
  } catch (err) {
    console.error('[voltlab-electron] FATAL', err);
    app.exit(1);
  }
});

app.on('window-all-closed', () => {
  // Stay alive in headless/host mode so MCP agents keep their endpoint;
  // quit when the user closes the window.
  if (HEADLESS) return;
  app.quit();
});
