#!/usr/bin/env node
// Review a DSH version bump BEFORE installing it.
//
// Downloads the RPC contract surface (Typert host descriptors + published types)
// of the packages this extension consumes, for two published versions, and
// reports added/removed RPC methods and changed argument/result schemas.
// Uses an ignored .drift scratch directory; no packages are installed and no
// user profile or conversation is read or changed.
//
// Usage: node tooling/dsh-contract-diff.mjs [fromVersion] [toVersion]
//        node tooling/dsh-contract-diff.mjs 0.1.7-rc.1 0.1.7-rc.2

import { existsSync } from 'node:fs';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { methodsOf } from './dsh-contract-surface.mjs';

const [fromVersion = '0.1.7-rc.1', toVersion = '0.1.7-rc.2'] = process.argv.slice(2);

// Every @deepseek-ai package whose contract this extension actually calls into.
const PACKAGES = [
  'dsh-typert-protocol', 'dsh-api-remotes', 'dsh-api-gateway',
  'dsh-api-session-controller', 'dsh-api-job-controller', 'dsh-api-workspace-controller',
  'dsh-api-settings-controller', 'dsh-client-connection', 'dsh-client-file-upload',
  'dsh-subagent', 'dsh-agent-preset-registry', 'dsh-commands', 'dsh-session',
  'dsh-session-projection', 'dsh-attachment', 'dsh-host-plugin-inventory',
];

const root = fileURLToPath(new URL('../.drift/contract-diff/', import.meta.url));

async function fetchContract(pkg, version) {
  const meta = await fetch(`https://registry.npmjs.org/@deepseek-ai/${pkg}`).then(r => r.json());
  const entry = meta?.versions?.[version];
  if (entry === undefined) return undefined;
  const tar = await fetch(entry.dist.tarball).then(r => r.arrayBuffer());
  const dir = join(root, version, pkg);
  await mkdir(dir, { recursive: true });
  // Extract everything (these tarballs are small); selective extraction via
  // globs silently produced empty trees across tar implementations.
  const { spawnSync } = await import('node:child_process');
  const tarFile = join(root, `${pkg}-${version}.tgz`);
  await writeFile(tarFile, Buffer.from(tar));
  const run = spawnSync('tar', ['xzf', tarFile, '-C', dir], { encoding: 'utf8' });
  if (run.status !== 0) throw new Error(`tar failed for ${pkg}@${version}: ${run.stderr?.slice(0, 120)}`);
  const unpacked = join(dir, 'package');
  const descriptor = join(unpacked, 'lib/typert.host.js');
  if (!existsSync(descriptor)) throw new Error(`no typert.host.js in ${pkg}@${version}`);
  return unpacked;
}

const read = async (path) => {
  try { return await (await import('node:fs/promises')).readFile(path, 'utf8'); } catch { return undefined; }
};

// Generated descriptors embed source line numbers; strip them so only real
// shape changes register.
const schemasOf = (source) => {
  if (source === undefined) return undefined;
  const out = new Map();
  for (const m of source.matchAll(/const ([A-Za-z0-9_$]+)\$schema = \(\) => \(\1\$schema\$value \?\?= ([\s\S]*?)\)\n/g)) {
    out.set(m[1], m[2].replace(/sourceLocation:\s*\{[^}]*\}/g, '').replace(/\s+/g, ' ').trim());
  }
  return out;
};

await rm(root, { recursive: true, force: true });
let findings = 0;
let failures = 0;
let compared = 0;
console.log(`DSH contract diff: ${fromVersion} -> ${toVersion}\n`);

for (const pkg of PACKAGES) {
  let fromDir;
  let toDir;
  try {
    [fromDir, toDir] = await Promise.all([fetchContract(pkg, fromVersion), fetchContract(pkg, toVersion)]);
  } catch (error) {
    const reason = String(error?.message ?? error);
    if (!reason.includes('no typert.host.js')) failures++;
    console.log(`  ??  ${pkg}: ${reason.includes('no typert.host.js')
      ? 'library package (no host RPC face to diff)'
      : `could not be diffed: ${reason.slice(0, 70)}`}`);
    continue;
  }
  if (fromDir === undefined || toDir === undefined) {
    console.log(`  --  ${pkg}: not published in one of the two versions (platform-specific or new)`);
    continue;
  }
  const [fromHost, toHost] = await Promise.all([
    read(join(fromDir, 'lib/typert.host.js')), read(join(toDir, 'lib/typert.host.js')),
  ]);
  if (fromHost === undefined || toHost === undefined) {
    failures++;
    console.log(`  ??  ${pkg}: downloaded Host descriptor could not be read`);
    continue;
  }
  compared++;
  const fromMethods = methodsOf(fromHost);
  const toMethods = methodsOf(toHost);
  const added = [...(toMethods ?? [])].filter(m => !(fromMethods ?? new Set()).has(m));
  const removed = [...(fromMethods ?? [])].filter(m => !(toMethods ?? new Set()).has(m));

  const fromSchemas = schemasOf(fromHost) ?? new Map();
  const toSchemas = schemasOf(toHost) ?? new Map();
  const schemaChanges = [...new Set([...fromSchemas.keys(), ...toSchemas.keys()])]
    .filter(k => fromSchemas.get(k) !== toSchemas.get(k));

  if (added.length === 0 && removed.length === 0 && schemaChanges.length === 0) {
    console.log(`  ok  ${pkg}`);
    continue;
  }
  findings += added.length + removed.length + schemaChanges.length;
  console.log(`  !!  ${pkg}`);
  for (const m of added) console.log(`         + method ${m}`);
  for (const m of removed) console.log(`         - method ${m}`);
  for (const k of schemaChanges) {
    const before = fromSchemas.get(k);
    const after = toSchemas.get(k);
    const shape = (v) => v === undefined ? '(absent)' : [...v.matchAll(/'([A-Za-z]+)':/g)].map(m => m[1]).join(',') || v.slice(0, 50);
    console.log(`         ~ schema ${k.replace(/^_deepseek_ai_/, '').replace(/_/g, '/')}`);
    console.log(`             was: ${shape(before)}`);
    console.log(`             now: ${shape(after)}`);
  }
}

await rm(root, { recursive: true, force: true });
if (failures > 0 || compared === 0) {
  console.log(`\nIncomplete comparison: ${compared} Host package(s) compared, ${failures} failed. No compatibility conclusion.`);
  process.exitCode = 1;
} else {
  console.log(`\n${compared} Host package(s) compared. ${findings === 0 ? 'No RPC method or serialized schema changes detected in these descriptors.' : `${findings} contract change(s) to review.`}`);
}
