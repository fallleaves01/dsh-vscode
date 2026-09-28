#!/usr/bin/env node
// One-off probe: does the live profile expose fileUploads/upload, and does the
// session/prompt wire schema accept a {type:'file'} content part?
//
// Both checks are deliberately non-spending: the prompt probe cites a receipt
// that does not exist, so a domain error proves the schema accepted the part
// while a descriptor error would prove it did not.
//
// Usage: node tooling/probe-file-upload.mjs '<launch url with token>'

import { createHash } from 'node:crypto';

const raw = process.argv[2];
if (raw === undefined) { console.error("usage: node probe-file-upload.mjs '<launch url>'"); process.exit(2); }

const launch = new URL(raw.trim());
const res = await fetch(launch, { method: 'GET', redirect: 'manual', signal: AbortSignal.timeout(10000) });
if (res.status !== 303) { console.error(`auth failed: HTTP ${res.status}`); process.exit(1); }
const cookieName = `dsh-auth-${createHash('sha256').update(launch.host).digest('base64url')}`;
const cookie = res.headers.getSetCookie().filter(c => c.startsWith(cookieName + '='))[0]?.split(';', 1)[0];

async function rpc(endpoint, args) {
  const rpcId = crypto.randomUUID();
  const r = await fetch(new URL(`/api/${endpoint}`, launch.origin), {
    method: 'POST', redirect: 'manual',
    headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify({ type: 'client-request', rpcId, method: endpoint, payload: { args } }),
    signal: AbortSignal.timeout(20000),
  });
  const env = await r.json().catch(() => undefined);
  if (!r.ok) return { ok: false, why: `HTTP ${r.status}` };
  if (env?.type !== 'server-response' || env?.result?.ok !== true) {
    const error = env?.result?.error;
    return { ok: false, why: `${error?.code ?? '?'}: ${error?.message ?? 'invalid response'}`, raw: error };
  }
  return { ok: true, value: env.result.value };
}

const list = await rpc('session/list', { _request: {} });
if (!list.ok) { console.error('session/list failed:', list.why); process.exit(1); }
const sessions = list.value.items ?? [];
let sessionId = sessions[0]?.sessionId ?? sessions[0]?.id;
console.log(`session/list OK — ${sessions.length} sessions, sample=${sessionId}`);
if (sessionId === undefined) {
  const created = await rpc('session/create', { request: { cwd: process.cwd() } });
  if (!created.ok) { console.error('session/create failed:', created.why); process.exit(1); }
  sessionId = created.value.sessionId;
  console.log(`session/create OK — scratch session ${sessionId}`);
}
console.log();

// 1. Does the upload remote exist and mint a receipt?
const payload = Buffer.from('dsh-vscode drop probe\n', 'utf8').toString('base64');
const upload = await rpc('fileUploads/upload', { agentId: sessionId, request: { data: payload, name: 'probe.txt' } });
console.log('fileUploads/upload ->', upload.ok ? JSON.stringify(upload.value) : upload.why);

// 2. Does session/prompt accept a file content part? A bogus receipt must fail
//    as a domain error, never as "args fields do not match the descriptor".
if (sessionId !== undefined) {
  const prompt = await rpc('session/prompt', {
    request: {
      requestId: crypto.randomUUID(),
      sessionId,
      mode: 'queue',
      content: [{ type: 'file', receiptId: 'probe-receipt-that-does-not-exist' }],
    },
  });
  console.log('session/prompt {type:file,bogus receipt} ->', prompt.ok ? 'ACCEPTED (unexpected)' : prompt.why);
}

// 3. Control: a genuinely malformed part must produce the descriptor error, so
//    the difference in (2) is meaningful rather than a generic failure.
if (sessionId !== undefined) {
  const control = await rpc('session/prompt', {
    request: {
      requestId: crypto.randomUUID(),
      sessionId,
      mode: 'queue',
      content: [{ type: 'file', attachmentId: 'nope' }],
    },
  });
  console.log('session/prompt {type:file,attachmentId} ->', control.ok ? 'ACCEPTED (unexpected)' : control.why);
}
