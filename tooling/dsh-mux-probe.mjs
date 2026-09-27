#!/usr/bin/env node
// Probes the live DSH mux socket, dumps real frames, and replays the extension's
// EXACT parser (src/dsh-streams.ts) plus its `$events` item handler
// (src/dsh-session-feed.ts:59) to find which frame breaks it.
//
// Usage: node dsh-mux-probe.mjs '<launch URL with token>'
// The token is never printed.

import { createHash, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const WebSocket = require(new URL('../node_modules/ws', import.meta.url).pathname);

const raw = process.argv[2];
if (raw === undefined) {
  console.error("usage: node dsh-mux-probe.mjs '<launch url>'");
  process.exit(2);
}

const launch = new URL(raw.trim());
const origin = launch.origin;

// ---- authenticate exactly like the extension ----
const res = await fetch(launch, { method: 'GET', redirect: 'manual', signal: AbortSignal.timeout(10000) });
if (res.status !== 303) {
  console.error(`auth failed: HTTP ${res.status}`);
  process.exit(1);
}
const cookieName = `dsh-auth-${createHash('sha256').update(launch.host).digest('base64url')}`;
const cookie = res.headers.getSetCookie().filter(c => c.startsWith(cookieName + '='))[0]?.split(';', 1)[0];
if (cookie === undefined) {
  console.error('no auth cookie');
  process.exit(1);
}
console.log(`auth ok (location=${JSON.stringify(res.headers.get('location'))})\n`);

// ---- open the mux socket ----
const wsUrl = new URL('/api/remote.mux', origin);
wsUrl.protocol = 'ws:';
const socket = new WebSocket(wsUrl, { headers: { cookie }, followRedirects: false });
const streamId = randomUUID();

const wireRecord = v => typeof v === 'object' && v !== null && !Array.isArray(v);

// ---- replay the extension's `$events` item handler (dsh-session-feed.ts:59) ----
let clientId;
function extensionEventsHandler(frame) {
  if (frame.type === 'ready') {
    if (typeof frame.clientId !== 'string') throw new Error('Invalid event identity.');
    clientId = frame.clientId;
    return 'READY accepted (extension already handles this)';
  }
  // this.remoteEvent(frame) would run here
  return `forwarded to remoteEvent(): <${String(frame.type)}>`;
}

let seen = 0;
socket.on('open', () => {
  console.log(`mux open; subscribing to $events as streamId=${streamId.slice(0, 8)}…\n`);
  socket.send(JSON.stringify({ type: 'open', streamId, endpoint: '$events', payload: { args: {} } }));
});

socket.on('message', data => {
  if (++seen > 12) return;
  const text = data.toString();
  console.log(`--- frame #${seen} ---`);
  console.log('raw:', text.length > 700 ? text.slice(0, 700) + ' …' : text);

  // ===== the extension's exact parser (dsh-streams.ts:61-80) =====
  try {
    const frame = JSON.parse(text);
    if (!wireRecord(frame) || typeof frame.streamId !== 'string') throw new Error('Invalid envelope');
    if (frame.type === 'item') {
      const value = frame.value;
      if (!wireRecord(value)) throw new Error('Invalid DSH baseline.'); // session-feed.ts:224
      console.log('    extension parse: OK (item)');
      console.log('    extension $events handler:', extensionEventsHandler(value));
    } else if (frame.type === 'end' || frame.type === 'error') {
      console.log(`    extension parse: subscription ended (${frame.type})`);
    } else {
      throw new Error('Unknown envelope');
    }
  } catch (e) {
    console.log(`    *** EXTENSION WOULD ABORT: ${e.message}`);
    console.log('    *** -> "DSH sent an invalid event stream frame"');
  }
  console.log();
});

socket.on('error', e => { console.error('socket error:', e.message); process.exit(1); });

setTimeout(() => { console.log(`\n[done] captured ${Math.min(seen, 12)} frames, clientId=${clientId ?? 'none'}`); socket.terminate(); process.exit(0); }, 12000);
