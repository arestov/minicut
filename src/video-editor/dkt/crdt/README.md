# MiniCut CRDT Transport and Test Harness

MiniCut production collaboration is room-scoped and worker-owned. The SharedWorker owns the DKT runtime, CRDT runtime, durable storage, and canonical app graph for a room. Tabs are views/controllers through the existing `sync_sender` bridge; one capable tab may be elected as the WebRTC transport owner because browser WebRTC objects cannot live in the SharedWorker.

Production transport shape:

```text
room URL
	-> room-scoped SharedWorker
	-> worker-owned DKT runtime + CRDT runtime + storage + graph
	-> sync_sender page bridge for UI projections
	-> elected tab-owned WebRTC adapter for opaque CRDT/media packets
```

The elected tab may own `RTCPeerConnection`, `RTCDataChannel`, signaling socket state, and media transfer streams. It must not own canonical graph state, mutate DKT models directly, choose the worker workspace, or inspect MiniCut domain data inside CRDT packets.

Worker/tab transport messages are defined in `src/video-editor/worker/productRoomProtocol.ts`. Every transport message includes `roomId`; WebRTC lifecycle and packet messages include a monotonic `transportGeneration`; CRDT packets are opaque JSON carried by `CRDT_SEND`/`CRDT_RECEIVE`; media packets are separate `MEDIA_SEND`/`MEDIA_RECEIVE` envelopes.

The browser CRDT profile is a test harness for conflict UX and storage smoke coverage. It is enabled with `VITE_MINICUT_ENABLE_CRDT_TEST_HARNESS=1`; do not treat it as the product multi-tab/offline CRDT mode.

For room-backed harness opens, MiniCut now treats storage identity as:

```text
roomId -> workspaceId -> dbName -> open policy -> restore/init
```

Where:

- `roomId` is the bookmarked URL/collaboration identity;
- `workspaceId` is a deterministic storage identity derived 1:1 from `roomId`;
- `dbName` is the IndexedDB namespace derived from `workspaceId`;
- `projectId` remains graph state inside the workspace and does not select storage;
- `sessionId` and session root node ids are runtime identities and do not select storage.

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
- deterministic room bookmark -> workspace/db resolution across reloads;
- ClipConflictBadge -> ConflictInspectorPanel;
- invalid timing resolve -> durable-style error meta rendered in the inspector;
- valid clear -> conflict badge disappears;
- reset clears the selected room workspace DB without touching another room workspace DB;
- newer/incompatible storage open policy failures surface a user-facing harness error;
- controlled two-tab conflict UX;
- browser reload of the CRDT test harness.

The browser reload test intentionally does not claim durable restore of a specific MiniCut project. Durable app-state restore is proven in runtime/storage tests. A product browser E2E for project restore, offline, rejoin, and real multi-peer transport belongs to a future app-level CRDT session runtime, not to the current production worker bridge.

When a room-backed workspace opens empty, MiniCut stages the expected manifest before the first durable commit. That keeps the next open on the same bookmarked room in the explicit manifest/open-policy path instead of falling back to implicit legacy-v0 detection.

`CLEAR_LOCAL_WORKSPACE_STORAGE` is a debug/test harness command only. In the browser harness it clears the local IndexedDB namespace derived from the current room/workspace and reloads/reopens the page; it is not product workspace delete/reset semantics. Product delete/reset must use a separate future operation and UX contract.

## Relay Harness

`createInMemoryCrdtRelay` is schema-agnostic and test-only. It is a deterministic cable for runtime and browser repros, not the production architecture. Packets carry room, peer, profile, vector clock, and canonical ops only. The relay rejects profile mismatches and peer spoofing, avoids echoing to the sender, dedupes packets, keeps a bounded per-room log, and supports sync requests.

`createTestWorkerCrdtTransport` adapts the relay to a worker-like test transport. `createCrdtWorkerPair` wires two MiniCut DKT runtimes through that transport and applies remote canonical ops in per-node batches with `receiveCanonicalOps`.

## Guards

Run the focused suite with:

```sh
npm run test:video-editor:crdt
npm run test:integration:crdt
```

The suites cover declaration shape, storage profiles, local op staging/rollback, runtime bootstrap, relay contracts, two-peer convergence, timing and structural conflict scenarios, durable restart, failed resolve policy, MiniCut maelstrom traces including lazy IndexedDB, jsdom conflict command UI, and browser conflict UX harness coverage.
