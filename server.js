// server.js — dependency-free HTTP host for the simulator.
// Serves the web app, the control API, and an SSE state stream.
// Run directly for browser mode:  node server.js
// Electron imports createHost() from here.

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createApi, CIRCUITS_DIR } from './sim/api.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const APP_DIR = path.join(__dirname, 'app');
const SIM_DIR = path.join(__dirname, 'sim');
const MCP_SCRIPT = path.join(__dirname, 'mcp', 'server.mjs');
const EXPORTS_DIR = path.join(__dirname, 'exports');

function htmlToPdfViaChrome(htmlPath) {
  return new Promise(resolve => {
    const out = htmlPath.replace(/-report\.html$/, '-report.pdf');
    const candidates = ['google-chrome-stable', 'google-chrome', 'chromium', 'chromium-browser'];
    const tryBin = (i) => {
      if (i >= candidates.length) return resolve(null);
      execFile(candidates[i], ['--headless=new', '--disable-gpu', '--no-sandbox',
        '--print-to-pdf=' + out, '--no-pdf-header-footer', 'file://' + htmlPath],
        { timeout: 60000 }, err => {
          if (!err && fs.existsSync(out)) resolve(out);
          else tryBin(i + 1);
        });
    };
    tryBin(0);
  });
}

function transcodeToMp4(webmPath) {
  return new Promise(resolve => {
    const out = webmPath.replace(/\.webm$/, '.mp4');
    execFile('ffmpeg', ['-y', '-i', webmPath, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', out],
      { timeout: 120000 }, err => resolve(err ? null : out));
  });
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon'
};

export async function createHost({ port = 8123, host = '127.0.0.1' } = {}) {
  const api = createApi();
  fs.mkdirSync(EXPORTS_DIR, { recursive: true });

  // renderer listens for these over SSE and uploads the finished artifact
  api.setExportHook((kind, name) => {
    for (const res of sseClients) {
      try { res.write(`event: export-request\ndata: ${JSON.stringify({ kind, name })}\n\n`); } catch {}
    }
  });
  let agentLastSeen = null; // timestamp of the last MCP-style agent tool call

  // preload available circuits into the engine so the UI has something on open? No —
  // start empty; the UI offers a circuit picker. Tests load explicitly.
  const sseClients = new Set();
  const extraHandlers = new Map();
  let lastSnapshot = null;
  let lastVersion = -1;

  function sanitizeExportName(name) {
    return String(name).replace(/[^A-Za-z0-9._-]/g, '-') || 'circuit';
  }

  function broadcast() {
    if (!sseClients.size) return;
    const snap = api.engine.snapshot(30);
    lastSnapshot = snap;
    lastVersion = snap.version;
    const frame = `event: state\ndata: ${JSON.stringify(snap)}\n\n`;
    for (const res of sseClients) {
      try { res.write(frame); } catch { sseClients.delete(res); }
    }
  }

  // realtime loop
  let timer = null;
  function startLoop() {
    if (timer) return;
    timer = setInterval(() => {
      const e = api.engine;
      if (e.running) e.step(e.tickRate);
      if (!lastSnapshot || api.engine.version !== lastVersion || api.engine.running) broadcast();
    }, 100);
  }

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const p = url.pathname;

    // CORS for local agent tooling
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

    if (p === '/api/events') {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive'
      });
      res.write(`event: hello\ndata: ${JSON.stringify({ circuit: api.engine.circuitName, t: api.engine.t })}\n\n`);
      res.write(`event: state\ndata: ${JSON.stringify(api.engine.snapshot(30))}\n\n`);
      sseClients.add(res);
      req.on('close', () => sseClients.delete(res));
      return;
    }

    if (p === '/api/tools') {
      agentLastSeen = Date.now();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, tools: api.TOOLS }));
      return;
    }

    if (p === '/api/state') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, state: api.engine.snapshot(50) }));
      return;
    }

    if (p === '/api/command' && req.method === 'POST') {
      let body = '';
      req.on('data', c => { body += c; if (body.length > 1e6) req.destroy(); });
      req.on('end', async () => {
        let tool, args;
        try {
          const j = JSON.parse(body || '{}');
          tool = j.tool || j.name; args = j.args || j.arguments || {};
        } catch {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: 'invalid JSON body: {"tool": "...", "args": {...}}' }));
          return;
        }
        agentLastSeen = Date.now();
        const result = await api.call(tool, args);
        broadcast();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(result));
      });
      return;
    }

    if (p === '/api/export/video' && req.method === 'POST') {
      const circuit = sanitizeExportName(url.searchParams.get('circuit') || 'circuit');
      const file = path.join(EXPORTS_DIR, `${circuit}-${Date.now()}.webm`);
      const chunks = [];
      req.on('data', c => chunks.push(c));
      req.on('end', async () => {
        fs.writeFileSync(file, Buffer.concat(chunks));
        let finalPath = file;
        const mp4 = await transcodeToMp4(file);
        if (mp4) { fs.unlinkSync(file); finalPath = mp4; }
        const payload = { path: finalPath, bytes: fs.statSync(finalPath).size };
        api.completeExport('video', circuit, payload);
        api.completeExport('video', api.engine.circuitName, payload);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, ...payload }));
      });
      return;
    }

    if (p === '/api/export/report' && req.method === 'POST') {
      let body = '';
      req.on('data', c => { body += c; if (body.length > 2e7) req.destroy(); });
      req.on('end', async () => {
        let html = '', circuit = 'circuit';
        try { const j = JSON.parse(body); html = j.html; circuit = sanitizeExportName(j.circuit || 'circuit'); } catch {}
        const htmlPath = path.join(EXPORTS_DIR, `${circuit}-report.html`);
        fs.writeFileSync(htmlPath, html);
        let pdfHandler = extraHandlers.get('export_pdf_renderer');
        if (!pdfHandler) pdfHandler = htmlToPdfViaChrome;
        if (pdfHandler) {
          try {
            const pdfPath = await pdfHandler(htmlPath, circuit);
            api.completeExport('pdf', circuit, { path: pdfPath });
            api.completeExport('pdf', api.engine.circuitName, { path: pdfPath });
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: true, path: pdfPath }));
          } catch (err) {
            api.completeExport('pdf', circuit, { path: htmlPath, note: `print-to-pdf failed: ${err.message}` });
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: true, path: htmlPath, note: String(err.message) }));
          }
        } else {
          const payload = { path: htmlPath, note: 'HTML report saved — open it and print to PDF (browser mode)' };
          api.completeExport('pdf', circuit, payload);
          api.completeExport('pdf', api.engine.circuitName, payload);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true, ...payload }));
        }
      });
      return;
    }

    if (p === '/api/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        ok: true,
        app: 'voltlab',
        circuit: api.engine.circuitName,
        circuits: api.listCircuits(),
        mcpScript: MCP_SCRIPT,
        agentLastSeenSec: agentLastSeen ? Math.round((Date.now() - agentLastSeen) / 1000) : null
      }));
      return;
    }

    // static files (app/, the shared sim/ registry, and the circuits library)
    let file = p === '/' ? '/index.html' : p;
    let base = APP_DIR, rel = file;
    if (file.startsWith('/sim/')) { base = SIM_DIR; rel = file.slice(5); }
    if (file.startsWith('/circuits/')) { base = CIRCUITS_DIR; rel = file.slice(10); }
    const abs = path.normalize(path.join(base, rel));
    if (!abs.startsWith(base)) { res.writeHead(403); res.end(); return; }
    fs.readFile(abs, (err, data) => {
      if (err) { res.writeHead(404, { 'Content-Type': 'text/plain' }); res.end('not found'); return; }
      res.writeHead(200, {
        'Content-Type': MIME[path.extname(abs)] || 'application/octet-stream',
        // keep dev iteration honest: always revalidate assets
        'Cache-Control': 'no-cache'
      });
      res.end(data);
    });
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, resolve);
  });
  startLoop();

  const addr = server.address();
  return {
    server, api, port: addr.port, url: `http://${host}:${addr.port}`, broadcast,
    registerExportHandler: (kind, fn) => extraHandlers.set(kind, fn),
    exportsDir: EXPORTS_DIR
  };
}

// direct invocation: node server.js
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const port = Number(process.env.VOLTLAB_PORT || process.env.EKTS_PORT) || 8123;
  const { url, api } = await createHost({ port });
  console.log(`VoltLab running at ${url}`);
  console.log(`MCP endpoint: run  node mcp/server.mjs  (VOLTLAB_URL=${url})`);
  console.log(`Circuits dir: ${CIRCUITS_DIR} (${api.listCircuits().join(', ') || 'none yet'})`);
  // auto-load the DOL demo if it exists and no circuit was requested
  if (api.listCircuits().includes('dol-starter') && process.env.VOLTLAB_AUTOLOAD !== 'none') {
    await api.call('load_circuit', { name: 'dol-starter' });
    await api.call('sim_control', { action: 'run' });
    console.log('Loaded demo circuit "dol-starter" (sim running). Use clear_circuit / load_circuit to change.');
  }
}
