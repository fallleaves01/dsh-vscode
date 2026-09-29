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
// Pick a Session the generic API can route. A subagent child is owned by
// subagent routing and refuses these calls by design (`session/agent-busy`), so
// probing the first row of a busy list reported that design as drift.
const routable = sessions.filter(session => session.origin !== 'subagent' && session.parentSessionId === undefined);
const sample = routable.find(session => session.running !== true) ?? routable[0];
const sessionId = sample?.sessionId ?? sample?.id;
console.log(`baseline: session/list OK, ${sessions.length} sessions (${routable.length} routable), sample id=${sessionId}\n`);

// The third field marks a check that needs a session: an isolated home has none,
// which is the documented way to run this, and those checks then report a missing
// argument rather than drift.
const checks = [
  ['session/modelCatalog', {}, false],
  ['agentPresets/list', {}, false],
  ['pluginInventory/list', {}, false],
  ['settings/describe', {}, false],
  ['commands/list', { agentId: sessionId }, true],
  ['skills/list', { request: { sessionId } }, true],
];

// `session/page` is checked from the follow snapshot below: 0.2.0 rejects a
// `throughSeq` past the session cursor (`gateway/bad-request`), and the cursor is
// exactly what the extension passes there.

console.log('=== HTTP RPC endpoints ===');
for (const [endpoint, args, needsSession] of checks) {
  if (needsSession && sessionId === undefined) {
    console.log(`  SKIP ${endpoint.padEnd(24)} needs a session, and this runtime has none`);
    continue;
  }
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
  if (sessionId === undefined) console.log(`  ${'session/follow'.padEnd(20)} skipped — this runtime has no session yet`);
  else subscribe('session/follow', { request: { address: { kind: 'session', sessionId }, maxMessages: 100, assistantStream: true } }, f => {
    if (f.type === 'snapshot' && Number.isSafeInteger(f.cursor)) void checkPage(f.cursor);
    return `follow(${f.type})`;
  });
});

// Mirrors DshSessionFeed.page(): the snapshot cursor is the `throughSeq`, and
// `beforeSeq` walks backwards from the oldest message already held.
let pageChecked = false;
async function checkPage(cursor) {
  if (pageChecked) return;
  pageChecked = true;
  // A fresh runtime has no session to page, which is the documented way to run
  // this probe; say so instead of reporting the missing id as drift.
  if (sessionId === undefined) {
    console.log(`  ${'session/page'.padEnd(20)} skipped — this runtime has no session yet`);
    return;
  }
  const r = await rpc('session/page', { request: { address: { kind: 'session', sessionId }, throughSeq: cursor, beforeSeq: cursor, maxMessages: 100 } });
  console.log(`  ${'session/page'.padEnd(20)} ${r.ok ? `ok — throughSeq=cursor(${cursor}), records=${Array.isArray(r.value?.records) ? r.value.records.length : '?'}` : `FAIL ${r.why}`}`);
}

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
