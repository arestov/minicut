# Stage 1b outcome: DKT on Bun

Date: 2026-10-07. Bun 1.4.2, Node 24.17.0, vitest 4.1.5, Windows 11.

## Results

| Suite | Runtime | Result |
| --- | --- | --- |
| `npm run test:bun:node` (video-editor node config) | Bun | 231 pass, 2 expected fail, 0 fail (39 files) |
| `npm run test:bun:crdt` (video-editor crdt config) | Bun | 149 pass, 0 fail (32 files) |
| `npm run test:bun:contracts` (effect contract suite) | Bun | 10 pass, 0 fail |
| `src/video-editor/dkt/runtime/workerPortSync.test.ts` | Bun and Node | 1 pass each |
| DKT unit/integration, dkt-react-sync, LevelDB workspace lifecycle | Bun | green (stage 1 and first run) |

`workerPortSync.test.ts` runs the real MiniCut DKT runtime (memory storage,
contract fakes) in a `worker_threads` worker and talks to it from a headless
page sync runtime (`createMiniCutPageSyncRuntime` / `ReactSyncReceiver`) only
through `createPortTransport`: handshake, initial sync, shape mount, the
`createProject` action and its sync back (title and default tracks).

## Outcome A (DKT and storage run in Bun): confirmed

No behaviour difference between Bun and Node was found in the DKT runtime,
worker sync or storage suites. No DKT workaround was needed.

## Known caveats

- Bun resolves `bun` from `BUN_BIN` or PATH (`scripts/run-vitest-bun.mjs`,
  `scripts/run-dkt-solid-sync-tests.mjs`). Without either the scripts fail
  with an explicit message.
- `dkt` / `dkt-all` aliases come from `scripts/dktAliases.mjs`. In Bun they are
  a plugin preload (`src/dkt-solid-sync/test/dktAliasPreload.ts`). The preload
  is not inherited by `worker_threads` workers: pass it as
  `new Worker(url, { preload: [...] })`. Without it the worker hangs silently
  on the unresolved import (the test times out) instead of failing fast.
- The Node variant of the worker test cannot load the TypeScript host with
  `dkt` aliases directly, so it runs an esbuild bundle of the host built into a
  temp directory.
- `bun test` reads `bunfig.toml` only from its cwd, so Solid tests run from
  `src/dkt-solid-sync`; vitest-on-Bun (`bun --bun vitest`) needs no bunfig.
