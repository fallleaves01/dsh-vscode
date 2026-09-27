#!/usr/bin/env node
// Enumerate which DSH Remote endpoints actually exist on a live runtime, by
// probing each with empty args and classifying the error code:
//   not-found  -> endpoint does not exist
//   invalid    -> endpoint EXISTS (our args were wrong)
// Usage: node dsh-endpoint-inventory.mjs '<launch URL with token>'

import { createHash, randomUUID } from 'node:crypto';

const raw = process.argv[2];
if (raw === undefined) { console.error("usage: node dsh-endpoint-inventory.mjs '<launch url>'"); process.exit(2); }
const launch = new URL(raw.trim());

const res = await fetch(launch, { method: 'GET', redirect: 'manual', signal: AbortSignal.timeout(10000) });
if (res.status !== 303) { console.error(`auth failed: HTTP ${res.status}`); process.exit(1); }
const cookieName = `dsh-auth-${createHash('sha256').update(launch.host).digest('base64url')}`;
const cookie = res.headers.getSetCookie().filter(c => c.startsWith(cookieName + '='))[0]?.split(';', 1)[0];
console.log('authenticated\n');

async function rpc(endpoint, args = {}) {
  const rpcId = randomUUID();
  const r = await fetch(new URL(`/api/${endpoint}`, launch.origin), {
    method: 'POST', redirect: 'manual',
    headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify({ type: 'client-request', rpcId, method: endpoint, payload: { args } }),
    signal: AbortSignal.timeout(8000),
  });
  const env = await r.json().catch(() => undefined);
  return { status: r.status, result: env?.result };
}

// Candidate surface: every name the typert manifests declare, tried under every
// plausible namespace, plus the endpoints the sidebar already uses.
const session = ['attachment','cancel','canOpenWorkspacePath','control','create','follow','fork','inspect','list','modelCatalog','openWorkspacePath','page','projections','prompt','rename','resolveAgent','search','selectModel','updateQueue','workspaceDesktop','workspacePathApplications'];
const job = ['follow','kill','list'];
const terminal = ['close','create','environment','follow','list','rename','resize','retain','shells','write'];
const workspaceFiles = ['changes','list','read','readBytes','stat'];
const workspace = ['archiveSession','follow','archive','list'];
const directoryPicker = ['archiveSession','create','createDirectory','delete','follow','initializeDefault','insertBefore','insertSessionBefore','list','pick','pinSession','rename','unarchiveSession','unpinSession'];
const credentials = ['describe','mutate','openSettingsDocument','replace','set','unset','update'];
const settings = ['describe','mutate'];
const commands = ['list','execute'];
const misc = ['skills/list','agentPresets/list','agentPresets/select','pluginInventory/list','fileReferences/list','fileReferences/list','$events/result'];

const candidates = [
  ...session.map(m => `session/${m}`),
  ...job.map(m => `job/${m}`),
  ...terminal.map(m => `terminal/${m}`),
  ...workspaceFiles.map(m => `workspace/${m}`),
  ...workspace.map(m => `workspace/${m}`),
  ...directoryPicker.map(m => `directoryPicker/${m}`),
  ...credentials.map(m => `credentials/${m}`),
  ...settings.map(m => `settings/${m}`),
  ...commands.map(m => `commands/${m}`),
  ...misc,
];
const unique = [...new Set(candidates)];

const byCode = new Map();
for (const endpoint of unique) {
  const { result } = await rpc(endpoint);
  const code = result?.ok === true ? 'OK' : (result?.error?.code ?? 'no-code');
  const list = byCode.get(code) ?? [];
  list.push(endpoint);
  byCode.set(code, list);
}

console.log(`探测了 ${unique.length} 个候选接口，按返回码分组:\n`);
for (const [code, endpoints] of [...byCode].sort((a, b) => b[1].length - a[1].length)) {
  console.log(`### ${code}  (${endpoints.length})`);
  for (const ep of endpoints.sort()) console.log(`    ${ep}`);
  console.log();
}
