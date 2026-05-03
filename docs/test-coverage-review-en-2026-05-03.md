# MiniCut Test Coverage Review - 2026-05-03

## Table of Contents
- [1. Coverage Scope](#1-coverage-scope)
- [2. Data Model and Project Editing Coverage](#2-data-model-and-project-editing-coverage)
- [3. Export and Rendering Coverage](#3-export-and-rendering-coverage)
- [4. WebRTC/P2P Coverage](#4-webrtcp2p-coverage)
- [5. Browser-Level Render and P2P Integration Tests](#5-browser-level-render-and-p2p-integration-tests)
- [6. ffmpeg/ffprobe Validation Strategy](#6-ffmpegffprobe-validation-strategy)
- [7. Gaps and Prioritized Improvements](#7-gaps-and-prioritized-improvements)
- [8. Key Test Files](#8-key-test-files)

## 1. Coverage Scope

This review focuses on:
- Business model correctness and project editing invariants.
- Render/export correctness and artifact quality.
- WebRTC/P2P behavior under role changes, reconnects, and large media transfer.
- Browser-level integration behavior for render and collaboration.
- Media artifact validation using `ffmpeg`/`ffprobe`.

## 2. Data Model and Project Editing Coverage

Strong coverage exists for command validation and graph invariants:
- Command validation and safety checks.
- Timeline operation invariants (`add/move/split/delete/trim` semantics).
- Randomized command-sequence stability checks.
- Patch consistency checks (immutable apply vs in-place apply).

What this gives confidence in:
- Graph integrity (entity references and relation coherence).
- Clip/resource consistency (duration, in-point, track targeting constraints).
- Behavioral stability under many edit sequences.

Representative files:
- `validateCommand.test.ts`
- `timelineInvariants.test.ts`
- `randomCommandInvariants.test.ts`
- `resourceData.test.ts`
- `applyPatch` / patch pipeline tests

## 3. Export and Rendering Coverage

Export and rendering are covered on multiple levels:
- Unit tests for manifest export structure and frame-level operation generation.
- Browser integration tests that produce real export artifacts.
- Audio and video quality checks on generated files.

Export backends covered:
- `WebCodecs` path.
- `MediaRecorder` fallback path.
- JSON manifest fallback path.

Behavior covered includes:
- Clip range export and project range export.
- Keyframes, fades, transforms, opacity and effect operations.
- Mixed media timelines (video/image/audio) including linked audio behavior.

Representative files:
- `src/video-editor/render/exportRenderer.test.ts`
- `tests/integration/export-audio-artifacts.spec.ts`

## 4. WebRTC/P2P Coverage

P2P coverage is broad and practical:
- Session role establishment (`server/client`) and state sync.
- Leader failover and continued room writability.
- Reconnect and late-join synchronization behavior.
- Client-owned media and relay through current authority peer.
- Large-chunk transfer reliability across mixed browser engines.
- Progressive preview strategy (head/window/tail/sequential) behavior.

Specific robustness topics covered:
- Cross-browser DataChannel size constraints and fragmentation/reassembly.
- Recovery after disconnect and transport reattachment.
- Convergence of project state and media availability across peers.

Representative files:
- `tests/integration/p2p-state-sync.spec.ts`
- `tests/integration/p2p-failover.spec.ts`
- `tests/integration/p2p-media-transfer.spec.ts`
- `tests/integration/p2p-media-transfer-reconnect.spec.ts`
- `tests/integration/p2p-client-owned-media.spec.ts`
- `tests/integration/p2p-media-large-chunk-transfer.spec.ts`
- `tests/integration/p2p-playhead-window-scrub.spec.ts`
- `tests/integration/p2p-large-preview-strategy.spec.ts`
- `tests/integration/p2p-mixed-engine-media.spec.ts`

## 5. Browser-Level Render and P2P Integration Tests

Render/browser integration:
- Playwright tests execute export operations from the real UI.
- Produced artifacts are downloaded and then analyzed for stream-level correctness and signal quality.

P2P/browser integration:
- Multi-context Playwright scenarios simulate independent peers.
- Role election, synchronization, failover, reconnect, and media transfer paths are verified end-to-end.
- Mixed browser engine scenarios improve confidence in interoperability.

## 6. ffmpeg/ffprobe Validation Strategy

`ffmpeg` and `ffprobe` are used in integration tests to validate real media artifacts:
- `ffprobe` inspects stream/container metadata (duration, codecs, channels, dimensions).
- `ffmpeg` decodes audio to PCM for RMS/peak/frequency-window analysis.
- Video frame sampling utilities validate rendered frame pixels and expected visual properties.

This moves verification beyond UI-state assertions to artifact-level correctness.

Representative utility:
- `tests/integration/audio-analysis.ts`

## 7. Gaps and Prioritized Improvements

Current strengths are significant, but a few expansion areas remain:

P0:
- Add explicit stress tests for very long timelines and high clip counts.
- Add explicit memory and timing thresholds in CI for export and P2P transfer scenarios.

P1:
- Extend fallback parity checks (`MediaRecorder` vs `WebCodecs`) across more effect combinations.
- Add additional browser matrix runs where feasible (especially Safari/WebKit constraints if target platform requires it).

P2:
- Add generated combinatorial project fixtures for broader automatic scenario exploration.
- Add long-run soak tests for repeated join/leave and repeated export cycles.

## 8. Key Test Files

Business model and editing:
- [src/video-editor/domain/validateCommand.test.ts](../src/video-editor/domain/validateCommand.test.ts)
- [src/video-editor/domain/timelineInvariants.test.ts](../src/video-editor/domain/timelineInvariants.test.ts)
- [src/video-editor/domain/randomCommandInvariants.test.ts](../src/video-editor/domain/randomCommandInvariants.test.ts)
- [src/video-editor/domain/resourceData.test.ts](../src/video-editor/domain/resourceData.test.ts)

Render/export tests:
- [src/video-editor/render/exportRenderer.test.ts](../src/video-editor/render/exportRenderer.test.ts)
- [tests/integration/export-audio-artifacts.spec.ts](../tests/integration/export-audio-artifacts.spec.ts)

P2P/WebRTC tests:
- [src/video-editor/p2p/P2PAuthorityAdapter.test.ts](../src/video-editor/p2p/P2PAuthorityAdapter.test.ts)
- [tests/integration/p2p-state-sync.spec.ts](../tests/integration/p2p-state-sync.spec.ts)
- [tests/integration/p2p-failover.spec.ts](../tests/integration/p2p-failover.spec.ts)
- [tests/integration/p2p-media-transfer.spec.ts](../tests/integration/p2p-media-transfer.spec.ts)
- [tests/integration/p2p-media-transfer-reconnect.spec.ts](../tests/integration/p2p-media-transfer-reconnect.spec.ts)
- [tests/integration/p2p-client-owned-media.spec.ts](../tests/integration/p2p-client-owned-media.spec.ts)
- [tests/integration/p2p-media-large-chunk-transfer.spec.ts](../tests/integration/p2p-media-large-chunk-transfer.spec.ts)
- [tests/integration/p2p-playhead-window-scrub.spec.ts](../tests/integration/p2p-playhead-window-scrub.spec.ts)
- [tests/integration/p2p-large-preview-strategy.spec.ts](../tests/integration/p2p-large-preview-strategy.spec.ts)
- [tests/integration/p2p-mixed-engine-media.spec.ts](../tests/integration/p2p-mixed-engine-media.spec.ts)

Artifact analysis utilities:
- [tests/integration/audio-analysis.ts](../tests/integration/audio-analysis.ts)

Related docs:
- [docs/architecture-review-en-2026-05-03.md](architecture-review-en-2026-05-03.md)
- [docs/business-logic-data-flow-en-2026-05-03.md](business-logic-data-flow-en-2026-05-03.md)
