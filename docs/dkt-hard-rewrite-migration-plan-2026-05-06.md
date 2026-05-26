# MiniCut DKT hard rewrite migration plan

Date: 2026-05-06

This is the replacement plan for all older DKT, Legend, registry, and render-tree migration plans.

The migration is intentionally hard. Phase 1 deletes the old running contour first. The app may be temporarily broken after that deletion. The next phases rebuild the editor as pure DKT, as if no registry bridge ever existed.

## 1. Target design

MiniCut should have exactly one running source-of-truth contour:

```text
UI event
  -> scoped DKT action or DKT task
  -> DKT model attrs/rels/comp attrs/comp rels/effects
  -> page sync stream
  -> React top-down traversal through attrs/rels/path
```

The allowed boundary types are:

- DKT state: model attrs, input rels, model rels, comp attrs, comp rels.
- DKT actions: synchronous state transitions and inline sagas.
- DKT tasks/effects/DI: browser files, object URLs, media probes, P2P, export, workers, storage, network.
- React render: `useAttrs`, `One`, `Many`, `Path`, `useActions`, scoped props.
- Pure helpers: math and normalization functions called with explicit DKT-provided data.

Everything else is outside the target contour. In particular, `ProjectRegistry`, `projects$`, `session$`, command envelopes, snapshot patches, legacy authority state, debug graph traversal, and compatibility render runtimes must not run the editor.

The Weather reference proves the shape: UI starts at `pioneer`, traverses rels with `One`/`Many`, and reads compact attrs in scoped components. Model-level comp attrs like `temperatureText`, `summary`, `hourlySparkline`, and `weatherUpdatedSummary` prepare view data before React sees it. Actions like `AppRoot.handleInit`, `WeatherLocation.applyWeather`, and router inline subwalkers keep workflows inside DKT.

The Linkkraft reference confirms the same rule in older DKT view style: `SessionRootView` exposes `pioneer`, routers expose comp attrs/comp rels for view state, and `MainNavigation.runQuery` uses `$output` and `inline_subwalker` instead of app-layer dispatch/read chains.

## 2. Render tree schema

The render tree is an explicit DKT traversal contract. Every relation below must be delivered by DKT owner rels or comp rels, not root rel scans or source-id lookup.

### 2.1 Session root

Scope: `SessionRoot` streamed to React, with app model available through `pioneer`.

Read attrs at this level:

- `cursor`
- `isPlaying`
- `timelineZoom`
- `activeInspectorTab`
- `activeTool`
- `selectionKind`
- compact import/export/task statuses
- compact preview playback status

Traverse rels:

- `pioneer` -> app/project container scope
- `activeProject` -> current `Project`
- `selectedTrack`
- `selectedClip`
- `selectedResource`
- `selectedText`
- `selectedEffect`

Needed comp attrs/rels:

- `selectionKind`: derived from selected rels.
- `selectedEntitySummary`: compact display summary for inspector header.
- `previewPlaybackState`: cursor/playback/active project status only.
- `activeProject`: rel set by project creation/open action.

Pass down as props:

- Presentation-only props such as panel collapsed state if they are local UI state.
- Scoped action callbacks already bound to the session scope.

Do not pass down registry objects, source ids for later lookup, or session mirrors from Legend.

### 2.2 Project

Scope: `Project`, reached from `SessionRoot.activeProject` or `pioneer.project` where a project list is needed.

Read attrs:

- `sourceProjectId` only if required for display/export identity, not traversal.
- `title`
- `duration`
- `timelineDuration`
- `timelineSummary`
- `resourceSummary`
- `previewFrame`
- `exportPlanStatus`

Traverse rels:

- `tracks`
- `visibleTracks`
- `resources`
- `timelineClips`
- `activeVisualClips`
- `activeAudioClips`
- `selectedProjectEntity` if project-local inspector grouping is useful.

Needed comp attrs:

- `timelineDuration`: max track/clip end.
- `timelineSummary`: compact counts and duration text.
- `resourceSummary`: counts by media kind and transfer readiness.
- `previewFrame`: compact current-frame render data derived from active clip rels.
- `exportPlan`: serializable plan for export effect.

Needed comp rels:

- `visibleTracks`: filtered `tracks`.
- `timelineClips`: flattened ordered clip rel from all tracks.
- `activeVisualClips`: visual clips intersecting `SessionRoot.cursor`.
- `activeAudioClips`: audio clips intersecting `SessionRoot.cursor`.

Pass down as props:

- Track presentation options such as lane height.
- Project-level scoped dispatch callbacks.

Do not derive timeline order or active clips in React.

### 2.3 Track

Scope: `Track`, reached from `Project.tracks` or `Project.visibleTracks`.

Read attrs:

- `sourceTrackId`
- `kind`
- `name`
- `color`
- `isMuted`
- `isLocked`
- `isVisible`
- `trackDuration`
- `clipCount`
- `laneRenderState`

Traverse rels:

- `clips`
- `visibleClips`
- `selectedClipInTrack`

Needed comp attrs:

- `trackDuration`: max clip end for this track.
- `clipCount`: count from `clips`.
- `laneRenderState`: compact UI flags from locked/muted/visible and selection.

Needed comp rels:

- `visibleClips`: filtered `clips`.
- `clipsByStart`: sorted if DKT rel ordering is not enough.

Pass down as props:

- Pixel scale and layout constants from timeline viewport.

Do not use app helpers like `getVideoTrack` or `getAudioTrack` in UI/action code. Track choice belongs to `Project` actions/comp attrs.

### 2.4 Clip

Scope: `Clip`, reached from `Track.clips`, `Project.timelineClips`, or active clip comp rels.

Read attrs:

- `sourceClipId`
- `kind`
- `start`
- `duration`
- `trimStart`
- `trimEnd`
- `playbackRate`
- `opacity`
- `volume`
- `transform`
- `crop`
- `colorAdjustments`
- `renderInterval`
- `renderBox`
- `renderMedia`
- `renderText`
- `renderAudio`

Traverse rels:

- `resource`
- `text`
- `effects`
- `visibleEffects`
- `track` if child model logic needs parent context.
- `project` if clip-level effects need project context.

Needed comp attrs:

- `renderInterval`: normalized start/end and trim math.
- `renderBox`: transform/crop/layout for stage.
- `renderMedia`: resource-backed render input.
- `renderText`: text-backed render input.
- `renderAudio`: audio render input.
- `effectStackSummary`: compact ordered effect chain.

Needed comp rels:

- `visibleEffects`: enabled effects in order.
- `track` and `project` context rels only if model actions need them.

Pass down as props:

- Timeline pixel scale and selection presentation.

Do not resolve resource/text/effect by source-id lookup. The rel exists or the model action is incomplete.

### 2.5 Resource

Scope: `Resource`, reached from `Project.resources` or `Clip.resource`.

Read attrs:

- `sourceResourceId`
- `kind`
- `name`
- `duration`
- `width`
- `height`
- `hasAudio`
- `objectUrl`
- `transferStatus`
- `dataStatus`
- `importError`
- `mediaSummary`

Traverse rels:

- `project` if resource actions need project context.
- optional `clipsUsingResource` comp rel if resource panel needs usage.

Needed comp attrs:

- `mediaSummary`: compact UI/export media shape.
- `canAddToTimeline`: based on readiness and project context.

Needed comp rels:

- `clipsUsingResource`: for media bin usage display, not for timeline traversal.

### 2.6 Text

Scope: `Text`, reached from `Clip.text`.

Read attrs:

- `sourceTextId`
- `content`
- `fontFamily`
- `fontSize`
- `fontWeight`
- `color`
- `backgroundColor`
- `box`
- `alignment`
- `textRenderState`

Needed comp attrs:

- `textRenderState`: compact style object for stage/export.

### 2.7 Effect

Scope: `Effect`, reached from `Clip.effects` or `Clip.visibleEffects`.

Read attrs:

- `sourceEffectId`
- `kind`
- `enabled`
- `order`
- effect-specific parameters
- `effectRenderState`

Needed comp attrs:

- `effectRenderState`: compact serializable effect input.

Needed comp rels:

- `clip` and `project` context only when effect model logic needs them.

## 3. Phase 1: total deletion of non-DKT running contour

Goal: remove the old contour before rebuilding. This phase is allowed to break tests and screens.

### 3.1 Delete registry runtime truth

Files to remove or strip:

- `src/video-editor/render-sync/projectRegistryFromPageRuntime.ts`: delete. It is a registry-shaped compatibility projection.
- `src/video-editor/render-sync/createDktEditorRenderRuntime.ts`: delete if no pure test-only use remains.
- `src/video-editor/render-sync/DktRegistryRenderStore.ts`: delete.
- `src/video-editor/dkt/runtime/previewModelFromRegistry.ts`: remove from runtime use; keep only pure math helpers elsewhere if needed.
- `src/video-editor/dkt/runtime/createMiniCutDktRuntime.ts`: remove `createRegistryFromModelTree`, `getRegistryState`, `replaceRegistryState`, `dispatchCommand`, `syncSessionDerivedState`, and registry materialization helpers.

Expected breakage: import/export/harness tests that call snapshot or command APIs fail. That is acceptable.

### 3.2 Delete legacy message protocol from DKT path

Files to strip:

- `src/video-editor/dkt/shared/messageTypes.ts`: remove `DISPATCH_COMMAND`, `GET_SNAPSHOT`, `REPLACE_SNAPSHOT`, `SNAPSHOT`, `PATCHES`, `DISPATCH_RESULT`, and legacy registry unions.
- `src/video-editor/worker/dktSharedWorkerClient.ts`: remove snapshot/command methods from the DKT client.
- `src/video-editor/worker/sharedWorker.ts`, `sharedWorkerClient.ts`, `memoryWorker.ts`, `fallbackAuthorityClient.ts`: remove DKT editor dependency on snapshot/patch authority. If these files still serve non-DKT legacy tests, isolate them outside the running DKT harness.
- `src/video-editor/worker/authorityClient.ts`: remove snapshot/command requirements from the DKT editor authority interface.

Expected breakage: old worker authority tests fail until rewritten around DKT sync/action messages.

### 3.3 Cut `createVideoEditorHarness.ts`

Target rewrite:

- Remove `createProjectsStore`, `createSessionStore`, `createPlaybackDuration$`, and returned `projects$`/`session$` from the running harness.
- Remove `readDktRegistryView`, `resolveActiveProjectId`, `syncActiveProjectSelection`, and registry sync calls.
- Remove all `findProjectScope`, `findTrackScope`, `findResourceScope`, `findClipScope`, `findTextScope`, `findEffectScope` source-id lookup helpers.
- Remove all `dispatch*Action` fallback branches that call local `createMiniCutDktRuntime` after page scope lookup fails.
- Replace the `dkt` port with scoped dispatch primitives that receive a `ReactSyncScopeHandle` from the current component or a known session/project root scope.
- Remove `authority.getSnapshot`, `stores.getRegistry`, `applySnapshot`, and `applyPatchEnvelope` from `EditorActionEnvironment` for running app code.
- Keep only platform ports, task facade, resource transfer boundary, export renderer boundary, page runtime bootstrap, and DKT dispatch/task ports.

Expected breakage: app action factories that expect registry/session stores fail. Those factories are rewritten in later phases.

### 3.4 Cut action runtime compatibility

Files to strip or delete:

- `src/video-editor/app/createDktActionRuntime.ts`: remove command-envelope dual dispatch and registry reads.
- `src/video-editor/app/mediaImportActions.ts`: remove registry decisions. It may remain only as an event-to-DKT-task adapter.
- `src/video-editor/app/exportActions.ts`: remove registry clone/patch export path.
- `src/video-editor/app/editorActionEnvironment.ts`: remove state ports; keep platform/task/effect boundary ports.
- `src/video-editor/domain/actionCommandBuilders.ts`: remove from running app imports.

Expected breakage: UI buttons that still call old action factories fail until rebound to scoped DKT actions/tasks.

### 3.5 Rewrite tests as behavior contracts or leave visibly broken

Do not preserve tests by adding compatibility APIs.

For tests that currently set `harness.projects$` or call registry snapshots:

1. Add a top comment describing the user behavior, for example: `Behavior contract: importing a video creates a Resource and one timeline Clip when the timeline is empty.`
2. Remove assertions that mention registry, Legend store structure, command patch envelopes, or snapshot shape.
3. If no pure DKT setup exists yet, leave the test skipped or failing with a TODO that points to the phase that will rebuild it.

Primary test files to revisit:

- `src/video-editor/app/createVideoEditorHarness.test.ts`
- `src/video-editor/dkt/runtime/createMiniCutDktRuntime.test.ts`
- `src/video-editor/render-sync/createDktEditorRenderRuntime.test.ts`
- `src/video-editor/render-sync/createDktPageEditorRenderRuntime.test.ts`
- `src/video-editor/tests/video-editor.happy-path.test.tsx`
- `tests/integration/video-editor.spec.ts`

Phase 1 exit criteria:

- No running app import of `ProjectRegistry`, `projects$`, `session$`, legacy render runtime, registry store, snapshot API, command envelope, or source-id graph lookup remains.
- The build may fail only where code has not yet been rebuilt as DKT. Failures should point at missing DKT contracts, not missing compatibility helpers.

## 4. Phase 2: rebuild DKT model ownership

Goal: create the domain tree as DKT models with owner rels and compact derived attrs.

### 4.1 `AppRoot.ts`

Keep only root model construction and session/project reachability.

Required rels:

- `$session_root`, `common_session_root`, `sessions`, `free_sessions`.
- root-routed creation rels if DKT requires them: `project`, `track`, `resource`, `clip`, `text`, `effect`.

Required comp rels:

- `pioneer`/root parent rel equivalent if needed for page traversal.

Required action changes:

- Keep model creation actions only if they create real DKT models and do not materialize registry.
- Remove any action whose payload is registry-shaped.

### 4.2 `SessionRoot.ts` and `SessionRoot/actions.ts`

Attrs:

- `cursor`, `isPlaying`, `timelineZoom`, `activeInspectorTab`, `activeTool`.
- task status attrs for import/export if session-owned.

Rels:

- `activeProject`.
- `selectedTrack`, `selectedClip`, `selectedResource`, `selectedText`, `selectedEffect`.

Comp attrs:

- `selectionKind`.
- `selectedEntitySummary`.
- `previewPlaybackState`.

Actions:

- `createProject`: create a `Project`, set `activeProject`, and let `Project.handleInit` create default tracks.
- `setActiveProject`, `selectTrack`, `selectClip`, `selectResource`, `selectText`, `selectEffect`, `clearSelection`.
- `setCursor`, `setPlaying`, `setTimelineZoom`, `setActiveInspectorTab`, `setActiveTool`.

Rules:

- No session action reads registry or page runtime.
- No external `then(() => session$.activeProjectId.set(...))` after project creation.

### 4.3 `Project.ts` and `Project/actions.ts`

Attrs:

- project identity/title/settings.
- import/export status attrs.

Rels:

- `tracks`, `resources`.
- comp rels `visibleTracks`, `timelineClips`, `activeVisualClips`, `activeAudioClips`.

Comp attrs:

- `timelineDuration`, `timelineSummary`, `resourceSummary`, `previewFrame`, `exportPlan`.

Actions:

- `handleInit`: create default video/audio tracks with owner rel writes.
- `addTrack`, `removeTrack`, `reorderTracks`, `setTrackVisibility`, `setTrackMute`, `setTrackLock`.
- `importFilesRequested`: dispatch DKT task for file runtime refs if project-owned.
- `importResourceResolved`: create/update `Resource` and owner `resources` rel.
- `addResourceToTimeline`: choose track and create clip(s) in one DKT inline saga.
- `requestExport`: create export request attrs and dispatch export task.

Files likely needed:

- `src/video-editor/models/Project/derived.ts` for pure compact derivation helpers.
- `src/video-editor/models/Project/effects.ts` for import/export effects if project-owned.

### 4.4 `Track.ts` and `Track/actions.ts`

Attrs:

- track identity, kind, name, color, mute/lock/visible.

Rels:

- `clips`.
- comp rel `visibleClips`.

Comp attrs:

- `trackDuration`, `clipCount`, `laneRenderState`.

Actions:

- `addClip`: create root `clip` if required and write `clips` owner rel in the same action.
- `addTextClip`: create `clip`, create `text`, link both owner rels.
- `splitClipAt`: create replacement clip(s), preserve resource/text/effect rels, and write `clips` order in one inline saga.
- `moveClip`, `trimClip`, `resizeClip`, `reorderClips`.

Rules:

- No track action returns only root-created clips without updating `Track.clips`.
- No app action computes track choice from registry.

### 4.5 `Clip.ts`

Attrs:

- timing, trim, playback, transform, opacity, volume, crop, color attrs.

Rels:

- `resource`, `text`, `effects`.
- optional context rels `track`, `project` if needed by model logic.
- comp rel `visibleEffects`.

Comp attrs:

- `renderInterval`, `renderBox`, `renderMedia`, `renderText`, `renderAudio`, `effectStackSummary`.

Actions:

- `setTiming`, `setTrim`, `setTransform`, `setOpacity`, `setVolume`, `setColorAdjustments`.
- `setResource`, `setText` only as scoped DKT rel actions.
- `addEffect`, `removeEffect`, `reorderEffects`, `setEffectEnabled`.

### 4.6 `Resource.ts`

Attrs:

- identity, kind, name, duration, dimensions, object URL, transfer status, data status, import/export errors.

Rels:

- optional `project` context rel.
- comp rel `clipsUsingResource` if MediaBin needs usage.

Comp attrs:

- `mediaSummary`, `canAddToTimeline`, `previewAvailability`.

Actions:

- `requestAddToTimeline`: child action that routes to project/track via DKT rels/inline subwalker, not app lookup.
- `markTransferReady`, `markTransferError`, `updateObjectUrl`, `updateMetadata`.

### 4.7 `Text.ts` and `Effect.ts`

Text comp attrs:

- `textRenderState` from text content, box, font, color, alignment.

Text actions:

- `setContent`, `setStyle`, `setBox`, `setAlignment`.

Effect comp attrs:

- `effectRenderState` from effect kind and params.

Effect actions:

- `setEnabled`, `setParams`, kind-specific update actions.

## 5. Phase 3: rebuild React as top-down DKT traversal

Goal: remove old action/runtime props and make components scoped.

Files to rewrite:

- `src/video-editor/components/VideoEditorHarnessApp.tsx`
- `src/video-editor/components/PreviewPanel.tsx`
- timeline components under `src/video-editor/components`.
- Media bin, inspector, effect, text, and export panels.

Required components:

- `SessionRootView`: mounts root shape, reads session attrs, traverses `activeProject`.
- `ProjectView`: reads project compact attrs and renders timeline/media/preview panels.
- `TrackList`/`TrackRow`: `Many rel="tracks"`, local track attrs.
- `ClipItem`: scoped clip attrs and rels.
- `MediaBin`: `Many rel="resources"`, resource scoped attrs/actions.
- `Inspector`: `Path` or selected rel traversal from session to selected model.
- `PreviewStage`: reads `Project.previewFrame` or traverses `activeVisualClips`/`activeAudioClips`.

Rules:

- Components dispatch actions via current DKT scope.
- Components receive domain data through attrs/rels, not registry props.
- Shape declarations live near components, following Weather `shapeOf`/`defineShape` style if this repo keeps that API.

## 6. Phase 4: rebuild import, P2P, export as DKT tasks/effects

Goal: boundary code performs external work only, then reports back into DKT.

Import flow:

```text
MediaBin drop/input
  -> dispatchTask('$fx_importFiles', runtimeRef(File[]), project scope)
  -> effect creates object URLs, probes duration/dimensions/audio, registers P2P transfer
  -> dispatchAction('importResourceResolved', serializable resource attrs)
  -> Project action creates Resource and maybe Clip(s)
```

P2P flow:

```text
Resource transfer event
  -> DKT task/effect boundary
  -> Resource action updates transfer attrs/data readiness
  -> render/export reads Resource attrs
```

Export flow:

```text
Project.requestExport
  -> Project.exportPlan comp attr is ready
  -> dispatchTask('$fx_renderExport', exportPlan)
  -> effect renders Blob/object URL
  -> Project export action records status/result/error
```

Files to rewrite:

- `src/video-editor/app/runtimeTaskFacade.ts` only as runtime-ref/task plumbing.
- `src/video-editor/app/mediaImportActions.ts` into a tiny event adapter or delete.
- `src/video-editor/app/exportActions.ts` into DKT task dispatch or delete.
- `src/video-editor/media/resourceTransferManager.ts` as boundary service only; it must not sync registry.
- export renderer code remains platform effect code and consumes DKT export plans.

## 7. Phase 5: rebuild tests around DKT contracts

Unit tests:

- Model action tests for `SessionRoot.createProject`, `Project.handleInit`, `Project.importResourceResolved`, `Project.addResourceToTimeline`, `Track.addClip`, `Track.splitClipAt`, `Clip.addEffect`.
- Comp attr tests for timeline duration, preview frame, export plan, selected summary.
- DKT React Sync tests proving late rel delivery, stable attrs, shape mounting, `One`/`Many`/`Path` traversal.

Harness/component tests:

- Boot creates active project through DKT session action.
- Importing media creates `Resource` and timeline `Clip` through DKT task completion.
- Timeline edit buttons dispatch scoped DKT actions.
- Preview reads DKT comp attrs/rels.
- Export consumes DKT export plan.

Integration tests:

- Browser import/edit/preview/export path with no registry or command snapshot helpers.
- P2P transfer path where transfer status appears as Resource attrs.

Test rewrite rule:

- Test setup dispatches DKT actions/tasks only.
- Assertions inspect UI behavior or page runtime attrs/rels only.
- No direct mutation of `projects$`, no `getSnapshot`, no command patches.

## 8. Phase 6: cleanup and guardrails

Add static guard checks after phase 1 deletion:

- fail if running app imports `ProjectRegistry` outside pure type removal migration.
- fail if running app imports `createProjectsStore` or `createSessionStore`.
- fail if running app references `GET_SNAPSHOT`, `REPLACE_SNAPSHOT`, `DISPATCH_COMMAND`, `PATCHES`, `DISPATCH_RESULT`.
- fail if render path references `legacyRuntime`, `DktRegistryRenderStore`, `createDktEditorRenderRuntime`, `debugDumpGraph`, or `debugDescribeNode`.
- fail if app action path calls `authority.dispatch` for editor state.

Keep postmortem docs, but all active planning should point to this plan plus:

- `docs/dkt-hard-rewrite-anti-patterns-2026-05-06.md`
- `docs/dkt-hard-rewrite-target-instructions-2026-05-06.md`

## 9. First implementation checklist

Start with this exact order:

1. Delete old plan docs and keep postmortems.
2. Delete registry projection files and legacy render runtime files.
3. Strip DKT shared messages down to sync/action/task messages only.
4. Rewrite `EditorAuthorityClient` and DKT worker clients so snapshot/command methods disappear from the DKT path.
5. Rewrite `createVideoEditorHarness.ts` so it no longer constructs `projects$`, `session$`, or registry views.
6. Replace app action environment with platform/task ports and scoped DKT dispatch only.
7. Mark old registry-based tests as behavior contracts or skip/fail them with DKT rebuild TODOs.
8. Implement `SessionRoot.createProject` and `Project.handleInit` as the first pure DKT happy path.
9. Implement project/track/clip owner rel actions.
10. Rebuild render components around `One`, `Many`, `Path`, and `useAttrs`.

The key acceptance criterion for the first real green slice is small:

```text
boot -> SessionRoot.createProject -> Project.handleInit creates tracks -> React traverses activeProject/tracks -> no registry exists in the path
```

Only after that should import, clip editing, preview, export, and P2P be rebuilt.