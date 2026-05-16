# MiniCut CRDT Test Harness

MiniCut keeps CRDT transport behind test-only runtime options. The production worker path still boots without a CRDT runtime and continues to use the existing `sync_sender` bridge.

## Test Runtime

Use `createMiniCutDktRuntime({ crdt: { enabled: true, peerId, transport } })` or `bootDktModels({ crdt: true })` in tests. Both paths inject DKT's CRDT runtime through `prepareAppRuntime({ crdtRuntime })` and leave the default runtime unchanged.

## Relay Harness

`createInMemoryCrdtRelay` is schema-agnostic. Packets carry room, peer, profile, vector clock, and canonical ops only. The relay rejects profile mismatches and peer spoofing, avoids echoing to the sender, dedupes packets, keeps a bounded per-room log, and supports sync requests.

`createTestWorkerCrdtTransport` adapts the relay to a worker-like test transport. `createCrdtWorkerPair` wires two MiniCut DKT runtimes through that transport and applies remote canonical ops in per-node batches with `receiveCanonicalOps`.

## Guards

Run the focused suite with:

```sh
npm run test:video-editor:crdt
```

The suite covers declaration shape, local op staging/rollback, runtime bootstrap, relay contracts, two-peer convergence, one real timing conflict scenario, and the jsdom conflict command UI. Structural conflict scenarios that depend on future deterministic DKT detector projection are recorded as `todo` tests in `crdt-conflict-scenarios.test.ts`.
