#!/usr/bin/env node
// Probes all three baseline streams the extension opens and replays the
// extension's EXACT item handlers (src/dsh-session-feed.ts:59-79) to find
// which one throws -> "DSH sent an invalid event stream frame".
//
// Usage: node dsh-mux-probe2.mjs '<launch URL with token>'

import { createHash, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const WebSocket = require(new URL('../node_modules/ws', import.meta.url).pathname);

const raw = process.argv[2];
if (raw === undefined) { console.error("usage: node dsh-mux-probe2.mjs '<launch url>'"); process.exit(2); }

const launch = new URL(raw.trim());
const res = await fetch(launch, { method: 'GET', redirect: 'manual', signal: AbortSignal.timeout(10000) });
if (res.status !== 303) { console.error(`auth failed: HTTP ${res.status}`); process.exit(1); }
const cookieName = `dsh-auth-${createHash('sha256').update(launch.host).digest('base64url')}`;
const cookie = res.headers.getSetCookie().filter(c => c.startsWith(cookieName + '='))[0]?.split(';', 1)[0];
console.log('auth ok\n');

const wsUrl = new URL('/api/remote.mux', launch.origin);
wsUrl.protocol = 'ws:';
const socket = new WebSocket(wsUrl, { headers: { cookie }, followRedirects: false });

const wireRecord = v => typeof v === 'object' && v !== null && !Array.isArray(v);

// streamId -> { endpoint, handler }
const streams = new Map();
function subscribe(endpoint, handler) {
  const id = randomUUID();
  streams.set(id, { endpoint, handler });
  socket.send(JSON.stringify({ type: 'open', streamId: id, endpoint, payload: { args: {} } }));
  return id;
}

// ===== exact replicas of the extension's handlers =====
function handleEvents(frame) {
  if (frame.type === 'ready') {
    if (typeof frame.clientId !== 'string') throw new Error('Invalid event identity.');
    return 'ready ok';
  }
  return `remoteEvent(${String(frame.type)})`;
}
function handleControl(frame) {
  if (frame.type === 'baseline') {
    const value = frame.value;
    if (!wireRecord(value) || !wireRecord(value.queues) || !wireRecord(value.jobs) || !wireRecord(value.projections)) {
      throw new Error('Invalid control baseline.');
    }
    return 'baseline ok';
  }
  const id = frame.sessionId;
  if (typeof id !== 'string') throw new Error('Invalid control session.');
  return `control(${String(frame.type)})`;
}
function handleWorkspace(frame) {
  const value = frame.type === 'baseline' ? frame.value : frame;
  if ((frame.type === 'baseline' || frame.type === 'archived') && wireRecord(value)) {
    if (!Array.isArray(value.archivedSessionIds) || !value.archivedSessionIds.every(id => typeof id === 'string')) {
      throw new Error('Invalid workspace baseline.');
    }
    return 'baseline ok';
  }
  return `workspace(${String(frame.type)})`;
}

let seen = 0;
socket.on('open', () => {
  console.log('mux open; subscribing to all three baseline streams…\n');
  subscribe('$events', handleEvents);
  subscribe('session/control', handleControl);
  subscribe('workspace/follow', handleWorkspace);
});

socket.on('message', data => {
  const text = data.toString();
  let frame;
  try { frame = JSON.parse(text); } catch { console.log('non-JSON frame!'); return; }
  const entry = streams.get(frame.streamId);
  const label = entry?.endpoint ?? '?';
  if (++seen > 20) return;

  const shown = text.length > 500 ? text.slice(0, 500) + ' …' : text;
  try {
    if (!wireRecord(frame) || typeof frame.streamId !== 'string') throw new Error('Invalid envelope');
    if (frame.type === 'item') {
      if (!wireRecord(frame.value)) throw new Error('Invalid DSH baseline.');
      const verdict = entry.handler(frame.value);
      console.log(`[${label}] parse OK — ${verdict}`);
    } else if (frame.type === 'end' || frame.type === 'error') {
      console.log(`[${label}] subscription ended (${frame.type})`);
    } else {
      throw new Error('Unknown envelope');
    }
  } catch (e) {
    console.log(`[${label}] *** EXTENSION ABORTS: ${e.message}`);
    console.log(`           raw: ${shown}`);
    console.log('           -> "DSH sent an invalid event stream frame"');
  }
});

socket.on('error', e => { console.error('socket error:', e.message); process.exit(1); });
setTimeout(() => { console.log('\n[done]'); socket.terminate(); process.exit(0); }, 10000);
