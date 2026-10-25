#!/usr/bin/env node
// mcp/server.mjs — MCP (Model Context Protocol) stdio server for the VoltLab simulator.
//
// Proxies MCP tool calls to the running app's HTTP API (default http://127.0.0.1:8123).
// Dependency-free: speaks newline-delimited JSON-RPC 2.0 over stdin/stdout.
//
// MCP client config:
//   { "mcpServers": { "voltlab": { "command": "node", "args": ["/path/to/voltlab/mcp/server.mjs"] } } }
//
// Start the simulator first:  node server.js   (or: npm start for Electron)

import http from 'node:http';
import readline from 'node:readline';

const BASE = process.env.VOLTLAB_URL || process.env.EKTS_URL || 'http://127.0.0.1:8123';
const SERVER_INFO = { name: 'voltlab', title: 'VoltLab Motor Control Simulator', version: '1.0.0' };

function post(path, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const req = http.request(`${BASE}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) },
      timeout: 15000
    }, res => {
      let buf = '';
      res.on('data', c => buf += c);
      res.on('end', () => {
        try { resolve(JSON.parse(buf)); }
        catch (e) { reject(new Error(`bad response from ${BASE}${path}: ${buf.slice(0, 200)}`)); }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => req.destroy(new Error(`timeout talking to ${BASE}${path}`)));
    req.end(data);
  });
}

function get(path) {
  return new Promise((resolve, reject) => {
    http.get(`${BASE}${path}`, { timeout: 10000 }, res => {
      let buf = '';
      res.on('data', c => buf += c);
      res.on('end', () => { try { resolve(JSON.parse(buf)); } catch (e) { reject(e); } });
    }).on('error', reject);
  });
}

function write(msg) {
  process.stdout.write(JSON.stringify(msg) + '\n');
}

function rpcResult(id, result) { write({ jsonrpc: '2.0', id, result }); }
function rpcError(id, code, message) { write({ jsonrpc: '2.0', id, error: { code, message } }); }

function textContent(payload) {
  return { content: [{ type: 'text', text: typeof payload === 'string' ? payload : JSON.stringify(payload, null, 2) }] };
}

async function handleToolsCall(id, params) {
  const name = params?.name;
  const args = params?.arguments || {};
  try {
    const result = await post('/api/command', { tool: name, args });
    if (result.ok === false) {
      rpcResult(id, {
        ...textContent(`Tool "${name}" failed: ${result.error}`),
        isError: true
      });
    } else {
      rpcResult(id, textContent(result));
    }
  } catch (err) {
    rpcResult(id, {
      ...textContent(`Cannot reach the VoltLab app at ${BASE} — start it first with "node server.js" (browser mode) or "npm start" (Electron). Underlying error: ${err.message}`),
      isError: true
    });
  }
}

async function handleMessage(msg) {
  const { id, method, params } = msg || {};
  const isNotification = id === undefined || id === null;

  switch (method) {
    case 'initialize':
      rpcResult(id, {
        protocolVersion: params?.protocolVersion || '2024-11-05',
        capabilities: { tools: { listChanged: false } },
        serverInfo: SERVER_INFO
      });
      return;

    case 'notifications/initialized':
    case 'notifications/cancelled':
      return; // notifications get no reply

    case 'ping':
      rpcResult(id, {});
      return;

    case 'tools/list': {
      try {
        const { tools } = await get('/api/tools');
        rpcResult(id, { tools });
      } catch (err) {
        rpcError(id, -32603, `cannot reach VoltLab app at ${BASE}: ${err.message}`);
      }
      return;
    }

    case 'tools/call':
      await handleToolsCall(id, params);
      return;

    case 'resources/list':
      rpcResult(id, { resources: [] });
      return;

    case 'prompts/list':
      rpcResult(id, { prompts: [] });
      return;

    default:
      if (!isNotification) rpcError(id, -32601, `method not found: ${method}`);
  }
}

const rl = readline.createInterface({ input: process.stdin, terminal: false });
rl.on('line', line => {
  const trimmed = line.trim();
  if (!trimmed) return;
  let msg;
  try { msg = JSON.parse(trimmed); }
  catch { return; } // ignore malformed lines
  handleMessage(msg).catch(err => {
    if (msg?.id !== undefined && msg?.id !== null) {
      rpcError(msg.id, -32603, String(err.message || err));
    }
  });
});

process.on('disconnect', () => process.exit(0));
