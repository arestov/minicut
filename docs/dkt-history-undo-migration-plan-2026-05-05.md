# MiniCut DKT history / undo migration plan

Date: 2026-05-05

Status: separate planning document. **Do not migrate history/undo in the clean DKT graph migration until this plan is implemented explicitly.**

## 1. Scope boundary

The main Legend -> DKT migration may introduce clean model actions, session routing, DKT runtime boot, read-model projections, import/export task boundaries, and worker transport plumbing.

It must not change undo/redo semantics yet.

Current user-facing guarantee:

- one logical editor operation should map to one undoable unit;
- undo/redo state is visible through toolbar/history state;
- SharedWorker and P2P clients must see the same project graph after undo/redo;
- export/render snapshots should match the graph after history navigation.

The current implementation is worker-owned and command/patch based. That is a different design from DKT transaction history, so it deserves its own migration.

## 2. Current MiniCut history model

Files to audit before implementation:

| File | Current responsibility |
| --- | --- |
| `src/video-editor/worker/memoryWorker.ts` | In-memory authority, command dispatch, history stacks, undo/redo. |
| `src/video-editor/worker/sharedWorker.ts` | SharedWorker authority entrypoint and broadcast path. |
| `src/video-editor/worker/authorityClient.ts` | Page-side authority client, dispatch/undo/redo calls, subscriptions. |
| `src/video-editor/domain/applyCommand.ts` | Builds patch envelopes from commands. |
| `src/video-editor/domain/applyPatch.ts` | Applies patch envelopes to registry snapshots. |
| `src/video-editor/domain/actionTransactions.ts` | Pre-DKT transaction step descriptors and created-id refs. |
| `src/video-editor/app/actionTransactionExecutor.ts` | Temporary executor for command/session/effect steps. |
| `src/video-editor/app/createVideoEditorHarness.ts` | Syncs history state into UI-facing stores. |

Tests to preserve:

- `npm run test:video-editor -- src/video-editor/worker/memoryWorker.test.ts src/video-editor/worker/workerBoundary.test.ts`
- `npm run test:video-editor -- src/video-editor/app/createVideoEditorHarness.test.ts`
- `npm run test:video-editor -- src/video-editor/tests/video-editor.happy-path.test.tsx`
- P2P sync/failover specs when worker semantics change.

## 3. Target DKT history semantics

Target properties:

1. DKT action/walker transaction is the undo unit.
2. Direct attr actions and saga actions both publish one transaction envelope.
3. Created ids and rel writes are replayable or captured in transaction records.
4. External effects are not undone directly; graph changes resulting from effects are undoable when they commit.
5. Runtime-only resources (`File`, `Blob`, `RTCDataChannel`, object URLs) are never recorded in history.
6. P2P clients receive history navigation as graph sync updates, not as local re-execution of effects.

Possible internal representation options:

| Option | Pros | Cons | Initial verdict |
| --- | --- | --- | --- |
| Snapshot stack | Simple and close to current worker | Memory-heavy for large projects/media metadata | Keep as compatibility baseline only. |
| Patch envelope stack | Close to current protocol | Requires inverse patch support and stable patch ordering | Good intermediate candidate. |
| DKT transaction log | Best semantic fit | Needs transaction serialization, replay, inverse or snapshot checkpoints | Final target after DKT runtime owns graph. |
| Snapshot checkpoints + transaction deltas | Good performance/safety balance | More moving pieces | Likely best production design. |

## 4. Migration phases

### Phase H0: Freeze current behavior with tests

Goal: make current undo/redo contract explicit before any DKT history work.

Add or review tests for:

- create project -> undo -> redo;
- import/add clip -> undo -> redo;
- split clip -> undo returns to one clip;
- text/effect edit -> undo restores attrs;
- selection behavior after undo/redo;
- P2P/client replica after undo/redo.

Files:

- `src/video-editor/worker/memoryWorker.test.ts`
- `src/video-editor/app/createVideoEditorHarness.test.ts`
- `tests/integration/shared-worker-sync.spec.ts`
- `tests/integration/p2p-state-sync.spec.ts`

Tests:

- `npm run test:video-editor -- src/video-editor/worker/memoryWorker.test.ts src/video-editor/app/createVideoEditorHarness.test.ts`
- `npm run test:integration -- tests/integration/shared-worker-sync.spec.ts tests/integration/p2p-state-sync.spec.ts`

### Phase H1: Define DKT transaction envelope projection

Goal: define how one DKT transaction becomes a MiniCut sync/history record.

Files:

- future `src/video-editor/dkt/history/transactionEnvelope.ts`
- future `src/video-editor/dkt/history/transactionEnvelope.test.ts`
- `src/video-editor/domain/types.ts` only if shared protocol types need extension.

Required fields:

- transaction id;
- project id;
- version before/after;
- changed node ids;
- patch-like structural changes for page replicas;
- optional snapshot checkpoint id;
- no runtimeRef values.

Tests:

- unit test serializability;
- unit test no runtime-only objects;
- unit test stable ordering for rel splices and attr writes.

### Phase H2: Build inverse/rollback strategy

Goal: choose whether undo uses inverse patches, snapshots, or checkpoints.

Safety preference:

1. Keep snapshot checkpoints during early DKT runtime rollout.
2. Add inverse patches only after direct attr and rel writes are stable.
3. Use transaction deltas for memory optimization later.

Files:

- future `src/video-editor/dkt/history/createHistoryStore.ts`
- future `src/video-editor/dkt/history/applyHistoryTransaction.ts`

Tests:

- direct attr edit rollback;
- rel splice rollback;
- create/delete rollback;
- generated id rollback;
- checkpoint recovery.

### Phase H3: Worker integration behind a flag

Goal: run DKT history side by side with current worker history for comparison.

Files:

- `src/video-editor/worker/memoryWorker.ts`
- `src/video-editor/worker/sharedWorker.ts`
- future `src/video-editor/dkt/runtime/createMiniCutDktRuntime.ts`

Rules:

- default behavior remains current history;
- DKT history records are generated and compared in tests;
- no user-facing switch until parity passes.

Tests:

- `npm run test:video-editor -- src/video-editor/worker/memoryWorker.test.ts src/video-editor/worker/workerBoundary.test.ts`
- happy-path with extra assertions for history state.

### Phase H4: Switch undo/redo to DKT history

Goal: DKT runtime owns graph state and history for migrated project actions.

Prerequisites:

- clean DKT actions cover simple clip/text/effect attrs;
- timeline actions pass invariant tests;
- import/resource tasks commit serializable graph transactions;
- P2P sync uses DKT transaction updates;
- export snapshot projection is parity-tested.

Tests before commit:

- full video-editor unit suite;
- app happy path;
- worker tests;
- P2P state sync and failover specs;
- integration shared-worker sync.

## 5. Risks specific to history

| Risk | Why it matters | Mitigation |
| --- | --- | --- |
| Effects replay on redo | Redo should not re-open file dialogs or recreate consumed runtime refs. | Store committed graph changes, not effect calls. |
| RuntimeRef leakage | History must never capture `File`, `Blob`, ports, channels. | Add serializability tests and runtimeRef redaction checks. |
| Large project memory use | Video projects can accumulate many resource/chunk records. | Use checkpoint + delta design after correctness. |
| P2P divergence | Clients should not each run undo locally. | Server/runtime applies history; clients receive graph sync. |
| Selection mismatch | Undo graph change can invalidate selected entity. | SessionRoot has a post-history selection repair action. |
| Version ordering | History navigation must preserve monotonic project versions or explicit history version semantics. | Define version policy in transaction envelope before implementation. |

## 6. Done criteria

History migration is complete only when the report table includes:

| Step | Commit | Files changed | Tests run | Result | Problems / follow-up |
| --- | --- | --- | --- | --- | --- |
| H0 | commit hash | test files | exact commands | passed/failed | notes |

Do not mark history migration complete until P2P/shared-worker tests pass with DKT history enabled.
