# MiniCut CRDT Test Harness

MiniCut keeps CRDT transport behind explicit test/runtime harness options. The production worker path is not a CRDT authority: it remains a 1:1 live bridge from the app/model graph to the view graph through the existing `sync_sender` pipeline.

The browser CRDT profile is a test harness for conflict UX and storage smoke coverage. It is enabled with `VITE_MINICUT_ENABLE_CRDT_TEST_HARNESS=1`; do not treat it as the product multi-tab/offline CRDT mode.

## Test Runtime

Use `createMiniCutDktRuntime({ crdt: { enabled: true, peerId, transport } })` or `bootDktModels({ crdt: { enabled: true, peerId } })` in tests. Both paths inject DKT's CRDT runtime through `prepareAppRuntime({ crdtRuntime })` and leave the default production worker bridge semantics unchanged.

## Storage Matrix

MiniCut accepts DKT's public CRDT storage packages through `crdt.storage`.

| Profile | Storage | Unload | Use |
| --- | --- | --- | --- |
| `memory` | `makeDktCrdtMemoryStorage()` | off | fast model, relay, and maelstrom tests |
| `indexeddb` | `makeDktCrdtIndexedDBStorage()` | off | durable runtime, reinit, and browser harness smoke tests |
| `lazy-indexeddb` | `makeDktCrdtIndexedDBStorage()` | on | unload/lazy carrier and maelstrom matrix tests |

Memory remains a fast test/default harness storage only. IndexedDB is the durable storage package used by runtime/storage tests and browser harness smoke tests. Lazy unload is opt-in via `unloadModels: true`; durable storage alone must not enable unload implicitly.

The storage matrix runs memory, IndexedDB, and lazy IndexedDB profiles. MiniCut maelstrom coverage includes lazy IndexedDB timing lifecycle, structural delete-vs-effect, reinit in the middle of a scenario, and unload after transaction boundaries.

Failed resolution attempt meta is currently durable: `$meta$aggregates$crdt$clipTiming$last_resolution_error` is expected to survive runtime restart in durable CRDT storage tests.

Opening a CRDT-backed store as DKT-only writable is not supported. A future DKT-only readonly/debug/export mode can be introduced as a separate API, but writable non-CRDT access to the same store would be a fork/migration scenario.

## Browser Harness

The Playwright CRDT profile starts Vite with `VITE_MINICUT_ENABLE_CRDT_TEST_HARNESS=1`:

```sh
npm run test:integration:crdt
```

This profile checks:

- CRDT harness boot with IndexedDB storage;
- ClipConflictBadge -> ConflictInspectorPanel;
- invalid timing resolve -> durable-style error meta rendered in the inspector;
- valid clear -> conflict badge disappears;
- controlled two-tab conflict UX;
- browser reload of the CRDT test harness.

The browser reload test intentionally does not claim durable restore of a specific MiniCut project. Durable app-state restore is proven in runtime/storage tests. A product browser E2E for project restore, offline, rejoin, and real multi-peer transport belongs to a future app-level CRDT session runtime, not to the current production worker bridge.

## Relay Harness

`createInMemoryCrdtRelay` is schema-agnostic. Packets carry room, peer, profile, vector clock, and canonical ops only. The relay rejects profile mismatches and peer spoofing, avoids echoing to the sender, dedupes packets, keeps a bounded per-room log, and supports sync requests.

`createTestWorkerCrdtTransport` adapts the relay to a worker-like test transport. `createCrdtWorkerPair` wires two MiniCut DKT runtimes through that transport and applies remote canonical ops in per-node batches with `receiveCanonicalOps`.

## Guards

Run the focused suite with:

```sh
npm run test:video-editor:crdt
npm run test:integration:crdt
```

The suites cover declaration shape, storage profiles, local op staging/rollback, runtime bootstrap, relay contracts, two-peer convergence, timing and structural conflict scenarios, durable restart, failed resolve policy, MiniCut maelstrom traces including lazy IndexedDB, jsdom conflict command UI, and browser conflict UX harness coverage.
