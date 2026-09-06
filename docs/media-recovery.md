# Durable media recovery

MiniCut separates the durable media result from the runtime recovery process.

## State ownership

`Resource` owns the steady state: immutable `assetRef` and handle `sourceRef`, verified media metadata and fingerprint, `localMediaAvailability`, `originalAccessStatus`, and the single `activeMediaRecoveryTask` relation.

`MediaRecoveryTask` is a durable, local-only operational model. It records serializable attempt identity, phase, compatibility result, reason/error, staged refs, timestamps, interruption, and outcome. `File`, `FileSystemFileHandle`, object URLs, promises, callbacks, and abort controllers never enter DKT attrs/rels or CRDT messages; the runtime-ref registry and effect adapter own them.

The task is local-only for CRDT visibility, not for durability. A committed task-owned DKT transaction persists its complete write-set, including changes to its linked `Resource`. Rollback persists none of it.

## Independent availability axes

- `localMediaAvailability` says whether editing can use a project copy or granted file handle now.
- `originalAccessStatus` says whether the original handle is `granted`, `prompt`, `denied`, `missing`, or unknown.

A project copy may remain usable while original access is denied. Automatic boot recovery may call `queryPermission`; `requestPermission` and `showOpenFilePicker` start only from a user gesture.

## Attempts and reloads

Every editor boot creates a new `bootId` and one new recovery task per durable resource. A previous task is interrupted or superseded; its runtime refs and object URL are never reused. Boot recovery reconciles storage, checks the project copy and saved handle, creates a fresh object URL, and never opens a picker or permission prompt automatically.

The main phases are `created → inspecting → ready-to-commit/awaiting-confirmation → committing → completed`, plus recoverable `awaiting-user-action`, `failed`, `rejected`, `cancelled`, `interrupted`, and `superseded` outcomes. Completions carry `operationId`; stale completions are `$noop`.

## Versioned commit and reconciliation

Recovery writes immutable refs:

```text
project/{projectId}/resource/{resourceId}/asset/{operationId}
project/{projectId}/resource/{resourceId}/handle/{operationId}
```

The protocol stages and validates both records, commits the task-owned DKT transaction that switches `Resource` and completes the task, then removes obsolete versions. Before the pointer switch, failure rolls back the new versions. After the switch, boot reconciliation keeps the published version and removes obsolete or staged data. OPFS unavailability/quota may use a linked fallback when the handle remains usable.

Legacy single-record assets and nullable/missing handle metadata are normalized at the storage boundary and migrated to versioned refs when read.

## Compatibility guarantees

The browser probe measures duration, dimensions and stream topology; frame rate/timebase and audio properties remain explicitly unknown when the browser cannot report them. Policy never promotes unknown required evidence to an exact match. It compares duration against the used source range, dimensions, stream topology, available timing/audio properties, and a bounded-memory content fingerprint. A different critical structure is rejected; an intentional safe replacement can require confirmation.

## Development guardrails

- Do not build business patches with `pageRuntime.readAttrs` or `dispatch → read/wait → dispatch`.
- Do not call `setResourceAttrs` for import/recovery completion.
- Keep side effects behind runtime refs/effect adapters and return only serializable action payloads.
- Keep task/owner operational state out of CRDT while preserving local durability.
- Preserve user activation for picker and permission requests.
- Test stale/noop, rollback, reconciliation, denied permission, incompatible candidates, retry, and at least two real page reloads.

Relevant checks are `guard:dkt-hard`, `typecheck:dkt-compat`, the video-editor node/shared/isolated/CRDT suites, media component/unit tests, and `tests/integration/single-mode-handle-media-reload.spec.ts`.
