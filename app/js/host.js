// app/js/host.js — the single transport seam for the UI.
//
// Two modes behind one interface:
//   http  — the app is served by server.js / Electron: fetch + SSE, exactly
//           the behaviour the app has always had.
//   local — Tier 2 offline mode (Android APK, file://, or ?local=1): the real
//           engine + dispatcher run inside the page (local-api.js), circuits
//           persist to localStorage, exports save as files.
//
// main.js / video.js never talk to fetch('/api/...') directly — they go
// through this module, so every feature works in both modes.

import { createLocalHost } from './local-api.js';

const params = new URLSearchParams(location.search);
const LOCAL = params.has('local')
  || location.protocol === 'file:'
  || !!(window.Capacitor?.isNativePlatform?.());

// the live instance — set by initHost() at boot, read by modules that run
// only after boot (video.js recordings, etc.)
let instance = null;
export const getHost = () => instance;

// ---------- local-mode file saving ----------
// On Android (Capacitor + @capacitor/filesystem) files land in the app's
// Documents directory; in a plain browser they download via an anchor.
async function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(String(fr.result).split(',')[1]);
    fr.onerror = () => reject(new Error('could not read blob'));
    fr.readAsDataURL(blob);
  });
}

async function saveFile(filename, data, mime = 'application/octet-stream') {
  const cap = window.Capacitor;
  const isText = typeof data === 'string';
  try {
    if (cap?.isPluginAvailable?.('Filesystem')) {
      const payload = isText
        ? { path: filename, directory: 'DOCUMENTS', data, recursive: true }
        : { path: filename, directory: 'DOCUMENTS', data: await blobToBase64(data), recursive: true };
      const r = await cap.Plugins.Filesystem.writeFile(payload);
      return r?.path || `Documents/${filename}`;
    }
  } catch (e) {
    // fall through to a download attempt — better than losing the export
    console.warn('Filesystem.writeFile failed, falling back to download', e);
  }
  const blob = isText ? new Blob([data], { type: mime }) : data;
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
  return `Downloads/${filename}`;
}

function timestamp() {
  return new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
}

/**
 * Build and wire the host. Call once at boot.
 *
 * @param {object} cb
 * @param {Function} cb.onState          (snapshot) — the 10 Hz stream
 * @param {Function} cb.onExportRequest  ({kind, name}) — renderer records
 * @param {Function} [cb.onStatus]      (online:boolean) — connection dot
 * @param {Function} [cb.getPngDataUrl]  () => Promise<string> — canvas → PNG
 *                                          (local-mode screenshot support)
 */
export async function initHost({ onState, onExportRequest, onStatus, getPngDataUrl }) {
  if (LOCAL) {
    const h = createLocalHost({ onState, onExportRequest });
    instance = h;

    // local screenshot: serialize the canvas SVG → PNG → save
    if (getPngDataUrl) {
      h.registerExtra('screenshot', async () => {
        const url = await getPngDataUrl();
        const bin = atob(url.split(',')[1]);
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        const blob = new Blob([bytes], { type: 'image/png' });
        const path = await saveFile(`voltlab-${timestamp()}.png`, blob);
        return { saved: path };
      });
    }

    await h.connect();
    onStatus?.(true);

    return {
      mode: 'local',
      engine: h.engine,
      call: (tool, args) => h.call(tool, args),
      state: (limit) => Promise.resolve(h.state(limit)),
      health: () => h.health(),
      loadCircuitJson: (name) => h.loadCircuitJson(name),
      completeExport: (kind, name, payload) => h.completeExport(kind, name, payload),
      uploadVideo: async (blob, name) => {
        const path = await saveFile(`voltlab-${name || 'demo'}-${timestamp()}.webm`, blob);
        const payload = { ok: true, path };
        h.completeExport('video', name, payload);
        h.completeExport('video', h.engine.circuitName, payload);
        return payload;
      },
      submitReport: async (html, circuit) => {
        const path = await saveFile(`voltlab-${circuit || 'report'}-${timestamp()}.html`, html, 'text/html');
        const payload = { ok: true, path, note: 'HTML report saved — open it and print to PDF' };
        h.completeExport('pdf', circuit, payload);
        h.completeExport('pdf', h.engine.circuitName, payload);
        return payload;
      }
    };
  }

  // ---------- http mode (server.js / Electron) ----------
  const post = async (url, body) => (await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  })).json();

  const es = new EventSource('/api/events');
  es.addEventListener('state', (ev) => { onStatus?.(true); onState(JSON.parse(ev.data)); });
  es.addEventListener('hello', () => onStatus?.(true));
  es.addEventListener('export-request', (ev) => onExportRequest(JSON.parse(ev.data)));
  es.onerror = () => onStatus?.(false);

  const h = {
    mode: 'http',
    call: (tool, args) => post('/api/command', { tool, args }),
    state: async (limit) => (await (await fetch(`/api/state?limit=${limit ?? 50}`)).json()).state,
    health: async () => (await (await fetch('/api/health')).json()),
    loadCircuitJson: async (name) => (await (await fetch(`/circuits/${name}.json`)).json()),
    completeExport: () => { /* the server completes exports via its endpoints */ },
    uploadVideo: async (blob, name) => {
      const res = await fetch(`/api/export/video?circuit=${encodeURIComponent(name || 'circuit')}`,
        { method: 'POST', body: blob });
      return res.json();
    },
    submitReport: async (html, circuit) => {
      const res = await fetch('/api/export/report', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ html, circuit })
      });
      return res.json();
    }
  };
  instance = h;
  return h;
}

export const isLocalMode = () => LOCAL;
