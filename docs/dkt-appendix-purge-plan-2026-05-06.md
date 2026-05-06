# DKT appendix purge plan

Date: 2026-05-06

This document supersedes all partial cleanup notes.  
It is a hard migration — no fallback, no compatibility bridge, no ceremony.

---

## 1. What is an appendix?

An appendix is any module that runs editor state outside the DKT contour.  
It appears as one of these patterns:

- a **command + dispatch loop** that mutates a `ProjectRegistry` object tree
- a **Legend observable store** (`projects$`, `session$`) mirroring DKT state
- a **source-id traversal** that searches the DKT scope graph from app-layer code instead of relying on owner rels
- a **task facade** whose caller manually resolves runtime refs and chains promises
- a **worker snapshot API** (`getSnapshot`, `replaceSnapshot`) that lets non-DKT code read or write the full registry

The target is the Weather/Linkkraft shape: every editor fact is a DKT attr, rel, or comp attr.  
Actions are declared on the owning model. Side-effects cross the boundary through DKT tasks/effects declared on the model that owns the result.

---

## 2. Appendix inventory

### 2.1 `src/video-editor/domain/` — command layer (full deletion)

| File | Purpose | Flow | Target shape |
|---|---|---|---|
| `actionCommandBuilders.ts` | Builds `Command` objects (PROJECT_CREATE, RESOURCE_IMPORT, TIMELINE_ADD_CLIP, TEXT_ADD, etc.) for the registry dispatch loop | UI gesture → builder → `Command` → worker dispatch → `ProjectRegistry` patch | Delete. Commands become DKT action payloads on the owning model (`SessionRoot.createProject`, `Project.importResource`, `Track.addClip`). |
| `actionTransactions.ts` | Defines `EditorActionTransactionStep` union (command / session / effect) and `commandStep` helper | Intermediate representation between UI actions and registry commands | Delete. Multi-step workflows become DKT inline saga arrays (`[step1, step2, ...]`) inside the owning model's `actions`. |
| `applyCommandHelpers.ts` | Entity factory functions (`createClipEntity`, `createTextClipEntity`) and patch helpers (`mergeTextAttrs`, `asClipAttrs`) called by command handlers | `Command` → handler → new `Entity` object appended to `ProjectRegistry` | Delete. Entity construction moves into the DKT model's `handleInit` + `can_create` creation shape. The registry entity shape is replaced by DKT model attrs. |
| `applyCommandDefaults.ts` | Default attr builders (`createDefaultColorCorrectionAttrs`, `createDefaultTextAttrs`) | Called from command handlers to fill entity attrs | Delete. Defaults become model-level `input` attr initial values declared in the DKT model DCL. |
| `applyPatch.ts` / `applyPatchInPlace.ts` | Apply `PatchEnvelope` to a `ProjectRegistry` in place or clone | Registry sync loop after worker dispatch | Delete. DKT page sync handles its own attr/rel delivery without a separate patch apply step. |
| `patchAppliers.ts` | `registryPatchAppliers` map: per-patch-code functions that mutate `RegistryPatchApplyState` | Worker emits `PatchEnvelope` → client deserializes → patchAppliers mutate `ProjectRegistry` | Delete. No patch envelope survives phase 1. DKT sync stream replaces it. |
| `commandHandlerRegistry.ts` | Map of `CMD.*` → handler functions | Worker `dispatch(command)` → handler lookup → returns `DispatchResult` (patches) | Delete. Worker command dispatch disappears. DKT action dispatch replaces it. |
| `clipCommandHandlers.ts` | Handlers for CLIP_UPDATE_ATTRS | Command → registry entity mutation | Delete. Becomes `Clip` model actions: `setTransform`, `setOpacity`, `setVolume`, `setColorAdjustments`, etc. |
| `effectCommandHandlers.ts` | Handlers for EFFECT_ADD/REMOVE/REORDER/UPDATE_ATTRS | Same pattern | Delete. Becomes `Effect` / `Clip.addEffect`, `Clip.removeEffect`, `Clip.reorderEffects` model actions. |
| `projectCommandHandlers.ts` | Handlers for PROJECT_CREATE, RESOURCE_IMPORT, TRACK_CREATE | Same pattern | Delete. Becomes `SessionRoot.createProject`, `Project.importResourceResolved`, `Project.addTrack` model actions. |
| `textCommandHandlers.ts` | Handlers for TEXT_ADD, TEXT_UPDATE_ATTRS | Same pattern | Delete. Becomes `Track.addTextClip`, `Text.setContent`, `Text.setStyle` model actions. |
| `timelineCommandHandlers.ts` | Handlers for TIMELINE_ADD_CLIP, MOVE, SPLIT, DELETE | Same pattern | Delete. Becomes `Track.addClip`, `Track.moveClip`, `Track.splitClipAt`, `Track.deleteClip` model actions. |
| `selectors.ts` | Registry graph traversal helpers (`getActiveProject`, `getTracks`, `getClipIdsForTrack`, `getVideoTrack`, `getAudioTrack`, etc.) | Registry lookup by entity id | Delete. DKT owner rels (`Project.tracks`, `Track.clips`) replace traversal. `getVideoTrack`/`getAudioTrack` logic belongs in a `Project` comp rel `videoTrack`/`audioTrack`. |
| `actionScope.ts` | `EditorActionScope` type (nodeId/nodeType) used to scope command builder lookups | Maps a source-id to a command scope for builder input | Delete. DKT scope handles already carry model identity. No source-id scope needed. |
| `actionRequests.ts` | `EditorActionRequest` union type (maps action name → payload type) | Used by harness `dispatch(name, payload)` dispatch trampoline | Delete. DKT model actions are dispatched by name directly on the model scope. |
| `types.ts` | `ProjectRegistry`, `Command`, `CMD`, `Patch`, `PATCH`, `MSG`, `WireMessage`, `Entity`, `ProjectGraph`, `PatchEnvelope`, and related legacy wire types | Shared across worker, domain, and app layers | **Partially keep**: retain only types needed for the P2P/network wire protocol. Delete everything registry/command/patch shaped. |
| `validateCommand.ts` | Input validation for `Command` payloads | Worker dispatch entry point | Delete together with command handlers. |
| `protocolCompatibility.ts` / `protocolVersions.ts` | Version negotiation and legacy protocol flags | Worker wire protocol handshake | Evaluate: keep only if P2P or storage wire protocol still needs version negotiation. Remove registry-specific parts. |
| `actionCommandBuilders.ts` | (see above) | (see above) | Delete. |
| `resourceData.ts` | `createMissingResourceData`, `createReadyResourceData`, `getResourceDerived` | Creates registry-compatible resource entity attrs | Delete. Resource attrs become DKT `Resource` model input attrs with defaults. |
| `id.ts` | `createEntityId()` — nanoid wrapper | Called by entity factories in command handlers | Keep as pure util if DKT model creation needs an explicit id. Otherwise inline into model creation shape. |
| `createProject.ts` | `createEmptyRegistry()` factory | Used to initialize `projectStore` observable | Delete. No empty registry needed; DKT starts with an empty model tree. |

### 2.2 `src/video-editor/dkt/state/` — Legend observable stores (full deletion)

| File | Purpose | Problem |
|---|---|---|
| `projectStore.ts` | `createProjectsStore()` — `Observable<ProjectRegistry>` + `applySnapshot` + per-patch observable appliers | Second state graph shadowing DKT. Drives React indirectly through Legend. |
| `sessionStore.ts` | `createSessionStore()` — `Observable<EditorSessionState>` (cursor, isPlaying, zoom, etc.) | Session state duplicated outside DKT. Should be `SessionRoot` model attrs. |
| `derivedTimeline.ts` | Derived observables from the project store (clip positions, track order, etc.) | Computed view state outside DKT comp attrs. |
| `observableSelectors.ts` | Legend selector helpers reading from project/session stores | App-layer derivation that belongs in DKT comp attrs. |

**Action**: delete all four files. Replace with DKT `SessionRoot` model attrs (`cursor`, `isPlaying`, `timelineZoom`, `activeInspectorTab`, `activeTool`) and `Project`/`Track`/`Clip` owner rels + comp attrs.

### 2.3 `src/video-editor/app/` — app-layer action runtime (full deletion)

| File | Purpose | Problem |
|---|---|---|
| `createDktActionRuntime.ts` | Source-id traversal functions (`findClipScope`, `findTextScope`, `findEffectScope`) + app-layer dispatch trampolines | Traverses DKT scope tree from app code using source-id equality. This is the old registry source-id lookup rebadged on top of DKT scopes. |
| `sessionRootActions.ts` | Thin wrappers that get root scope and call `env.dkt.dispatch(name, payload, scope)` | This is a legitimate thin bootstrap adapter. Partially survives — see below. |
| `mediaImportActions.ts` | Resolves active project scope, queues file imports, chains async promise queue, dispatches `importResource` | Async chain running outside DKT. File handling belongs in a DKT task/effect. Promise chain belongs in a DKT inline saga or effect. |
| `exportActions.ts` | Gets project id from scope attrs, dispatches export task, reads result | Partially correct (dispatches DKT task), but still reads state by traversal and manages task lifecycle outside DKT. |
| `editorActionEnvironment.ts` | Defines `EditorActionEnvironment` interface with platform/task/media/export/transfer/dkt ports | **Keep** the port interface structure. Remove `EditorDktScopePort.readOne`, `readMany`, `readAttrs`, and `getRootScope` — these are used only by the source-id traversal which must be deleted. |
| `runtimeTaskFacade.ts` | In-memory runtime ref registry + `dispatchTask` plumbing | **Keep** as pure plumbing: it bridges non-serializable browser objects (File, Blob) into DKT tasks via opaque ref ids. This is a legitimate boundary. |
| `actionRuntimeTypes.ts` | `VideoEditorHarnessActions` interface — the surface exposed to UI tests and components | **Shrink**: remove source-id-based actions. The surface should be only what cannot be expressed as a direct DKT scope action (bootstrap, file drop, P2P init). |
| `createDktActionRuntime.ts` | (see above) | Delete. |
| `createVideoEditorHarness.ts` | Wires all ports together and exposes `VideoEditorHarnessActions` | **Shrink**: keep platform/task/export/transfer port wiring. Remove action runtime construction, source-id traversal injection, registry store construction. |

### 2.4 `src/video-editor/worker/` — worker snapshot API (partial deletion)

| File | Problem | Action |
|---|---|---|
| `sharedWorker.ts` | Holds `ProjectRegistry` global, handles `MSG.SNAPSHOT_REQUEST`, `MSG.REPLACE_SNAPSHOT`, `MSG.DISPATCH_COMMAND` | Strip registry global, snapshot request handler, and command dispatch handler. Keep only DKT message relay. |
| `sharedWorkerClient.ts` | `getSnapshot()` and `replaceSnapshot()` methods | Delete those two methods. |
| `memoryWorker.ts` | In-memory sync implementation also exposing `getSnapshot()` | Delete `getSnapshot()` and command dispatch. Keep DKT action dispatch relay. |
| `authorityClient.ts` | `getSnapshot()` on the interface | Remove from interface. |
| `fallbackAuthorityClient.ts` | Snapshot/command fallback for single-tab | Strip snapshot/command. |
| `dktSharedWorkerClient.ts` | DKT-specific worker client | Keep — this is the new DKT transport. |

### 2.5 Tests referencing deleted APIs (immediate skip + comment)

| File | Issue | Action |
|---|---|---|
| `memoryWorker.test.ts` | Calls `worker.getSnapshot()`, asserts registry shape | `describe.skip` + behavior contract comment |
| `workerBoundary.test.ts` | Calls `authority.getSnapshot()`, asserts registry entities | `describe.skip` + behavior contract comment |
| `createMiniCutDktRuntime.test.ts` lines 88/343/386 | Calls `getRegistryState`/`dispatchCommand`/`replaceRegistryState` | `describe.skip` + behavior contract comment |
| `messageTypes.test.ts` | Tests `isLegacyDktRegistryMessage` | Delete test + deleted helper |
| `video-editor.happy-path.test.tsx` line 85 | `return object from handler` — invalid action result shape | Locate handler, fix result shape per DKT contract |
| `exportRenderer.test.ts` lines 110/272 | `resolvedClipIds` / clip count assertions against old registry shape | Rebaseline against DKT `Project.exportPlan` comp attr |
| `renderPlan.test.ts` line 202 | Duration/frame count expectations against old timeline model | Rebaseline against DKT clip render attrs |
| `actions.test.ts` line 19 | `normalizeEffectCreationAttrs` old behavior | Update to new DKT effect creation path |

---

## 3. Target shape: what replaces each appendix

### 3.1 Command builders → DKT model actions (inline)

**Old:**
```
createProjectCreationCommand({ title })
  → dispatchCommand to worker
  → commandHandler mutates ProjectRegistry
  → PatchEnvelope → projects$ observable update
  → React reads from projects$ through selectors
```

**New:**
```
SessionRoot action: createProject
  → to: { project: ['<< project', { method: 'create', can_create: true, creation_shape: PROJECT_CREATION_SHAPE }] }
  → fn: (payload) => ({ project: { title: payload.title } })
  → DKT writes Project model attrs + owner rel
  → DKT page sync delivers attr/rel stream to React
  → React: <One rel="activeProject" shape={ProjectShape}> reads DKT attrs directly
```

No registry. No observable. No patch envelope. No trampoline.

### 3.2 Source-id traversal → owner rel traversal in React

**Old (in `createDktActionRuntime.ts`):**
```ts
for (const trackScope of dkt.readMany(projectScope, 'tracks')) {
  for (const clipScope of dkt.readMany(trackScope, 'clips')) {
    if (dkt.readAttrs(clipScope, ['sourceClipId']).sourceClipId === clipId) {
      return clipScope  // ← source-id scan
```

**New:**
Button inside `<ClipView>` already has the clip scope in context.  
It dispatches directly:
```tsx
// In ClipView, scope is provided by Many rel="clips"
<button onClick={() => dispatch('setOpacity', { opacity: 0.5 })}>
```

If a parent action must act on a child, it uses `to` with a child rel path and `inline_subwalker: true`:
```ts
// In Project action: addResourceToTimeline
{
  to: {
    clip: ['< clips < videoTrack', { method: 'create', can_create: true, inline_subwalker: true }],
  },
  fn: (payload, { videoTrack }) => ({
    clip: { start: payload.start, duration: payload.duration, ... }
  })
}
```

### 3.3 Legend session store → SessionRoot model attrs

**Old:**
```ts
session$.cursor.set(newCursor)
session$.isPlaying.set(true)
// React reads: const cursor = use$(session$.cursor)
```

**New:**
```ts
// SessionRoot model DCL:
attrs: {
  cursor: ['input', 0],
  isPlaying: ['input', false],
  timelineZoom: ['input', TIMELINE_ZOOM_DEFAULT],
  activeInspectorTab: ['input', 'edit'],
  activeTool: ['input', 'select'],
}
// SessionRoot action:
actions: {
  setCursor: [{ to: { cursor: ['<<< cursor'] }, fn: (payload) => ({ cursor: payload }) }],
  setPlaying: [{ to: { isPlaying: ['<<< isPlaying'] }, fn: (payload) => ({ isPlaying: payload }) }],
}
// React:
const { cursor, isPlaying } = useAttrs(['cursor', 'isPlaying'])
```

### 3.4 mediaImportActions promise chain → DKT task + action

**Old:**
```ts
importFilesQueue = importFilesQueue.then(async () => {
  const duration = await durationPromise
  env.dkt?.dispatch('importResource', resourceAttrs, projectScope)
})
```

**New:**
```ts
// Project model effect: $fx_importFiles
// effect receives runtimeRef(File[]), probes duration, resolves URL
// then calls back via DKT action:
actions: {
  importResourceResolved: [{
    to: { resource: ['<< resource', { method: 'create', can_create: true }] },
    fn: (payload) => ({ resource: { ...payload } })
  }]
}
// The effect (in Project/effects.ts) is the only place that awaits Promises.
// It dispatches importResourceResolved when ready.
// No queue, no closure over scope.
```

### 3.5 runtimeTaskFacade → keep as pure boundary plumbing

`runtimeTaskFacade.ts` is **not** an appendix. It is a legitimate boundary:  
it stores non-serializable values (File, Blob) under opaque string ids and passes those ids through the serializable DKT task payload. This pattern is correct and must stay.

The only change: remove the `dispatchTask` call sites that are in `mediaImportActions.ts`. Move them into the DKT model effect (`$fx_importFiles`).

---

## 4. Files to delete (complete list)

```
src/video-editor/domain/actionCommandBuilders.ts
src/video-editor/domain/actionTransactions.ts
src/video-editor/domain/applyCommandHelpers.ts
src/video-editor/domain/applyCommandDefaults.ts
src/video-editor/domain/applyPatch.ts
src/video-editor/domain/applyPatchInPlace.ts
src/video-editor/domain/patchAppliers.ts
src/video-editor/domain/commandHandlerRegistry.ts
src/video-editor/domain/clipCommandHandlers.ts
src/video-editor/domain/effectCommandHandlers.ts
src/video-editor/domain/projectCommandHandlers.ts
src/video-editor/domain/textCommandHandlers.ts
src/video-editor/domain/timelineCommandHandlers.ts
src/video-editor/domain/selectors.ts
src/video-editor/domain/actionScope.ts
src/video-editor/domain/actionRequests.ts
src/video-editor/domain/createProject.ts
src/video-editor/domain/resourceData.ts
src/video-editor/dkt/state/projectStore.ts
src/video-editor/dkt/state/sessionStore.ts
src/video-editor/dkt/state/derivedTimeline.ts
src/video-editor/dkt/state/observableSelectors.ts
src/video-editor/app/createDktActionRuntime.ts
src/video-editor/app/mediaImportActions.ts
src/video-editor/app/exportActions.ts        ← replace with thin DKT task dispatch
```

Tests to delete (replaced by DKT behavior contract tests):
```
src/video-editor/domain/actionCommandBuilders.test.ts
src/video-editor/domain/actionRequests.test.ts
src/video-editor/domain/protocolCompatibility.test.ts
src/video-editor/domain/protocolVersions.test.ts
src/video-editor/domain/randomCommandInvariants.test.ts
src/video-editor/domain/resourceData.test.ts
src/video-editor/domain/colorEffects.test.ts
src/video-editor/domain/timelineInvariants.test.ts
src/video-editor/domain/validateCommand.test.ts
src/video-editor/app/createDktActionRuntime.test.ts
```

---

## 5. Files to strip (keep skeleton, remove registry/snapshot parts)

### `src/video-editor/domain/types.ts`
- Keep: `ResourceKind`, `AnimatedScalar`, wire-protocol types needed for P2P/storage only.
- Delete: `ProjectRegistry`, `ProjectGraph`, `Entity`, `EntityId`, `Command`, `CMD`, `Patch`, `PATCH`, `MSG`, `WireMessage`, `PatchEnvelope`, `DispatchResult`, `EditorSessionState`, `ClipAttrs`, `TextAttrs`, `EffectAttrs`, `ResourceAttrs`, and all registry-shaped types.

### `src/video-editor/worker/sharedWorker.ts`
- Delete: `registry` global, `MSG.SNAPSHOT_REQUEST` / `MSG.REPLACE_SNAPSHOT` / `MSG.DISPATCH_COMMAND` handlers.
- Keep: DKT message relay, port bridging, DKT transport open/close.

### `src/video-editor/worker/sharedWorkerClient.ts`
- Delete: `getSnapshot()`, `replaceSnapshot()`, command dispatch methods.
- Keep: DKT transport open.

### `src/video-editor/worker/memoryWorker.ts`
- Delete: `getSnapshot()`, command dispatch.
- Keep: DKT action relay, connection lifecycle.

### `src/video-editor/worker/authorityClient.ts`
- Delete: `getSnapshot` from interface.

### `src/video-editor/worker/fallbackAuthorityClient.ts`
- Delete: snapshot/command path.

### `src/video-editor/app/createVideoEditorHarness.ts`
- Delete: `createDktActionRuntime` import, `actionRuntime` construction, any `session$`/`projects$` references.
- Keep: page runtime construction, platform port, task facade, transfer manager, export renderer wiring.

### `src/video-editor/app/editorActionEnvironment.ts`
- Delete from `EditorDktScopePort`: `getRootScope`, `readAttrs`, `readOne`, `readMany` — these exist only for the source-id traversal. DKT React Sync provides scope to components directly; the harness does not need a scope traversal port.
- Keep: `dispatch(actionName, payload, scope)` for bootstrap-only calls (createProject from main.tsx).
- Keep: all other ports (media, export, transfers, lifecycle, tasks, platform, pageRuntime).

### `src/video-editor/app/sessionRootActions.ts`
- This file is a thin bootstrap adapter. After deletion of source-id traversal, all that survives should be `createProject` triggered from the UI shell. Move this into `main.tsx` or the top-level component's `useEffect`. Do not keep a separate file for one bootstrap call.

### `src/video-editor/app/actionRuntimeTypes.ts`
- Shrink `VideoEditorHarnessActions` to only: bootstrap actions (`createProject`), file-drop entry points (`importFiles`), and P2P initiation. Remove all source-id-based action signatures (`queueClipExportById`, `addResourceToTimeline`, `selectEntity`, etc. — these become DKT scope actions in components).

---

## 6. Files to create (DKT model rebuild)

These are the contracts that replace the deleted appendices:

### `src/video-editor/models/SessionRoot.ts`
Attrs: `cursor`, `isPlaying`, `timelineZoom`, `activeInspectorTab`, `activeTool`, `selectionKind` (comp).  
Rels: `activeProject`, `selectedTrack`, `selectedClip`, `selectedResource`, `selectedText`, `selectedEffect`.  
Actions: `createProject`, `setActiveProject`, `selectTrack`, `selectClip`, `selectResource`, `selectText`, `selectEffect`, `clearSelection`, `setCursor`, `setPlaying`, `setTimelineZoom`, `setActiveInspectorTab`, `setActiveTool`.

### `src/video-editor/models/Project.ts`
Attrs: `title`, `sourceProjectId`, import/export status attrs.  
Comp attrs: `timelineDuration`, `timelineSummary`, `resourceSummary`, `previewFrame`, `exportPlan`.  
Rels: `tracks`, `resources`.  
Comp rels: `visibleTracks`, `timelineClips`, `activeVisualClips`, `activeAudioClips`, `videoTrack`, `audioTrack`.  
Actions: `handleInit` (creates default tracks), `addTrack`, `removeTrack`, `importResourceResolved`, `addResourceToTimeline`, `requestExport`.  
Effects: `$fx_importFiles` (file → objectUrl → probe → `importResourceResolved`), `$fx_renderExport`.

### `src/video-editor/models/Track.ts`
Attrs: `kind`, `name`, `color`, `isMuted`, `isLocked`, `isVisible`.  
Comp attrs: `trackDuration`, `clipCount`, `laneRenderState`.  
Rels: `clips`.  
Comp rels: `visibleClips`.  
Actions: `addClip`, `addTextClip`, `splitClipAt`, `moveClip`, `trimClip`, `deleteClip`, `reorderClips`, `setMute`, `setLock`, `setVisibility`.

### `src/video-editor/models/Clip.ts`
Attrs: `start`, `duration`, `trimStart`, `trimEnd`, `playbackRate`, `opacity`, `volume`, `transform`, `crop`, `colorAdjustments`.  
Comp attrs: `renderInterval`, `renderBox`, `renderMedia`, `renderAudio`, `renderText`, `effectStackSummary`.  
Rels: `resource`, `text`, `effects`.  
Comp rels: `visibleEffects`.  
Actions: `setTiming`, `setTrim`, `setTransform`, `setOpacity`, `setVolume`, `setColorAdjustments`, `setResource`, `setText`, `addEffect`, `removeEffect`, `reorderEffects`, `setEffectEnabled`.

### `src/video-editor/models/Resource.ts`
Attrs: `sourceResourceId`, `kind`, `name`, `duration`, `width`, `height`, `hasAudio`, `objectUrl`, `transferStatus`, `dataStatus`, `importError`.  
Comp attrs: `mediaSummary`, `canAddToTimeline`.  
Actions: `markTransferReady`, `markTransferError`, `updateObjectUrl`, `updateMetadata`, `requestAddToTimeline`.

### `src/video-editor/models/Text.ts`
Attrs: `content`, `fontFamily`, `fontSize`, `fontWeight`, `color`, `backgroundColor`, `box`, `alignment`.  
Comp attr: `textRenderState`.  
Actions: `setContent`, `setStyle`, `setBox`, `setAlignment`.

### `src/video-editor/models/Effect.ts`
Attrs: `kind`, `enabled`, `order`, kind-specific params.  
Comp attr: `effectRenderState`.  
Actions: `setEnabled`, `setParams`.

---

## 7. Non-DKT state pockets found in the codebase (beyond what was named)

These are all places discovered that manage editor state outside the DKT contour:

| Location | Problem |
|---|---|
| `src/video-editor/dkt/state/sessionStore.ts` | Legend `Observable<EditorSessionState>` — cursor, isPlaying, zoom live here, not in DKT |
| `src/video-editor/dkt/state/projectStore.ts` | Legend `Observable<ProjectRegistry>` — full registry mirror in Legend |
| `src/video-editor/dkt/state/derivedTimeline.ts` | Derived observables from project store (clip row layout, track groups) |
| `src/video-editor/dkt/state/observableSelectors.ts` | Legend selector helpers reading from the above stores |
| `src/video-editor/dkt/runtime/createMiniCutDktRuntime.ts` | Contains `createRegistryFromModelTree`, `getRegistryState`, `replaceRegistryState` — registry materialization inside DKT runtime |
| `src/video-editor/worker/sharedWorker.ts` | `let registry: ProjectRegistry` global — full editor state in worker memory |
| `src/video-editor/worker/memoryWorker.ts` | Same registry global for in-memory (test/fallback) path |
| `src/video-editor/app/createDktActionRuntime.ts` | `findClipScope`, `findTextScope`, `findEffectScope`, `getCursor`, `getSelectedEntityId` — source-id traversal manages scope identity outside DKT |
| `src/video-editor/app/mediaImportActions.ts` | `importFilesQueue` promise chain — async import state managed outside DKT |
| `src/video-editor/app/exportActions.ts` | Reads `sourceProjectId`/`selectedEntityId` by scope traversal to decide export behavior |
| `src/video-editor/app/sessionRootActions.ts` | `projectCreationSequence` mutable counter — sequence state outside DKT |
| `src/video-editor/app/roomUrlState.ts` | Room URL parsing state — evaluate whether this belongs in `SessionRoot` attrs or is legitimate platform state |
| `src/video-editor/media/resourceTransferManager.ts` | Maintains a transfer state map outside DKT — result of transfers must flow into `Resource` attrs via DKT task completion, not be read from this manager directly |
| `src/video-editor/render-sync/` | `DktRegistryRenderStore`, `createDktEditorRenderRuntime`, `projectRegistryFromPageRuntime` — compatibility projection layer that rebuilds a registry from DKT page runtime output |
| `src/video-editor/node/headlessScenario.ts` | Still references registry-based worker dispatch pattern (see inline comment) |

---

## 8. Migration order (hard, no ceremony)

### Step 1: delete render-sync compatibility projection
Delete `DktRegistryRenderStore.ts`, `createDktEditorRenderRuntime.ts`, `projectRegistryFromPageRuntime.ts`.  
This is the first cut. Render tests that depended on registry shape will break. That is the signal to rebaseline them against DKT comp attrs.

### Step 2: delete domain command layer
Delete all files listed in section 4 under `domain/`.  
All command handler tests, action command builder tests, and patch applier tests disappear.

### Step 3: delete Legend stores
Delete `projectStore.ts`, `sessionStore.ts`, `derivedTimeline.ts`, `observableSelectors.ts`.  
All imports of `createProjectsStore`, `createSessionStore`, `projects$`, `session$` become compile errors. Fix each callsite to read from DKT attrs/rels.

### Step 4: strip worker snapshot API
Apply section 5 changes to `sharedWorker.ts`, `sharedWorkerClient.ts`, `memoryWorker.ts`, `authorityClient.ts`, `fallbackAuthorityClient.ts`.  
Skip `memoryWorker.test.ts` and `workerBoundary.test.ts` with behavior contract comments.

### Step 5: delete app-layer traversal and action runtime
Delete `createDktActionRuntime.ts`, `mediaImportActions.ts`.  
Shrink `exportActions.ts` to a one-liner DKT task dispatch.  
Shrink `editorActionEnvironment.ts` per section 5.  
Shrink `createVideoEditorHarness.ts` per section 5.

### Step 6: skip registry-based tests with behavior contract comments
Apply to all test files listed in section 2.5.  
Comment format:
```ts
// Behavior contract: [plain English description of what the user experiences]
// Skipped: registry API removed in phase 1. Rebuild through DKT model attrs/rels in phase 5.
describe.skip('...', () => { ... })
```

### Step 7: build `SessionRoot` model
Implement attrs, rels, comp attrs, and all actions listed in section 6.  
First green test: `createProject` → `activeProject` rel exists → `Project.handleInit` runs → two tracks exist.

### Step 8: build `Project`, `Track`, `Clip`, `Resource`, `Text`, `Effect` models
Each with creation shape, owner rels, comp attrs, and actions per section 6.

### Step 9: build `$fx_importFiles` and `$fx_renderExport` effects
Declared on `Project` model. Runtime ref plumbing stays in `runtimeTaskFacade.ts`.  
Effects report back via `importResourceResolved` and export status actions.

### Step 10: rebuild React components as pure DKT traversal
`SessionRootView` → `ProjectView` → `TrackView` → `ClipView`.  
`Many`, `One`, `Path`, `useAttrs`, scoped dispatch.  
No registry props. No scope traversal from parent to child.

### Step 11: rebaseline export and render plan tests
Fix `exportRenderer.test.ts`, `renderPlan.test.ts` against `Project.exportPlan` comp attr.

### Step 12: CI quality gate
```
pnpm guard:dkt-hard
tsc --noEmit -p tsconfig.video-editor.json
vitest run --config vitest.video-editor.config.js
playwright test --grep @smoke
```

---

## 9. Invariants that must hold at every step

- No running import of `ProjectRegistry` as a value (only type in pure migration removal code).
- No `createProjectsStore` or `createSessionStore` in running app.
- No `getSnapshot`, `replaceSnapshot`, `dispatchCommand`, `applyPatchEnvelope` in running app.
- No `findClipScope`, `findTextScope`, `findEffectScope` or any source-id scan from app-layer code.
- No Legend `observable` wrapping editor state. Only DKT attrs/rels.
- No `then(async () => dispatch(...))` chains for multi-step workflows. Use DKT inline saga or effect.
- Every new DKT model action that creates a child model writes the owner rel in the same action step using `hold_ref_id` + `use_ref_id` or `set_many`.
- `runtimeTaskFacade.ts` is the only place that holds non-serializable browser objects. No other module stores File, Blob, or object URL as app state.

---

## 10. Implementation log (commits)

- `e41d305` - step0: add DKT appendix purge plan document.
- `de19433` - step1: isolate render pipeline types into local render modules.
- `56c897d` - step2: strip registry materialization from DKT runtime.
- `910c4bd` - chore: separate commit for incidental P2P test header cleanup.
- `1a23db7` - step4: remove legacy SharedWorker snapshot/command protocol files and DKT-only worker path in P2P manager.
- `660b46d` - step3: delete `dkt/state` Legend stores and move session zoom constants into model-owned module.
- `299dc36` - step1 follow-up: delete unused render registry projection (`projectRegistryFromPageRuntime`).
- `cdd7c2b` - step6: skip legacy registry-oriented runtime/worker suites and delete removed compatibility helper test.
- `ec9642c` - docs: add implementation commit log to this plan.
- `9911ca6` - step6 follow-up: skip legacy app and render-sync compatibility suites.
- `248465e` - step6 follow-up: skip authority parity and happy-path suites still bound to registry/session mirrors.
- `419ba87` - step2 partial: remove command-builder modules and obsolete domain tests; move action request types to render-sync.
- `55cbd55` - step5 partial: drop obsolete app action-runtime helper tests/files.
