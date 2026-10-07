// app/js/render.js — builds the SVG scene from an engine snapshot.
// Layers are diff-cached: innerHTML is only rewritten when content actually changes,
// so a running sim doesn't churn the DOM out from under clicks.
import { DEVICE_TYPES } from '/sim/devices.js';
import { SYMBOLS } from './symbols.js';

const SVGNS = 'http://www.w3.org/2000/svg';
const layerCache = new Map();

export function invalidateRenderCache() { layerCache.clear(); }

function setLayer(svg, id, html) {
  if (layerCache.get(id) === html) return;
  const el = svg.querySelector('#' + id);
  if (!el) return;
  el.innerHTML = html;
  layerCache.set(id, html);
}

export function termPos(comp, term) {
  const t = DEVICE_TYPES[comp.type].terminals[term];
  return { x: comp.x + t.x, y: comp.y + t.y };
}

export function parseRef(ref) {
  const dot = ref.lastIndexOf('.');
  return { comp: ref.slice(0, dot), term: ref.slice(dot + 1) };
}

function wirePhaseClass(w) {
  const netPhases = w._netPhases || [];
  if (!netPhases.length) return { cls: '', hot: false };
  const ph = netPhases.length === 1 && ['L1', 'L2', 'L3', 'N'].includes(netPhases[0])
    ? netPhases[0] : 'mix';
  return { cls: ` ph-${ph}`, hot: true };
}

function wirePath(w, compMap) {
  const a = parseRef(w.from), b = parseRef(w.to);
  const ca = compMap.get(a.comp), cb = compMap.get(b.comp);
  if (!ca || !cb) return null;
  const p1 = termPos(ca, a.term), p2 = termPos(cb, b.term);
  const pts = [p1];
  if (Array.isArray(w.waypoints) && w.waypoints.length) {
    pts.push(...w.waypoints.map(([x, y]) => ({ x, y })));
  } else if (p1.x !== p2.x && p1.y !== p2.y) {
    const midY = Math.round((p1.y + p2.y) / 2); // default orthogonal elbow
    pts.push({ x: p1.x, y: midY }, { x: p2.x, y: midY });
  }
  pts.push(p2);
  return 'M ' + pts.map(p => `${p.x} ${p.y}`).join(' L ');
}

export function renderScene(svg, snapshot, ui, rotorAngles) {
  const byId = new Map(snapshot.components.map(c => [c.id, c]));
  const netById = new Map((snapshot.nets || []).map(n => [n.id, n]));

  // adaptive canvas: grow to fit the circuit
  let maxX = 1280, maxY = 900;
  for (const c of snapshot.components) {
    const size = DEVICE_TYPES[c.type].size;
    maxX = Math.max(maxX, c.x + size.w + 100);
    maxY = Math.max(maxY, c.y + size.h + 100);
  }
  svg.setAttribute('width', maxX);
  svg.setAttribute('height', maxY);
  svg.setAttribute('viewBox', `0 0 ${maxX} ${maxY}`);
  svg.setAttribute('data-w', maxX);
  svg.setAttribute('data-h', maxY);
  const zoom = ui.zoom || 1;
  const wrap = document.getElementById('canvas-scale');
  if (wrap) {
    wrap.style.width = `${maxX * zoom}px`;
    wrap.style.height = `${maxY * zoom}px`;
    svg.style.transformOrigin = '0 0';
    svg.style.transform = `scale(${zoom})`;
  }

  // ---- wires ----
  let wsvg = '';
  for (const w of snapshot.wires) {
    const d = wirePath(w, byId);
    if (!d) continue;
    const na = netById.get(w.netA);
    w._netPhases = na ? na.phases : [];
    const { cls, hot } = wirePhaseClass(w);
    wsvg += `<path class="wire${hot ? ' hot' : ' cold'}${cls}" d="${d}" ${hot ? 'filter="url(#glow)"' : ''}/>`;
  }
  setLayer(svg, 'wires-layer', wsvg);

  // ---- junction dots: terminals with >= 3 wires ----
  const wireCount = new Map();
  for (const w of snapshot.wires) {
    wireCount.set(w.from, (wireCount.get(w.from) || 0) + 1);
    wireCount.set(w.to, (wireCount.get(w.to) || 0) + 1);
  }
  let dsvg = '';
  for (const [ref, count] of wireCount) {
    if (count < 3) continue;
    const { comp: cid, term } = parseRef(ref);
    const c = byId.get(cid);
    if (!c) continue;
    const p = termPos(c, term);
    const hot = (netById.get(snapshot.terminals?.[ref]) || {}).phases?.length > 0;
    dsvg += `<circle cx="${p.x}" cy="${p.y}" r="4.2" style="fill: ${hot ? 'var(--accent)' : 'var(--sym-idle)'}"/>`;
  }
  setLayer(svg, 'dots-layer', dsvg);

  // ---- components (rotor angle intentionally excluded — updated imperatively below) ----
  let csvg = '';
  for (const c of snapshot.components) {
    const draw = SYMBOLS[c.type];
    if (!draw) continue;
    const selected = ui.selected === c.id;
    // symbols draw in absolute canvas coordinates (comp.x/y baked into the symbol fns)
    csvg += `<g class="sym${selected ? ' selected' : ''}" data-comp="${c.id}">`;
    csvg += `<g class="sym-inner" data-comp-inner="${c.id}">${draw(c, c.state, { rotorAngle: 0 })}</g>`;
    csvg += `<rect class="sel-box" x="${c.x - 12}" y="${c.y - 12}" width="${DEVICE_TYPES[c.type].size.w + 24}" height="${DEVICE_TYPES[c.type].size.h + 24}" rx="6"/>`;
    csvg += '</g>';
  }
  setLayer(svg, 'comps-layer', csvg);

  // imperative rotor rotation (cheap, per-frame, no layer rebuild)
  for (const c of snapshot.components) {
    if (c.type !== 'motor3') continue;
    const el = svg.querySelector(`[data-rotor="${c.id}"]`);
    if (el) el.setAttribute('transform', `rotate(${rotorAngles.get(c.id) || 0} ${c.x + 50} ${c.y + 85})`);
  }

  // ---- terminals (hit areas + visible pads), on top; stable while circuit is static ----
  let tsvg = '';
  for (const c of snapshot.components) {
    const terms = DEVICE_TYPES[c.type].terminals;
    for (const [name, pos] of Object.entries(terms)) {
      const px = c.x + pos.x, py = c.y + pos.y;
      const ref = `${c.id}.${name}`;
      const net = netById.get(snapshot.terminals?.[ref]);
      const hot = net && net.phases.length > 0;
      tsvg += `<circle class="term-ring" cx="${px}" cy="${py}" r="3.4" style="fill: ${hot ? 'var(--accent)' : 'var(--sym-idle)'}"/>`;
      tsvg += `<circle class="terminal" data-term="${ref}" cx="${px}" cy="${py}" r="9" fill="transparent" stroke="none"/>`;
    }
  }
  let tlayer = svg.querySelector('#terms-layer');
  if (!tlayer) {
    tlayer = document.createElementNS(SVGNS, 'g');
    tlayer.id = 'terms-layer';
    svg.appendChild(tlayer);
  }
  if (layerCache.get('terms') !== tsvg) {
    tlayer.innerHTML = tsvg;
    layerCache.set('terms', tsvg);
  }

  // ---- ghost (placing) / pending wire preview / pending terminal ring ----
  let gsvg = '';
  if (ui.pendingTerm) {
    const { comp: cid, term } = parseRef(ui.pendingTerm);
    const c = byId.get(cid);
    if (c) {
      const p = termPos(c, term);
      gsvg += `<circle cx="${p.x}" cy="${p.y}" r="7" fill="none" style="stroke: var(--accent2)" stroke-width="2"/>`;
      const q = ui.cursor;
      const midY = Math.round((p.y + q.y) / 2);
      gsvg += `<path class="wire pending" d="M ${p.x} ${p.y} L ${p.x} ${midY} L ${q.x} ${midY} L ${q.x} ${q.y}"/>`;
    }
  }
  if (ui.placing) {
    gsvg += `<text x="${ui.cursor.x + 14}" y="${ui.cursor.y - 10}" font-size="11" fill="#4fc3f7">click to place ${ui.placing}</text>`;
  }
  setLayer(svg, 'ghost-layer', gsvg);
}
