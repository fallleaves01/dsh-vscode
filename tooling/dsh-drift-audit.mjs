#!/usr/bin/env node
// Empirical drift audit: runs the extension's EXACT protocol touchpoints
// against a live DSH runtime and reports which ones no longer match.
//
// Usage: node dsh-drift-audit.mjs '<launch URL with token>'

import { createHash, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const WebSocket = require(new URL('../node_modules/ws', import.meta.url).pathname);

const raw = process.argv[2];
if (raw === undefined) { console.error("usage: node dsh-drift-audit.mjs '<launch url>'"); process.exit(2); }

const launch = new URL(raw.trim());
const res = await fetch(launch, { method: 'GET', redirect: 'manual', signal: AbortSignal.timeout(10000) });
if (res.status !== 303) { console.error(`auth failed: HTTP ${res.status}`); process.exit(1); }
const cookieName = `dsh-auth-${createHash('sha256').update(launch.host).digest('base64url')}`;
const cookie = res.headers.getSetCookie().filter(c => c.startsWith(cookieName + '='))[0]?.split(';', 1)[0];
console.log(`authenticated (Location: ${JSON.stringify(res.headers.get('location'))})\n`);

// ===== HTTP RPC exactly like DshConnection.call =====
async function rpc(endpoint, args) {
  const rpcId = randomUUID();
  const r = await fetch(new URL(`/api/${endpoint}`, launch.origin), {
    method: 'POST', redirect: 'manual',
    headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify({ type: 'client-request', rpcId, method: endpoint, payload: { args } }),
    signal: AbortSignal.timeout(15000),
  });
  const env = await r.json().catch(() => undefined);
  if (!r.ok) return { ok: false, why: `HTTP ${r.status}` };
  if (env?.type !== 'server-response' || env?.result?.ok !== true) {
    return { ok: false, why: `${env?.result?.error?.code ?? '?'}: ${env?.result?.error?.message ?? 'invalid response'}` };
  }
  return { ok: true, value: env.result.value };
}

// ===== get a real sessionId =====
const list = await rpc('session/list', { _request: {} });
if (!list.ok) { console.error('session/list failed:', list.why); process.exit(1); }
const sessions = list.value.items ?? [];
const sessionId = sessions[0]?.id ?? sessions[0]?.sessionId;
console.log(`baseline: session/list OK, ${sessions.length} sessions, sample id=${sessionId}\n`);

const checks = [
  ['session/modelCatalog', {}],
  ['agentPresets/list', {}],
  ['pluginInventory/list', {}],
  ['settings/describe', {}],
  ['commands/list', { agentId: sessionId }],
  ['skills/list', { request: { sessionId } }],
  ['session/page', { request: { address: { kind: 'session', sessionId }, throughSeq: 1e9, beforeSeq: 1e9, maxMessages: 100 } }],
];

console.log('=== HTTP RPC endpoints ===');
for (const [endpoint, args] of checks) {
  const r = await rpc(endpoint, args);
  const shape = r.ok ? Object.keys(r.value ?? {}).slice(0, 5).join(',') : '';
  console.log(`  ${r.ok ? 'OK  ' : 'FAIL'} ${endpoint.padEnd(24)} ${r.ok ? `keys=[${shape}]` : r.why}`);
}

// ===== streams =====
console.log('\n=== mux streams (replaying the extension\'s exact handlers) ===');
const wsUrl = new URL('/api/remote.mux', launch.origin);
wsUrl.protocol = 'ws:';
const socket = new WebSocket(wsUrl, { headers: { cookie }, followRedirects: false });
const wireRecord = v => typeof v === 'object' && v !== null && !Array.isArray(v);
const streams = new Map();
function subscribe(endpoint, args, handler) {
  const id = randomUUID();
  streams.set(id, { endpoint, handler });
  socket.send(JSON.stringify({ type: 'open', streamId: id, endpoint, payload: { args } }));
}
const results = [];

socket.on('open', () => {
  subscribe('$events', {}, f => f.type === 'ready' && typeof f.clientId === 'string' ? 'ready ok' : `remoteEvent(${f.type})`);
  subscribe('session/control', {}, f => {
    if (f.type === 'baseline') {
      const v = wireRecord(f.value) ? f.value : f;
      if (!wireRecord(v) || !wireRecord(v.projections)) return 'baseline still INVALID';
      return `baseline ok — patched reading (queues=${wireRecord(v.queues)}, jobs=${wireRecord(v.jobs)}, projections=${Object.keys(v.projections).length})`;
    }
    if (typeof f.sessionId !== 'string') return 'INVALID control session';
    if (f.type === 'projection' && typeof f.key === 'string' && Number.isSafeInteger(f.seq)) return `projection(${f.key}) ok`;
    return `control(${f.type})`;
  });
  subscribe('workspace/follow', {}, f => {
    if (f.type === 'baseline') {
      const v = wireRecord(f.value) ? f.value : f;
      return Array.isArray(v.archivedSessionIds) ? 'baseline ok' : 'baseline MISSING archivedSessionIds';
    }
    return `workspace(${f.type})`;
  });
  subscribe('session/follow', { request: { address: { kind: 'session', sessionId }, maxMessages: 100, assistantStream: true } }, f => `follow(${f.type})`);
});

socket.on('message', data => {
  let frame; try { frame = JSON.parse(data.toString()); } catch { return; }
  const e = streams.get(frame.streamId);
  if (e === undefined) return;
  let verdict;
  try {
    if (!wireRecord(frame) || typeof frame.streamId !== 'string') throw new Error('Invalid envelope');
    if (frame.type === 'item') verdict = wireRecord(frame.value) ? e.handler(frame.value) : 'item value not a record';
    else if (frame.type === 'end' || frame.type === 'error') verdict = `ended (${frame.type})`;
    else throw new Error('Unknown envelope');
  } catch (err) { verdict = `*** ABORTS: ${err.message}`; }
  const line = `  ${e.endpoint.padEnd(20)} ${verdict}`;
  if (!results.includes(line)) { results.push(line); console.log(line); }
});

socket.on('error', e => console.error('socket error:', e.message));
setTimeout(() => { socket.terminate(); process.exit(0); }, 9000);
