#!/usr/bin/env node
// Live compatibility check: drives the extension's REAL client code
// (src/dsh-connection.ts + src/dsh-client.ts) against a running DSH runtime and
// reports every protocol touchpoint it can reach.
//
// The static contract diff (`tooling/dsh-contract-diff.mjs`) proves the wire
// schemas still match; this proves our own parsing of the responses still works.
//
// Usage: node tooling/dsh-live-compat.mjs '<launch url with token>'

import { build } from 'esbuild';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const raw = process.argv[2];
if (raw === undefined) { console.error("usage: node dsh-live-compat.mjs '<launch url>'"); process.exit(2); }

const root = new URL('../', import.meta.url);
const entry = `
export { DshConnection } from './src/dsh-connection.ts'
export { DshClient } from './src/dsh-client.ts'
export { accountStateOf, accountClientMetadata } from './src/account.ts'
`;
// Bundle only our own source; `ws` and friends resolve from the repo at runtime.
// A real file (not a data URL) keeps stack traces usable.
const { outputFiles } = await build({
  stdin: { contents: entry, resolveDir: fileURLToPath(root), sourcefile: 'live-compat-entry.ts', loader: 'ts' },
  bundle: true, platform: 'node', format: 'esm', write: false, logLevel: 'silent',
  packages: 'external',
});
// The bundle must live inside the repo so bare imports (`ws`) resolve, and under
// node_modules so an interrupted run cannot leave an untracked file behind.
const dir = fileURLToPath(new URL('../node_modules/.cache/dsh-live-compat/', import.meta.url));
await mkdir(dir, { recursive: true });
const file = join(dir, 'entry.mjs');
await writeFile(file, outputFiles[0].text, 'utf8');
const mod = await import(pathToFileURL(file).href);
const { DshConnection, DshClient, accountStateOf, accountClientMetadata } = mod;

const launch = new URL(raw.trim());
const results = [];
const record = async (name, fn) => {
  try {
    const value = await fn();
    results.push({ name, ok: true, note: value === undefined ? '' : String(value).slice(0, 70) });
    return value;
  } catch (error) {
    results.push({ name, ok: false, note: `${error?.code ?? ''} ${error?.message ?? String(error)}`.trim().slice(0, 110) });
    return undefined;
  }
};

const connection = new DshConnection(new URL(launch.origin));
await record('authenticate (launch token -> cookie)', async () => { await connection.authenticate(launch); return 'ok'; });

const frames = [];
const client = new DshClient(connection, []);
client.onFrame(frame => { frames.push(frame); });

let sessionId;
await record('feed.start()  [$events baseline]', async () => { await client.feed.start(); return 'ok'; });
await record('session/list', async () => { const r = await client.listSessions(); return `${r.items.length} session(s)`; });
await record('workspace/follow (archived ids)', async () => { const r = await client.listWorkspaces(); return `${r.archivedSessionIds.length} archived`; });
await record('session/create', async () => {
  const created = await client.createSession(process.cwd());
  sessionId = created.sessionId;
  return sessionId;
});

if (sessionId !== undefined) {
  await record('session/follow + projections (openSession)', async () => {
    const opening = await client.openSession(sessionId);
    const keys = Object.keys(opening.projections ?? {});
    return `${opening.events.length} events, projections=[${keys.slice(0, 6).join(',')}]`;
  });
  await record('session/page (history paging)', async () => { const r = await client.history(sessionId, 1e9); return `${r.events.length} entries`; });
  await record('session/modelCatalog + modelSelection projection', async () => {
    const models = await client.models(sessionId);
    return `${models.groups.length} group(s), routable=${String(models.routable)}`;
  });
  await record('session/selectModel', async () => {
    const models = await client.models(sessionId);
    const r = await client.selectModel(sessionId, models.current);
    return `${r.selected.provider}/${r.selected.model}`;
  });
  await record('commands/list', async () => { const r = await client.listCommands(sessionId); return `${r.length} command(s)`; });
  await record('skills/list', async () => { const r = await client.listSkills(sessionId); return `${r.length} skill(s)`; });
  await record('session/rename', async () => { const r = await client.renameSession(sessionId, 'rc2 compat probe'); return `seq=${String(r.seq)}`; });
  await record('fileUploads/upload', async () => {
    const r = await client.uploadFile(sessionId, Buffer.from('rc2 compat').toString('base64'), 'compat.txt');
    return `receipt=${String(r.receiptId).slice(0, 8)}… bytes=${r.file.bytes}`;
  });
  await record('workspace/archiveSession', async () => { const r = await client.archiveSession(sessionId); return `${r.archivedSessionIds.length} archived`; });
  await record('workspace/unarchiveSession', async () => { const r = await client.unarchiveSession(sessionId); return `${r.archivedSessionIds.length} archived`; });
  await record('session/cancel', async () => { await client.cancel(sessionId); return 'ok'; });
}

// Account (0.1.7-rc.2). The browser round-trip needs real credentials, but
// every client-side step around it is exercised, including the exact call the
// sidebar makes before opening the authorize URL.
const accountMetadata = accountClientMetadata('0.0.11', 'en');
await record('account/getState', async () => {
  const view = await client.accountState();
  const parsed = accountStateOf(view);
  return `available=${String(parsed.available)} status=${parsed.signedIn ? 'signed-in' : 'signed-out'}`;
});
await record('account/getProfile + getBalance', async () => {
  const [p, b] = await Promise.all([
    client.accountProfile(accountMetadata).catch(() => undefined),
    client.accountBalance(accountMetadata).catch(() => undefined),
  ]);
  return `profile=${p === null || p === undefined ? 'null' : 'present'} balance=${b === null || b === undefined ? 'null' : 'present'}`;
});
let signInAttemptId;
await record('account/startSignIn -> authorizeUrl arrives', async () => {
  const started = accountStateOf(await client.startAccountSignIn(
    accountMetadata, `http://127.0.0.1:${new URL(launch.origin).port}`, 'desktop'));
  signInAttemptId = started.attemptId;
  if (signInAttemptId === undefined) throw new Error('start did not return an attempt id');
  // The Host mints the URL asynchronously, so the sidebar must poll for it —
  // exactly what this loop mirrors.
  for (let i = 0; i < 12; i++) {
    await new Promise(resolve => setTimeout(resolve, 700));
    const account = accountStateOf(await client.accountState());
    if (account.authorizeUrl !== undefined) {
      return `after ${i + 1} poll(s): phase=${String(account.phase)} url=${account.authorizeUrl.slice(0, 40)}…`;
    }
  }
  throw new Error(`authorizeUrl never appeared (start phase ${String(started.phase)})`);
});
await record('account/cancelSignIn', async () => {
  if (signInAttemptId === undefined) throw new Error('no attempt to cancel');
  const parsed = accountStateOf(await client.cancelAccountSignIn(signInAttemptId));
  return `phase=${String(parsed.phase)}`;
});
await record('account/signOut', async () => {
  const parsed = accountStateOf(await client.signOutAccount(accountMetadata));
  return `status=${parsed.signedIn ? 'signed-in' : 'signed-out'}`;
});

await record('agentPresets/list', async () => { const r = await client.listAgentPresets(); return `${r.presets.length} preset(s)`; });
await record('settings/describe', async () => { const r = await client.settings(); return `${r.namespaces.length} namespace(s)`; });
await record('pluginInventory/list', async () => { const r = await client.pluginInventory(); return `${r.entries.length} entry(ies)`; });

// Give the mux a moment to settle so late frames are attributed.
await new Promise(resolve => setTimeout(resolve, 1500));

// Frames are { channel, rpcId, payload }; the event name lives on payload.type.
const kinds = [...new Set(frames.map(f => `${f.channel}:${String(f.payload?.type ?? '?')}`))].sort();
console.log('=== live compatibility against the running DSH ===\n');
for (const r of results) console.log(`  ${r.ok ? 'OK  ' : 'FAIL'}  ${r.name.padEnd(48)} ${r.note}`);
console.log(`\nframes observed: ${frames.length}  kinds=[${kinds.join(', ')}]`);
const failed = results.filter(r => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} touchpoints OK`);
if (failed.length > 0) {
  console.log('\nFAILURES:');
  for (const f of failed) console.log(`  - ${f.name}: ${f.note}`);
}
client.dispose?.();
connection.dispose();
process.exit(failed.length === 0 ? 0 : 1);
