# CRDT outbox and durable log retention without a transport

Status: observed behaviour plus a proposed policy. Nothing here is implemented as cleanup; no
metadata, clock or log data is removed anywhere in code.

Scope: desktop hosts (Node, Electron, GPUIX) that run the local CRDT engine on LevelDB with
`transport: null` (see `adapters/node/startNodeMiniCutHost.ts`). The same engine code runs in the
browser on IndexedDB.

## Observed behaviour

Measured with the Node host on a real LevelDB (win32-x64, Node), `createProject` repeated in one
session, then close and reopen:

| Local edits (createProject) | outbox ops (in memory) | durable log ops (in memory) |
| --- | --- | --- |
| 1 (plus the default project) | 44 | 44 |
| 10 | 242 | 242 |
| 50 | 1122 | 1122 |
| 100 | 2222 | 2222 |

- One `createProject` is about 22 ops (project, two tracks and their rels). The first start of an
  empty workspace adds one default project, so the table starts at 44.
- LevelDB size after 100 edits: about 4.4 MB. Reopening and restoring the workspace took about
  0.55 s. Both grow linearly with the number of ops.
- Every local commit appends the batch to the durable log (`appendBatches`), appends the same batch
  to the persisted outbox (`appendBatchOutbox`), marks it applied and updates the vector clock
  (`DktCRDTEngine`, around `storage.appendBatches`).
- Without a transport nothing drains the outbox. `outbox`, `outbox_batches` and `durable_log` only
  grow. `flushTransportOutbox()` returns early without a transport.
- With a transport, a successful send removes batches only from the in-memory `outbox_batches`
  (`mark_sent`). The storage-side `removeBatchOutbox(batch_id)` exists on the storage package but
  the engine never calls it, so the persisted outbox is not trimmed after a send either.
- `restoreFromStorage()` loads the whole durable log and the whole outbox into memory
  (`getBatchesAfter({})`, `getBatchOutbox()`), then replays them (or a kernel snapshot plus the tail
  of the log when `kernel_snapshot` metadata exists). Startup time and memory therefore grow with
  history length.
- The vector clock and applied-op metadata are persisted and restored; the peer id is stable
  across restarts (identity is persisted separately before bootstrap).

Known defect found while measuring (suspected DKT bug, reported separately): `restoreFromStorage()`
does not restore `batch_seq`, so the first batch after a restart is again `<peer>:batch:1` and
overwrites the stored batch and outbox entry with that id. Until it is fixed the durable log and the
persisted outbox lose history across restarts, so any retention work must come after that fix. The
test `keeps earlier durable log batches and outbox entries after a restart` in
`adapters/node/nodeWorkspaceLifecycle.test.ts` is marked `it.fails` and starts failing when DKT is
fixed.

## Risks

- Unbounded growth of LevelDB, memory and restore time during long local-only use.
- Deleting outbox batches, log batches, clock or applied-op metadata "to save space" can break
  future replication: a peer that connects later needs the history (or a snapshot that covers it)
  to converge, and the clock and applied ids prevent duplicate application.
- The two copies (`durable_log` for restore, outbox for delivery) are different concerns and need
  different retention rules.

## Proposed policy (not implemented)

1. Do not clean anything blindly. Retention is driven by explicit conditions, never by size alone.
2. Fix `batch_seq` restore first; add the vector clock and the highest used batch sequence to the
   restore checks.
3. Outbox (delivery queue). Keep every batch until a transport acknowledges it. While no transport
   has ever been attached, the outbox is also the only record of what a future peer has not seen,
   so keep it in full. Once the engine calls `removeBatchOutbox` after an acknowledged send, the
   outbox size is bounded by unacknowledged work.
4. Durable log (restore and history). Keep it until a verified snapshot (`kernel_snapshot` plus
   sidecar snapshot) covers a prefix of it and every known or future peer can be served from the
   snapshot. Compact only prefixes covered by a snapshot, in one atomic batch together with the
   snapshot, and never remove the vector clock or the applied-op ids.
5. Before any compaction exists, add observability: expose outbox and durable log counts and the
   LevelDB size in the host diagnostics (the debug dump already reports counts), and log when the
   counts cross configurable thresholds. Thresholds only warn.
6. Decide, before the first network transport is wired, whether a workspace that was local-only
   for a long time is sent as the full outbox, as a snapshot, or as a new replica baseline. This
   is a product and sync decision, not a storage detail.
7. When replication is added, test the whole sequence: long local-only session, restart, attach
   transport, deliver outbox, acknowledge, compact, restart, new edit.

## Open questions for the owner

- Maximum acceptable local-only history before warning (ops, MB, restore time).
- Whether a snapshot may replace the log prefix for peers that never saw it.
- Who owns the compaction trigger: the engine (DKT) or the host.
