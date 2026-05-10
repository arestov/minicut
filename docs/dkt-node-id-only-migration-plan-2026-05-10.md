# DKT Node ID Only Migration Plan (2026-05-10)

## Goal

Move MiniCut to a strict single-identity model:

- Canonical identity everywhere is DKT `_node_id`.
- No internal `source*Id` usage in models, UI, render/export, transfer lookup.

Target:

- `selectedEntityId` stores clip `_node_id`.
- `activeProjectId` stores project `_node_id`.
- `PreviewClipSource.id` is clip `_node_id`.
- `PreviewClipSource.resourceId` is resource `_node_id`.
- `ExportPlan.projectId` is project `_node_id`.
- `ExportRange.clipId` is clip `_node_id`.
- `resourceTransferManager` keys by resource `_node_id`.
- Remove `sourceProjectId/sourceTrackId/sourceResourceId/sourceClipId/sourceTextId/sourceEffectId/sourceResourceName`.

## Phase 0: Safety Tests Before Migration

Add/strengthen tests before touching identity plumbing.

Files:

- `src/video-editor/dkt/models/project-graph-invariants.test.ts`
- `tests/integration/video-editor.spec.ts`

Add assertions:

- Every clip has rel `track`.
- Media clip has rel `resource`.
- Text clip has rel `text`, and text has rel `clip`.
- Effect has rel `clip`.
- `clipRenderData.id === clip._node_id`.
- `clipRenderData.resourceId === resource._node_id`.

Pre-migration smoke runs:

```powershell
npm run test:video-editor -- --run src/video-editor/dkt/models/project-graph-invariants.test.ts
npx playwright test tests/integration/video-editor.spec.ts --grep "export project button|preview keeps offscreen"
```

## Phase 1: Creation Shapes and Attrs Cleanup

Files:

- `src/video-editor/models/Project.ts`
- `src/video-editor/models/Track.ts`
- `src/video-editor/models/Resource.ts`
- `src/video-editor/models/Clip.ts`
- `src/video-editor/models/Text.ts`
- `src/video-editor/models/Effect.ts`
- `src/video-editor/ui/dkt/shapes.ts`
- `src/video-editor/dkt/runtime/seedTypes.ts`

Changes:

- Remove `source*Id` and `sourceResourceName` from attrs and creation shapes.
- Keep only functional attrs.
- This phase should be done together with rel-first action migration (Phase 2) to avoid temporary breakage.

## Phase 2: Rel-First Model Creation

Files:

- `src/video-editor/models/Project/actions.ts`
- `src/video-editor/models/Track/actions.ts`
- `src/video-editor/models/Clip/actions.ts`
- `src/video-editor/models/AppRoot/actions.ts`

Changes:

- `normalize*CreationAttrs` no longer require/generate `source*Id`.
- `Project.importResource` creates resource model and links it via rels.
- `Track.addClip` creates clip and links `clip.track` and `clip.resource` (when media).
- `Track.addTextClip` creates both nodes and links `clip.text`, `text.clip`, `clip.track`.
- `Clip.addEffect` keeps `effect.clip = self`.
- `Clip.splitSelfAt` does not generate synthetic clip source IDs.

Split behavior:

- Media split: right clip links same resource node.
- Text split: create separate text node copy for right clip.

## Phase 3: Selection and Active Project on Node IDs

Files:

- `src/video-editor/models/SessionRoot.ts`
- `src/video-editor/models/SessionRoot/actions.ts`
- `src/video-editor/models/SessionRoot/comps.ts`
- `src/video-editor/components/ClipItem.tsx`
- `src/video-editor/components/ProjectDropdown.tsx`
- `src/video-editor/components/TimelineView.tsx`
- `src/video-editor/components/Inspector.tsx`
- `src/video-editor/components/inspector/InspectorExportTabPanel.tsx`

Changes:

- `selectedEntityId` stores clip node id.
- `activeProjectId` stores project node id.
- `selectedClip` resolves by node id, not by `sourceClipId`.
- `ProjectDropdown` switches by project node id.
- Export actions use selected clip node id.
- `addTextClipToTimeline` selects created clip by created ref/node id.

## Phase 4: Read-Model and Render Plan Migration

Files:

- `src/video-editor/models/Clip/comps.ts`
- `src/video-editor/models/Project/comps.ts`
- `src/video-editor/read-model/previewComps.ts`
- `src/video-editor/render/renderPlan.ts`
- `src/video-editor/render/previewRenderPlan.ts`
- `src/video-editor/render/exportRange.ts`
- `src/video-editor/render/frameRenderer.ts`

Changes:

- `clipRenderData.id` comes from clip node id.
- `clipRenderData.resourceId` comes from resource rel node id.
- Text/render attrs come via rels only.
- Remove source-id based hydration paths such as string-key joins.
- Export/render ops continue to use IDs, but those are node IDs from model output.

## Phase 5: Import and Resource Transfer Node-ID Alignment

Files:

- `src/video-editor/app/importFilesTaskExecutor.ts`
- `src/video-editor/app/createVideoEditorHarness.ts`
- `src/video-editor/components/MediaBin.tsx`
- `src/video-editor/media/resourceTransferManager.ts`
- `src/video-editor/media/resourceTransferScheduler.ts`
- `src/video-editor/p2p/P2PAuthorityAdapter.ts`
- `src/video-editor/p2p/PageP2PManager.ts`

Changes:

- Import task does not generate `sourceResourceId`.
- After `importResource`, obtain created resource node id and register transfer with it.
- `resourceTransferManifest` publishes `{ resourceId: <resource_node_id>, attrs }`.
- `MediaBin` passes resource node id/ref into `addResourceToTimeline`.
- `Project.addResourceToTimeline` accepts node/ref target, no source-id lookup.

## Phase 6: Debug Bridge, Harness, and Headless Adaptation

Files:

- `src/video-editor/app/testing/installMiniCutDebugBridge.testing.ts`
- `src/video-editor/node/headlessScenario.ts`
- `src/video-editor/dkt/runtime/createMiniCutDktRuntime.testing.ts`
- `test/repl/stateInspect.testing.ts`

Changes:

- Debug dumps expose node ids as identity.
- Replace source-id helpers (`findBySourceId/readSourceIds/...`) with node-id and rel-based helpers.
- Update headless/debug payload contracts to node-id identity.

## Phase 7: Test Suite Rewrite to Node IDs

Core files:

- `src/video-editor/dkt/models/action-contract-test-harness.ts`
- `src/video-editor/dkt/test/projectGraphAssertions.ts`
- `src/video-editor/dkt/models/session-root-action-contracts.test.ts`
- `src/video-editor/dkt/models/project-track-action-contracts.test.ts`
- `src/video-editor/dkt/models/clip-action-contracts.integration.test.ts`
- `src/video-editor/dkt/models/track-clip-rel.test.ts`
- `src/video-editor/dkt/models/split-clip-saga.test.ts`
- `src/video-editor/dkt/models/addResourceToTimeline-appendStart.test.ts`
- `src/video-editor/dkt/runtime/createMiniCutDktRuntime.splitSelfAt.test.ts`
- `src/video-editor/dkt/runtime/createMiniCutDktRuntime.exportRequest.test.ts`
- `src/video-editor/components/renderTreeActionWiring.test.tsx`

Changes:

- Remove all source-id assumptions from payloads/assertions.
- Assert rel and node-id correctness.
- For deterministic selection in tests, use explicit node references from created model refs.

## Phase 8: Remove Legacy Source-ID Code Paths

After tests are green:

- Remove source-id helper functions and action branches.
- Remove source-id attrs from any remaining model definitions.
- Remove source-id references from runtime/test utilities.

Validation gate:

```powershell
rg -n "source(Project|Track|Resource|Clip|Text|Effect)Id|sourceResourceName" src tests
```

Expected:

- No matches in production code.
- Test fixtures/docs may keep historical mentions only if explicitly marked legacy.

## Phase 9: Execution and Full Verification

Fast local targeted:

```powershell
npm run test:video-editor -- --run src/video-editor/models
npm run test:video-editor -- --run src/video-editor/dkt
npm run test:video-editor -- --run src/video-editor/render
npm run test:video-editor -- --run src/video-editor/media
```

Full unit:

```powershell
npm run test:video-editor
npm run test:video-editor:node
```

Guard and build:

```powershell
npm run guard:dkt-hard
npm run video-editor:build
```

Integration:

```powershell
npm run test:integration:fast
npm run test:integration:p2p:smoke
npm run test:integration:p2p:slow
npm run test:integration:export
npm run test:integration:profile
```

Final full run:

```powershell
npm run test
npm run test:integration
npm run video-editor:build
```

## Recommended Implementation Order

1. Add rel/node-id invariants tests.
2. Migrate model attrs and creation shapes.
3. Migrate Project/Track/Clip creation to rel-first.
4. Migrate session selection/active project to node ids.
5. Migrate read-model and render/export plans.
6. Migrate import and resource transfer keys.
7. Update debug bridge and harness utilities.
8. Rewrite contract/runtime/integration tests.
9. Remove all `source*Id` code.
10. Run full test and build matrix.

## Highest-Risk Area

Critical path is:

- `importResource` creation flow
- extracting created resource node id reliably
- registering transfer by that node id
- preserving preview/export behavior and media correctness

Implement and validate this path early; many downstream phases depend on it.
