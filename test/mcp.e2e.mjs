// test/mcp.e2e.mjs — end-to-end test of the MCP layer.
// Spawns the HTTP host on a test port, spawns mcp/server.mjs as a real MCP client would,
// and drives the complete DOL starter scenario through JSON-RPC over stdio.

import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const PORT = 8199;
const URL_ = `http://127.0.0.1:${PORT}`;

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// ---------- MCP stdio client ----------
class McpClient {
  constructor(proc) {
    this.proc = proc;
    this.buf = '';
    this.nextId = 1;
    this.pending = new Map();
    proc.stdout.setEncoding('utf8');
    proc.stdout.on('data', d => {
      this.buf += d;
      let idx;
      while ((idx = this.buf.indexOf('\n')) >= 0) {
        const line = this.buf.slice(0, idx).trim();
        this.buf = this.buf.slice(idx + 1);
        if (!line) continue;
        try {
          const msg = JSON.parse(line);
          if (msg.id && this.pending.has(msg.id)) {
            this.pending.get(msg.id)(msg);
            this.pending.delete(msg.id);
          }
        } catch { /* ignore */ }
      }
    });
  }
  request(method, params, timeoutMs = 20000) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error(`timeout waiting for ${method}`)), timeoutMs);
      this.pending.set(id, (msg) => {
        clearTimeout(t);
        resolve(msg);
      });
      this.proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
    });
  }
  notify(method, params) {
    this.proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', method, params }) + '\n');
  }
  async callTool(name, args = {}) {
    const res = await this.request('tools/call', { name, arguments: args });
    assert.equal(res.error, undefined, `tools/call ${name} rpc error: ${JSON.stringify(res.error)}`);
    const text = res.result.content[0].text;
    if (res.result.isError) throw new Error(`tool ${name} failed: ${text}`);
    return JSON.parse(text);
  }
}

async function stateOf(client) {
  const r = await client.callTool('get_state', {});
  const s = r.state;
  const byId = Object.fromEntries(s.components.map(c => [c.id, c]));
  return { s, byId };
}

// ---------- main ----------
const server = spawn('node', [path.join(ROOT, 'server.js')], {
  env: { ...process.env, VOLTLAB_PORT: String(PORT), VOLTLAB_AUTOLOAD: 'none' },
  stdio: 'ignore'
});
await sleep(1200);

const mcp = spawn('node', [path.join(ROOT, 'mcp', 'server.mjs')], {
  env: { ...process.env, VOLTLAB_URL: URL_ },
  stdio: ['pipe', 'pipe', 'pipe']
});
mcp.stderr.on('data', d => console.error('[mcp stderr]', String(d)));

const client = new McpClient(mcp);
let passed = 0;
const check = (cond, msg) => { assert.ok(cond, msg); passed++; console.log(`  ✓ ${msg}`); };

try {
  // ---- MCP handshake ----
  const init = await client.request('initialize', {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: 'voltlab-e2e-test', version: '1.0.0' }
  });
  check(init.result.serverInfo.name === 'voltlab', `initialize → serverInfo "${init.result.serverInfo.name}"`);
  check(!!init.result.capabilities.tools, 'initialize → tools capability present');
  client.notify('notifications/initialized', {});

  const list = await client.request('tools/list', {});
  const names = list.result.tools.map(t => t.name);
  check(names.length >= 20, `tools/list → ${names.length} tools`);
  check(names.includes('press_button') && names.includes('inject_fault') && names.includes('screenshot'), 'tool catalog complete');
  const schemaOk = list.result.tools.every(t => t.inputSchema && typeof t.inputSchema === 'object' && t.description);
  check(schemaOk, 'every tool has description + inputSchema');

  // ---- error handling ----
  const bad = await client.callTool('press_button', { id: 'NOPE' }).catch(e => ({ _failed: e.message }));
  check(bad.ok === false || bad._failed, 'bad tool call surfaces a clean error');

  // ---- DOL scenario via MCP ----
  const loaded = await client.callTool('load_circuit', { name: 'dol-starter' });
  check(loaded.components === 13 && loaded.wires === 31, `load_circuit dol-starter (13 comps, 31 wires)`);
  await client.callTool('sim_control', { action: 'pause' });
  await client.callTool('sim_control', { action: 'advance', seconds: 0.2 });

  let { byId } = await stateOf(client);
  check(byId.H1.state.lit === true, 'H1 power lamp lit');
  check(byId.KM1.state.energized === false, 'KM1 starts de-energized');

  // breaker toggle
  await client.callTool('set_switch', { id: 'Q1', closed: false });
  ({ byId } = await stateOf(client));
  check(byId.H1.state.lit === false, 'H1 dark with Q1 open');
  await client.callTool('set_switch', { id: 'Q1', closed: true });

  // start + seal-in
  await client.callTool('press_button', { id: 'S1' });
  await client.callTool('sim_control', { action: 'advance', seconds: 0.5 });
  await client.callTool('release_button', { id: 'S1' });
  await client.callTool('sim_control', { action: 'advance', seconds: 2 });
  ({ byId } = await stateOf(client));
  check(byId.KM1.state.energized === true, 'seal-in holds KM1 after START released');
  check(byId.M1.state.speed > 0.7, `motor spun up (speed ${byId.M1.state.speed.toFixed(2)})`);
  check(byId.H2.state.lit === true, 'run lamp H2 lit');
  check(byId.M1.state.current <= byId.M1.params.flc * 1.1, `current ≈ FLC (${byId.M1.state.current.toFixed(1)} A)`);

  // live log over MCP
  const log = await client.callTool('get_log', { limit: 10 });
  check(log.log.some(v => v.msg.includes('ENERGIZED')), 'event log reachable over MCP');

  // stop
  await client.callTool('press_button', { id: 'S0' });
  await client.callTool('sim_control', { action: 'advance', seconds: 0.3 });
  await client.callTool('release_button', { id: 'S0' });
  await client.callTool('sim_control', { action: 'advance', seconds: 6 });
  ({ byId } = await stateOf(client));
  check(byId.KM1.state.energized === false, 'STOP drops KM1');
  check(byId.M1.state.speed < 0.06, `motor coasted (speed ${byId.M1.state.speed.toFixed(3)})`);

  // stall -> overload trip
  await client.callTool('inject_fault', { type: 'stall', target: 'M1' });
  await client.callTool('press_button', { id: 'S1' });
  await client.callTool('sim_control', { action: 'advance', seconds: 0.3 });
  await client.callTool('release_button', { id: 'S1' });
  await client.callTool('sim_control', { action: 'advance', seconds: 30 });
  ({ byId } = await stateOf(client));
  check(byId.KK1.state.tripped === true, 'overload KK1 tripped on stall');
  check(byId.KM1.state.energized === false, 'trip dropped the contactor');
  check(byId.H3.state.lit === true, 'trip lamp H3 lit');

  // recovery
  await client.callTool('clear_fault', { type: 'stall' });
  await client.callTool('reset_overload', { id: 'KK1' });
  ({ byId } = await stateOf(client));
  check(byId.KK1.state.tripped === false && byId.H3.state.lit === false, 'reset restores readiness');

  // circuit editing over MCP
  const added = await client.callTool('add_component', { type: 'lamp', label: 'H9 test', x: 1200, y: 1200 });
  check(!!added.id, `add_component → ${added.id}`);
  await client.callTool('connect', { from: 'H1.1', to: `${added.id}.1` });
  await client.callTool('connect', { from: 'N1.T', to: `${added.id}.2` });
  await client.callTool('sim_control', { action: 'advance', seconds: 0.2 });
  ({ byId } = await stateOf(client));
  check(byId[added.id].state.lit === true, 'agent-added lamp wired to L1/N lights up');
  await client.callTool('remove_component', { id: added.id });

  // screenshot tool: clean, explicit error in HTTP mode (arrives as isError:true)
  const shot = await client.callTool('screenshot', {}).catch(e => ({ _err: String(e.message) }));
  const shotText = shot._err || (shot.ok === false ? shot.error : '');
  check(/Electron/.test(shotText), 'screenshot tool returns helpful error in HTTP mode');

  console.log(`\nMCP E2E PASSED — ${passed} checks, full DOL scenario driven over stdio JSON-RPC`);
} finally {
  mcp.kill();
  server.kill();
}
