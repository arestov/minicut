# P2P Media Transfer Proof

Date: 2026-05-02

## Scope

This document records the implementation that closes the media-transfer part of the P2P roadmap from `d:\code\tracking\minicut-tracking\p2p.md`.

The delivered slice combines the roadmap's `Phase 3` and the preview-oriented parts of `Phase 4`:

- whole-file transfer stays out of domain state
- transport is chunk/range based over WebRTC DataChannel
- preview can start before full download
- progress and transfer state are visible in UI/debug
- playhead window requests exist and are tested

## What Was Added

### Transport and protocol

- `src/video-editor/p2p/PageP2PManager.ts`
  - added a dedicated raw resource data channel alongside the existing authority/state channel
  - client and server both receive explicit raw transport callbacks
- `src/video-editor/p2p/P2PAuthorityAdapter.ts`
- `src/video-editor/worker/createAuthorityClient.ts`
  - plumbed the resource-channel callbacks through the authority creation path

### Media transfer core

- `src/video-editor/media/resourceTransferScheduler.ts`
  - range normalization
  - HEAD-first request planning
  - TAIL fallback planning
  - playhead window planning
  - loaded/requested subtraction
- `src/video-editor/media/resourceTransferManager.ts`
  - out-of-state binary cache for remote chunks
  - local-owner serving over raw DataChannel
  - remote chunk assembly into preview/playback Blob URLs
  - requested/loaded range tracking
  - progress calculation from `loadedBytes / size`
  - explicit request event history for `head`, `window`, `sequential`, `tail`, `replication`
  - old Blob URL revocation on rebuild
  - bounded remote cache retention via `maxCachedBytes`

### Harness and UI wiring

- `src/video-editor/app/createVideoEditorHarness.ts`
  - imports now mark P2P-owned resources with `{ kind: 'p2p', ownerPeerId }`
  - imported local files are registered in the transfer manager instead of putting binary into project state
  - harness exposes transfer state and URL-resolution helpers to UI
- `src/video-editor/legend/derivedTimeline.ts`
  - rendered clips now carry `resourceId` so preview can resolve progressive URLs without mutating shared state
- `src/video-editor/ui/PreviewPanel.tsx`
  - resolves progressive media URLs before rendering
  - requests playhead windows from active clip position
- `src/video-editor/ui/RendererStage.tsx`
  - reports media decode/load failures back to the transfer manager for fallback scheduling
- `src/video-editor/ui/MediaBin.tsx`
  - shows transfer mode/status/progress
  - uses transfer preview URLs when present
- `src/video-editor/app/VideoEditorHarnessApp.tsx`
  - dev/debug bridge exposes transfer status for Playwright validation
  - test-only query params can tune chunk size, head bytes, delay, and playhead window size

## Requirement Mapping

### Phase 3: whole-file transfer outside domain state

Plan item:
send files without repacking, keep binary outside Legend/domain state, reconstruct full remote Blob.

Implemented:

- local owner serves `Blob.slice(start, end)` ranges directly over the raw resource DataChannel
- domain state still carries only metadata, `data.status`, `loaded/requested ranges`, and `loadedBytes`
- remote peer reconstructs full byte-identical Blob when all chunks arrive

Evidence:

- `src/video-editor/media/resourceTransferManager.test.ts`
  - `requests remote chunks and assembles a preview URL over a raw p2p transport`
  - verifies the rebuilt remote Blob bytes exactly equal the source Blob bytes

### Range/chunk protocol, start/end, and progress

Plan item:
use chunked byte ranges `[start, end)`, track requested vs loaded ranges, expose progress.

Implemented:

- scheduler aligns byte ranges to chunk boundaries
- manager tracks `loadedRanges`, `requestedRanges`, `requestedHistory`, `requestEvents`, and `loadedBytes`
- UI exposes `streaming/mirrored/local` transfer state with percent progress

Evidence:

- `src/video-editor/media/resourceTransferScheduler.test.ts`
  - range clamp/alignment
  - head/tail/window planning
  - subtraction of loaded coverage
- `src/video-editor/media/resourceTransferManager.test.ts`
  - partial-progress proof before completion
- `tests/integration/p2p-media-transfer.spec.ts`
  - remote browser observes partial progress before `ready`
  - Media Bin shows `streaming · ready · 100%`

### Preview before full download

Plan item:
preview should start from HEAD before full download, without browser-side repackaging/transmux.

Implemented:

- manager assembles Blob URLs from currently available contiguous bytes
- preview panel resolves resource URLs through the transfer manager, not through shared state mutation
- browser media element attempts decode on the partial Blob URL it receives

Evidence:

- `src/video-editor/media/resourceTransferManager.test.ts`
  - `surfaces partial progress before completion when head and transfer delay are constrained`
- `tests/integration/p2p-media-transfer.spec.ts`
  - remote browser reaches partial transfer first
  - remote preview URL becomes `blob:`
  - remote renderer video source resolves to `blob:`

### Playhead window requests

Plan item:
seeks/scrubbing should request a playhead-centered byte window.

Implemented:

- preview panel emits playhead requests using clip-local media time
- scheduler calculates the approximate byte window from `time / duration * size`
- transfer manager records request reasons, including `window`

Evidence:

- `src/video-editor/media/resourceTransferManager.test.ts`
  - verifies a `window` request event with a non-zero range start when the client requests a middle playhead window

### TAIL fallback and decode recovery

Plan item:
support TAIL fallback when decode of the current preview Blob fails.

Implemented:

- renderer/media element error paths call back into the transfer manager
- transfer manager issues a `tail` request when preview decode fails and tail has not yet been requested

Evidence:

- runtime path exists in `src/video-editor/ui/RendererStage.tsx` and `src/video-editor/media/resourceTransferManager.ts`
- scheduler tail planning is covered in `src/video-editor/media/resourceTransferScheduler.test.ts`

## Critical Checks

The following checks were explicitly added or preserved as proof points:

1. Remote resource entity appears before full bytes arrive.
   Evidence: browser spec observes remote `partial` transfer state before `ready`.
2. Full transfer reconstructs identical bytes.
   Evidence: byte-for-byte assertion in `resourceTransferManager.test.ts`.
3. Preview starts from transfer-managed Blob URLs rather than shared-state `blob:` replication.
   Evidence: browser spec observes remote renderer/media `blob:` URL.
4. Playhead window requests are emitted as explicit `window` scheduler events.
   Evidence: unit assertion on `requestEvents` in `resourceTransferManager.test.ts`.
5. Old Blob URLs are revoked on rebuild.
   Evidence: `resourceTransferManager.ts` always revokes prior URLs before replacing them.
6. Remote cache retention is bounded.
   Evidence: `resourceTransferManager.test.ts` evicts the older remote entry when `maxCachedBytes` is exceeded.

## Integration Matrix Coverage

### Unit coverage now present

- data model and resource availability helpers
- P2P manager resource-channel multiplexing surface
- authority adapter resource transport plumbing
- scheduler HEAD/TAIL/window logic
- full remote reconstruction
- partial progress before completion
- playhead window request emission
- bounded cache eviction

### Browser integration now present

- two tabs join same `#roomId`
- owner imports a real video file
- remote peer receives metadata first and then progressive media transfer
- remote peer reaches partial progress before completion
- remote peer ends with `ready` transfer and `blob:` preview/renderer URL
- mixed-engine 2-peer matrix is covered for Firefox main <-> Edge client in both directions
- mixed-engine 2-peer matrix is covered for client-owned imports from Firefox -> Edge main and Edge -> Firefox main
- mixed-engine 3-peer relay is covered for Firefox main / Edge owner / Firefox late joiner
- mixed-engine 3-peer relay is covered for Firefox main / Edge owner / Edge late joiner
- mixed-engine 3-peer relay is covered for Edge main / Firefox owner / Edge late joiner
- mixed-engine 3-peer relay is covered for Edge main / Firefox owner / Firefox late joiner

## Definition of Done

### State

- `[x]` same `#roomId` syncs project state across devices
- `[x]` project patches never contain binary data
- `[x]` out-of-order/duplicate patches do not corrupt project state

### Media

- `[x]` remote resource appears before bytes arrive
- `[x]` progress updates as chunks arrive
- `[x]` preview tries HEAD before full download
- `[x]` seek requests playhead ranges
- `[x]` full transfer reconstructs identical bytes

### Resilience

- `[x]` signaling retry handles proxy tunnel close before room-state
- `[x]` WebRTC disconnect watchdog triggers recovery
- `[x]` server tab failover works with 2 and 3 peers
- `[x]` renderer/export do not crash on missing or partial resources

### Practicality

- `[x]` no video repackaging in the first implementation
- `[x]` binary cache is outside Legend/domain state
- `[x]` old Blob URLs are revoked
- `[x]` memory cap prevents unbounded chunk retention

## TL;DR

1. State sync remains on the existing authority channel; media now uses a separate raw DataChannel.
2. Imported files stay local to the owner and are served as chunked byte ranges from an out-of-state cache.
3. Remote peers reconstruct progressive Blob URLs, expose progress in UI, and can preview before full download.
4. Scheduler logic now supports HEAD-first fetch, TAIL fallback, and playhead window requests.
5. Unit and browser tests now prove the media path end-to-end.