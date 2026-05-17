# MiniCut CRDT Test Harness

MiniCut keeps CRDT transport behind test-only runtime options. The production worker path still boots without a CRDT runtime and continues to use the existing `sync_sender` bridge.

## Test Runtime

Use `createMiniCutDktRuntime({ crdt: { enabled: true, peerId, transport } })` or `bootDktModels({ crdt: { enabled: true, peerId } })` in tests. Both paths inject DKT's CRDT runtime through `prepareAppRuntime({ crdtRuntime })` and leave the default runtime unchanged.

## Storage Matrix

MiniCut accepts DKT's public CRDT storage packages through `crdt.storage`.

| Profile | Storage | Unload | Use |
| --- | --- | --- | --- |
| `memory` | `makeDktCrdtMemoryStorage()` | off | fast model, relay, and maelstrom tests |
| `indexeddb` | `makeDktCrdtIndexedDBStorage()` | off | browser worker durable smoke tests |
| `lazy-indexeddb` | `makeDktCrdtIndexedDBStorage()` | on | unload/lazy carrier pair tests |

The web worker production path should use IndexedDB when CRDT is enabled. Memory remains a test/default harness storage only. Lazy unload is opt-in via `unloadModels: true`; durable storage alone must not enable unload implicitly. The pair storage matrix runs memory, IndexedDB, and lazy IndexedDB profiles so CRDT receive paths keep working when MiniCut models are unloaded between transactions.

## Relay Harness

`createInMemoryCrdtRelay` is schema-agnostic. Packets carry room, peer, profile, vector clock, and canonical ops only. The relay rejects profile mismatches and peer spoofing, avoids echoing to the sender, dedupes packets, keeps a bounded per-room log, and supports sync requests.

`createTestWorkerCrdtTransport` adapts the relay to a worker-like test transport. `createCrdtWorkerPair` wires two MiniCut DKT runtimes through that transport and applies remote canonical ops in per-node batches with `receiveCanonicalOps`.

## Guards

Run the focused suite with:

```sh
npm run test:video-editor:crdt
```

The suite covers declaration shape, storage profiles, local op staging/rollback, runtime bootstrap, relay contracts, two-peer convergence, one real timing conflict scenario, MiniCut maelstrom traces, and the jsdom conflict command UI.
