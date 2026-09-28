# Protocol diagnostics

Standalone Node scripts that probe a **live DSH runtime** and report where this
extension's protocol assumptions no longer hold. They talk to DSH the same way
the extension does, so a failure here usually means the extension is about to
break too.

Run these **first** after upgrading DeepSeek Harness.

## Usage

Every script needs a DSH launch URL that carries a token — the same URL the
sidebar accepts. Start DSH (`dsh web`), copy the URL, and pass it quoted:

```sh
node tooling/dsh-drift-audit.mjs '<launch url with token>'
```

| Script | What it does |
|---|---|
| `dsh-drift-audit.mjs` | Runs the extension's touchpoints as hand-rolled RPC calls and reports which ones drifted. **Start here.** |
| `dsh-contract-diff.mjs` | Diffs two published DSH versions' RPC surfaces (method sets + zod schemas) straight from the registry, so an upgrade can be reviewed before installing it. |
| `dsh-live-compat.mjs` | Drives the extension's **real client code** (`src/dsh-connection.ts` + `src/dsh-client.ts`, bundled with esbuild) against a live runtime and reports every protocol touchpoint it can reach. The strongest drift check: it exercises our own parsing, not a reimplementation. |
| `probe-file-upload.mjs` | Verifies the dropped-file path: that `fileUploads/upload` mints a receipt and that `session/prompt` accepts a `{type:'file', receiptId}` content part. Uses a bogus receipt, so it never spends a model call. |
| `dsh-endpoint-inventory.mjs` | Enumerates which Remote endpoints actually exist, by probing each with empty args and classifying the error (`not-found` = missing, `invalid` = exists). |
| `dsh-mux-probe2.mjs` | Dumps the three baseline streams the extension opens and replays its exact frame handlers to find which frame throws. |
| `dsh-mux-probe.mjs` | Dumps raw mux frames and replays the extension's stream parser. |
| `dsh-url-check.mjs` | Reproduces the extension's URL validation and auth handshake, to separate "bad URL/token" from "protocol drift". |

## Notes

- Tokens are never printed by default. `dsh-url-check.mjs --show-token` prints
  the token for debugging — **do not paste that output anywhere**.
- The launch token expires whenever DSH restarts; re-copy the URL if auth fails.
- These are development tools. They are excluded from the packaged extension.
- Probes that need a scratch session should run against an isolated home
  (`DSH_HOME=$(mktemp -d) dsh web --host 127.0.0.1 --port 0`) so they never touch
  real conversations.

## Typical upgrade loop

```sh
./build.sh                                  # build + package a VSIX
node tooling/dsh-drift-audit.mjs '<url>'    # find what drifted
# fix src/, then:
npx tsc -p tsconfig.json --noEmit && npx vitest run
```
