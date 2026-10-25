// app/js/report.js — industry-standard multi-sheet drawing set (IEC 61082-1 style):
//   Sheet 1            cover/index: title block, overview with sheet map, sheet index
//   Sheets 2..n        schematic tiled 1:1 across landscape sheets, each with a zone
//                      reference grid (A.. / 1..) and a title block
//   then               symbol legend, component tables, event log
// All sheets A4 landscape with border + title block, light print theme.

import { DEVICE_TYPES } from '/sim/devices.js';
import { SYMBOLS } from './symbols.js';

// A4 landscape @96dpi minus margins
const SHEET_W = 1030;
const SHEET_H = 690;
const PAD = 42;            // inner border padding
const OVERLAP = 70;        // tile overlap so nothing hides on a seam
const COLS_ZONE = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');

function idleState(type) {
  return { closed: false, energized: false, pressed: false, lit: false,
           blown: [false, false, false], pos: '0', speed: 0, tripped: false,
           thermal: 0, done: false, on: false, position: 1 };
}

/** clone the live canvas svg with a given viewBox (px coords of the canvas) */
function tileSvg(svgEl, vb) {
  const clone = svgEl.cloneNode(true);
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  clone.removeAttribute('style');
  clone.removeAttribute('width');
  clone.removeAttribute('height');
  clone.setAttribute('viewBox', vb.join(' '));
  clone.setAttribute('preserveAspectRatio', 'xMidYMid meet');
  return clone.outerHTML;
}

function zoneLabels(cols, rows) {
  // tick labels along the border: letters across the top, numbers down the left
  const top = COLS_ZONE.slice(0, cols).map((c, i) =>
    `<span class="zone zt" style="left:${((i + 0.5) * 100) / cols}%">${c}</span>`).join('');
  const left = Array.from({ length: rows }, (_, i) =>
    `<span class="zone zl" style="top:${((i + 0.5) * 100) / rows}%">${i + 1}</span>`).join('');
  return `<div class="zones">${top}${left}</div>`;
}

function titleBlock(circuit, sheetNo, sheetTotal, dateStr, note = 'SCHEMATIC') {
  return `<div class="tblock">
    <span class="tb-brand">⚡ VoltLab</span>
    <span class="tb-name">${esc(circuit)}</span>
    <span class="tb-note">${esc(note)}</span>
    <span class="tb-date">${esc(dateStr)}</span>
    <span class="tb-sheet">SHEET ${sheetNo} / ${sheetTotal}</span>
    <span class="tb-rev">REV A</span>
  </div>`;
}

export async function buildReport(snapshot) {
  const dateStr = new Date().toLocaleString();
  const circuit = snapshot.circuit;
  const svgEl = document.querySelector('#canvas').cloneNode(true);
  svgEl.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  svgEl.removeAttribute('style');

  // content bounds with padding
  const vbRaw = (svgEl.getAttribute('viewBox') || '0 0 1500 1100').split(/\s+/).map(Number);
  const pad = 50;
  const bx = vbRaw[0] - pad, by = vbRaw[1] - pad;
  const bw = vbRaw[2] + pad * 2, bh = vbRaw[3] + pad * 2;

  // ---- tiling plan (1:1 px scale, overlap so seam components stay readable) ----
  const tileW = SHEET_W - PAD * 2;   // ~988
  const tileH = SHEET_H - PAD * 2;   // ~628
  const stepX = tileW - OVERLAP, stepY = tileH - OVERLAP;
  const tileCols = Math.max(1, Math.ceil((bw - OVERLAP) / stepX));
  const tileRowsN = Math.max(1, Math.ceil((bh - OVERLAP) / stepY));
  const spanX = stepX * (tileCols - 1) + tileW, spanY = stepY * (tileRowsN - 1) + tileH;
  const tiles = [];
  for (let r = 0; r < tileRowsN; r++) {
    for (let c = 0; c < tileCols; c++) {
      tiles.push({
        x: bx + c * stepX - (spanX - bw) / 2,
        y: by + r * stepY - (spanY - bh) / 2,
        col: c + 1, row: r + 1
      });
    }
  }
  const totalSheets = tiles.length + 3; // + cover, legend, tables
  const dateStrCached = dateStr;

  // ---- sheet 1: cover / index ----
  const overviewSvg = tileSvg(svgEl, [bx, by, bw, bh]);
  const tileMap = tiles.map((t, i) => `
    <div class="tmap" style="left:${((t.x - bx) / bw) * 100}%;top:${((t.y - by) / bh) * 100}%;
         width:${(tileW / bw) * 100}%;height:${(tileH / bh) * 100}%">${i + 2}</div>`).join('');
  const indexRows = tiles.map((t, i) => {
    const zone = `${COLS_ZONE[t.col - 1]}${t.row}`;
    const compsIn = snapshot.components.filter(c =>
      c.x >= t.x - 60 && c.x < t.x + tileW - 40 && c.y >= t.y - 60 && c.y < t.y + tileH - 40);
    const names = compsIn.slice(0, 6).map(c => c.id).join(', ') + (compsIn.length > 6 ? ' …' : '');
    return `<tr><td class="mono">${i + 2}</td><td class="mono">${zone}</td><td>${esc(names || '—')}</td><td>${compsIn.length}</td></tr>`;
  }).join('');

  const cover = `
  <section class="sheet">
    <div class="cover">
      <div class="cov-brand">⚡ VoltLab</div>
      <h1>${esc(circuit)}</h1>
      <div class="sub">Circuit drawing set · ${snapshot.components.length} components · ${snapshot.wires.length} wires · sim time ${snapshot.t.toFixed(1)} s · generated ${esc(dateStrCached)}</div>
      ${Object.keys(snapshot.faults || {}).length ? `<div class="faults">ACTIVE FAULTS: ${esc(Object.keys(snapshot.faults).join(', '))}</div>` : ''}
      <div class="cov-flex">
        <div class="cov-map sheet-dark">${overviewSvg}${tileMap}</div>
        <div class="cov-index">
          <h2>Sheet Index</h2>
          <table><thead><tr><th>Sheet</th><th>Zone</th><th>Devices</th><th>#</th></tr></thead>
          <tbody>${indexRows}</tbody></table>
          <p class="note">Schematic sheets are tiled 1:1 with ${OVERLAP}px overlap — adjacent sheets repeat one strip of the drawing so seams stay readable. Zone letters run across the top of each sheet, numbers down the left.</p>
        </div>
      </div>
      ${titleBlock(circuit, 1, totalSheets, dateStrCached, 'DRAWING SET INDEX')}
    </div>
  </section>`;

  // ---- sheets 2..n: schematic tiles with zone grids + title block ----
  const schematicSheets = tiles.map((t, i) => {
    const no = i + 2;
    const zone = `${COLS_ZONE[t.col - 1]}${t.row}`;
    return `
  <section class="sheet">
    <div class="frame">
      ${zoneLabels(Math.min(tileCols, 8), Math.min(tileRowsN, 8))}
      <div class="tile">${tileSvg(svgEl, [t.x, t.y, tileW, tileH])}</div>
      <div class="seam-note">continues on adjacent sheets · overlap ${OVERLAP}px</div>
    </div>
    ${titleBlock(circuit, no, totalSheets, dateStrCached, `SCHEMATIC — ZONE ${zone}`)}
  </section>`;
  }).join('');

  // ---- legend sheet ----
  const legend = Object.entries(DEVICE_TYPES).map(([type, spec]) => `
    <div class="lg">
      <svg viewBox="-16 -10 ${spec.size.w + 32} ${spec.size.h + 34}">${SYMBOLS[type]({ x: 0, y: 0, label: '', params: {} }, idleState(type))}</svg>
      <div><div class="lt">${esc(spec.label)}</div><div class="ld">${esc(spec.desc || '')}</div></div>
    </div>`).join('');

  // ---- tables ----
  const rows = snapshot.components.map(c => {
    const stateStr = Object.entries(c.state)
      .map(([k, v]) => `${k}=${typeof v === 'boolean' ? v : JSON.stringify(v)}`)
      .join('  ');
    const params = Object.entries(c.params).map(([k, v]) => `${k}=${v}`).join('  ');
    return `<tr><td class="mono">${esc(c.id)}</td><td>${esc(c.label)}</td><td>${esc(DEVICE_TYPES[c.type].label)}</td><td class="mono">${esc(params)}</td><td class="mono st">${esc(stateStr)}</td></tr>`;
  }).join('');

  const log = snapshot.log.map(v =>
    `<tr><td class="mono">${v.t.toFixed(1)}s</td><td class="${v.level}">${esc(v.msg)}</td></tr>`).join('');

  return `<!DOCTYPE html>
<html lang="en" data-theme="light"><head><meta charset="utf-8">
<title>VoltLab — ${esc(circuit)} — drawing set</title>
<style>
  :root {
    --bg:#f8fafc; --panel:#ffffff; --panel2:#eef1f6; --line:#cbd5e1; --text:#1e293b; --dim:#64748b;
    --accent:#b45309; --accent2:#0284c7; --hot:#ea580c; --ok:#059669; --bad:#dc2626;
    --bad-bg:#fee2e2; --bad-text:#b91c1c; --wire-off:#b0bac7; --wire-mix:#6b7280; --grid-dot:#dde3ec;
    --sym-body:#ffffff; --sym-idle:#94a3b8; --sym-border:#cbd5e1; --sym-rotor:#a8b3c2;
    --sym-dim:#64748b; --sym-label:#475569;
    --ph-L1:#a3671f; --ph-L2:#6b7280; --ph-L3:#96525c; --ph-N:#2563eb;
  }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; background: #525659; }
  body { font: 12px/1.5 "Segoe UI", system-ui, sans-serif; color: var(--text); }
  @page { size: A4 landscape; margin: 6mm; }
  .sheet {
    width: ${SHEET_W + 36}px; min-height: ${SHEET_H + 36}px;
    background: var(--panel); margin: 8px auto; padding: 12px;
    page-break-after: always; position: relative;
    display: flex; flex-direction: column;
  }
  @media print { .sheet { margin: 0; box-shadow: none; } }
  h1 { font-size: 22px; margin: 4px 0 2px; } .sub { color: var(--dim); margin: 4px 0 10px; }
  h2 { font-size: 12px; text-transform: uppercase; letter-spacing: 1.2px; color: var(--dim);
       border-bottom: 1px solid var(--line); padding-bottom: 3px; margin: 14px 0 8px; page-break-after: avoid; }
  .faults { color: var(--bad); font-weight: 700; margin-bottom: 8px; }
  .mono { font-family: ui-monospace, Menlo, Consolas, monospace; }
  table { width: 100%; border-collapse: collapse; table-layout: auto; }
  th, td { text-align: left; padding: 3px 8px; border-bottom: 1px solid var(--line); font-size: 11px; }
  th { color: var(--dim); font-weight: 600; font-size: 10px; text-transform: uppercase; letter-spacing: .8px; }
  tr { page-break-inside: avoid; }
  td.st { font-size: 10px; }
  .info { color: var(--text); } .warn { color: var(--accent); } .fault { color: var(--bad); font-weight: 600; }
  .note { color: var(--dim); font-size: 10.5px; margin-top: 8px; }

  /* cover */
  .cover { flex: 1; display: flex; flex-direction: column; }
  .cov-brand { font-size: 18px; font-weight: 700; color: var(--accent); }
  .cov-flex { display: flex; gap: 14px; flex: 1; min-height: 0; }
  .cov-map { position: relative; flex: 1.35; border: 1px solid var(--line); border-radius: 6px;
             overflow: hidden; height: 500px; }
  .cov-map svg { width: 100%; height: 100%; display: block; }
  .sheet-dark { background: #10161f; }
  .tmap { position: absolute; border: 1.5px dashed #ffb454; color: #ffb454;
          font: 700 11px ui-monospace, monospace; display: flex; align-items: flex-start;
          justify-content: flex-end; padding: 2px 4px; }
  .cov-index { flex: 1; overflow: hidden; }
  .cov-index table { font-size: 10px; }

  /* drawing frame + zones */
  .frame { flex: 1; border: 1.6px solid var(--text); position: relative; padding: 18px 0 0 18px; min-height: 0; }
  .zone { position: absolute; font: 600 9px ui-monospace, monospace; color: var(--dim); }
  .zt { top: 2px; transform: translateX(-50%); }
  .zl { left: 3px; transform: translateY(-50%); }
  .tile { width: 100%; height: 100%; overflow: hidden; background: var(--bg);
          border: 1px solid var(--line); }
  .tile svg { width: 100%; height: 100%; display: block; }
  .seam-note { position: absolute; right: 10px; top: 4px; font-size: 9px; color: var(--dim); }

  /* title block strip */
  .tblock {
    display: flex; align-items: center; gap: 18px;
    border: 1.4px solid var(--text); border-top: 0;
    padding: 5px 12px; font-size: 11px; background: var(--panel2);
  }
  .tb-brand { font-weight: 700; color: var(--accent); }
  .tb-name { font-weight: 600; }
  .tb-note { color: var(--dim); flex: 1; text-align: right; }
  .tb-sheet, .tb-rev { font-family: ui-monospace, monospace; font-weight: 700; }

  /* legend */
  #legend-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; }
  .lg { display: flex; gap: 8px; border: 1px solid var(--line); border-radius: 6px;
        padding: 6px; page-break-inside: avoid; }
  .lg svg { width: 58px; height: 78px; flex-shrink: 0; background: var(--bg); border-radius: 4px; }
  .lt { font-weight: 600; font-size: 11px; } .ld { color: var(--dim); font-size: 9.5px; }

  /* symbol classes for the embedded schematics */
  .s-body{fill:var(--sym-body);} .s-stroke{stroke:var(--sym-idle);} .s-stroke2{stroke:var(--sym-border);}
  .s-dim{fill:var(--sym-dim);} .s-hi{fill:var(--text);} .s-rotor{stroke:var(--sym-rotor);}
  .s-blade{stroke:var(--hot);} .comp-label{fill:var(--sym-label);font:11px ui-monospace,monospace;text-anchor:middle;}
  .sel-box{display:none !important;} .term-ring{display:inline;} .terminal{display:none;}
  #terms-layer .term-ring{display:inline;}
  .wire{fill:none;stroke:var(--wire-off);stroke-width:2.4;stroke-linejoin:round;}
  .wire.hot{filter:none;}
  .wire.hot.ph-L1{stroke:var(--ph-L1);} .wire.hot.ph-L2{stroke:var(--ph-L2);}
  .wire.hot.ph-L3{stroke:var(--ph-L3);} .wire.hot.ph-N{stroke:var(--ph-N);}
  .wire.hot.ph-mix{stroke:var(--wire-mix);} .wire.pending{stroke:var(--accent2);}
  .grid-dot{fill:var(--grid-dot);}
</style></head>
<body>
${cover}
${schematicSheets}
<section class="sheet">
  <h2>Symbol Legend</h2>
  <div id="legend-grid">${legend}</div>
  ${titleBlock(circuit, totalSheets - 2, totalSheets, dateStrCached, 'SYMBOL LEGEND (IEC-style symbols)')}
</section>
<section class="sheet">
  <h2>Components</h2>
  <table><thead><tr><th>ID</th><th>Label</th><th>Type</th><th>Parameters</th><th>State</th></tr></thead>
  <tbody>${rows}</tbody></table>
  ${titleBlock(circuit, totalSheets - 1, totalSheets, dateStrCached, 'COMPONENT LIST')}
</section>
<section class="sheet">
  <h2>Event Log</h2>
  <table><thead><tr><th style="width:70px">Time</th><th>Event</th></tr></thead><tbody>${log}</tbody></table>
  ${titleBlock(circuit, totalSheets, totalSheets, dateStrCached, 'EVENT LOG')}
</section>
</body></html>`;
}
