# MiniCut Legend -> DKT migration plan

Date: 2026-05-05

Status: revised after the MiniCut pre-DKT commits `c0e0490`, `9a7ae5e`, `b71d398`, `ac8809a`, `1b4b009`.

This document now describes the **clean target DKT architecture only**. Legacy command-dispatch bridge variants have been removed. Existing command code remains useful as an executable oracle while tests are being ported, but it is not the destination.

History and undo are intentionally out of scope here. They have their own plan in `docs/dkt-history-undo-migration-plan-2026-05-05.md`.

## 1. Target decision

The target is a DKT-owned graph where business edits are model-scoped actions that read their own declared deps and write directly to declared targets.

Example target form for clip opacity:

```ts
updateOpacity: {
  to: ['opacity'],
  fn: (opacityPercent) => ({ value: roundToTenths(opacityPercent / 100) }),
}
```

The action is dispatched on the `Clip` node. It does not produce `CMD.CLIP_UPDATE_ATTRS` and does not depend on a global command authority to mutate the graph.

Selected-entity operations are routing concerns, not mutation concerns. `SessionRoot` may resolve `selectedClip` and route to `Clip.updateOpacity`, but the write still belongs to the clip node:

```ts
updateSelectedClipOpacity: {
  to: {
    clipAction: ['<< selectedClip', { action: 'updateOpacity', sub_flow: true }],
  },
  fn: (opacityPercent) => ({ clipAction: opacityPercent }),
}
```

That means the migration order should be: model actions first, session routing second, runtime/worker wiring third, and only then removal of old command builders for the migrated group.

## 2. Current baseline after recent commits

| Commit | Change | Migration impact |
| --- | --- | --- |
| `c0e0490` | Runtime task facade and runtimeRef store for import/export boundaries | Live `File`/`Blob`/object URL handles now have a DKT-like single-use boundary in MiniCut. Clean DKT can map this to model-scoped `dispatchTask` later. |
| `9a7ae5e` | Transaction executor v2 with created-id refs | Multi-step flows are closer to walker semantics, but this remains a temporary pre-DKT execution layer. It is not the target action system. |
| `b71d398` | SessionRoot action hardening | Session mutations are centralized and guarded, making a DKT `EditorSessionRoot` migration lower risk. |
| `ac8809a` | Legend patch adapter converted to table-driven appliers | Patch behavior is easier to compare against clean DKT direct writes and projection code. |
| `1b4b009` | Public preview/read-model imports moved to `read-model/previewReadModel.ts` | Render/UI no longer import `legend/derivedTimeline` as their public read-model API. |

## 3. Revised risk assessment

| Risk | Previous level | New level | Why it changed | Mitigation |
| --- | --- | --- | --- | --- |
| UI coupling to Legend | Medium | Low | Render/UI imports moved away from `legend/derivedTimeline`; scoped render-sync already exists. | Keep UI dispatch scoped by node id; prohibit new public imports from `legend/*` outside adapters. |
| Import/export live objects | High | Medium | Runtime task facade now normalizes live objects to `runtimeRefId`. | Map this to DKT `targetModel.dispatchTask('$fx_handleInputFiles', { runtimeRef, data })`; keep single-use tests. |
| Session state migration | Medium | Low/Medium | Session root methods are centralized and guarded. | Port `selectEntity`, `setCursor`, `togglePlayback`, `zoomTimeline` before graph actions that depend on selection. |
| Simple clip/effect/text attr edits | Medium | Low | Scoped action builders already identify target nodes. | Start with clean direct-write DKT action specs and parity tests against current command oracle. |
| Timeline invariants | High | High | Move/resize/split depend on neighbor bounds and overlap rules. | Keep them after simple attrs; port as DKT actions with explicit rel/deps and oracle tests from `timelineInvariants.test.ts`. |
| Project/resource creation | High | High | Created ids, rel insertion order, default tracks, linked audio/video clips, import metadata. | Use DKT saga/walker actions with one publish boundary; test created-id refs and graph shape. |
| History/undo | High | Deferred | Current worker history is snapshot/patch based; DKT transaction history is a separate design. | Do not migrate in this plan. Track in separate history/undo plan. |
| P2P/shared-worker compatibility | High | Medium/High | Weather shows a viable DKT SharedWorker/P2P pattern; MiniCut has larger media payloads and export paths. | First copy weather-style runtime transport shape; keep P2P protocol tests green before replacing authority. |
| Preview performance | Medium | Medium | Pure preview read model is now separated, but cursor comps are not DKT-native yet. | Split structural preview comps from cursor comps; benchmark `bench-color-scopes` and happy-path heavy timeline. |
| External DKT integration | Medium | Medium | Weather uses local aliases to `../tmp/dkt` / `../dkt/js`; MiniCut has no alias yet. | Add a local `tmp/dkt` symlink/junction plus Vite/TS aliases before importing DKT runtime code. |

## 4. DKT integration shape from weather

The weather app is the best local reference for how MiniCut should connect DKT:

- `D:\code\linkcraft\weather\vite.config.ts` aliases `dkt` and `dkt-all` to local DKT sources.
- `D:\code\linkcraft\weather\src\worker\shared-worker.ts` creates a `MessagePort` transport and connects it to a model runtime.
- `D:\code\linkcraft\weather\src\worker\model-runtime.ts` starts DKT with `prepareAppRuntime`, interfaces, a session manager, sync sender, and scoped dispatch.
- `CONTROL_DISPATCH_APP_ACTION` carries `action_name`, `payload`, and optional `scope_node_id`; worker resolves `scope_node_id` with `getModelById` and dispatches on that target model.
- Weather P2P routes the same transport messages over a server/client bridge; the server owns the model runtime, clients relay page messages.

MiniCut should follow that shape, not invent a second runtime protocol.

Planned MiniCut config step:

1. Add ignored local path `/tmp/dkt`.
2. Locally create a junction/symlink from `D:\code\minicut\tmp\dkt` to `D:\code\linkcraft\dkt`.
3. Add Vite aliases:

```ts
const dktRoot = fileURLToPath(new URL('./tmp/dkt/js', import.meta.url))
const dktProvodaRoot = fileURLToPath(new URL('./tmp/dkt/js/libs/provoda/provoda', import.meta.url))

resolve: {
  alias: {
    '@video-editor': path.resolve(__dirname, 'src/video-editor'),
    dkt: dktProvodaRoot,
    'dkt-all': dktRoot,
  },
}
```

4. Add equivalent `tsconfig.video-editor.json` paths only when source files begin importing DKT packages.
5. Keep the symlink itself uncommitted.

## 5. Clean DKT model map

### 5.1 `EditorAppRoot`

Owns workspace-level graph and app services.

Attrs:

| Attr | Kind | Notes |
| --- | --- | --- |
| `activeProjectHint` | input | Replacement for registry-level active project fallback. |
| `historyCanUndo` | input | Read-only until the history plan is implemented. |
| `historyCanRedo` | input | Read-only until the history plan is implemented. |
| `projectMetaList` | comp | Derived from project root attrs/rels. |
| `hasProjects` | comp | Derived from projects rel. |

Rels:

| Rel | Cardinality | Notes |
| --- | --- | --- |
| `projects` | many `Project` | All project roots. |
| `activeProject` | one/comp | Uses `SessionRoot.activeProjectId` first, then app hint. |
| `$session_root` | one `EditorSessionRoot` | Tab-local attention model. |

Pure actions:

| Action | Target writes | Files to migrate | Tests |
| --- | --- | --- | --- |
| `setActiveProjectHint` | `activeProjectHint` | `src/video-editor/legend/projectStore.ts`, future DKT root | `src/video-editor/app/sessionRootActions.test.ts`, `src/video-editor/tests/video-editor.happy-path.test.tsx` |
| `applyReplicaSnapshot` | app graph | future DKT replica adapter | worker boundary tests |

Do not migrate `undo`/`redo` here.

### 5.2 `EditorSessionRoot`

Tab-local user attention and playback state.

Attrs:

| Attr | Kind | Target action |
| --- | --- | --- |
| `tabId` | input | bootstrap only |
| `activeProjectId` | input | `setActiveProject` |
| `selectedEntityId` | input | `selectEntity` |
| `activeInspectorTab` | input | `setInspectorTab` |
| `cursor` | input | `setCursor`, `tickPlayback` |
| `isPlaying` | input | `togglePlayback`, `setPlaying` |
| `timelineZoom` | input | `zoomTimeline` |
| `timelineTool` | input | `setTimelineTool` |
| `snappingEnabled` | input | `toggleSnapping` |
| `selectedEntityType` | comp | derived from selected node |
| `hasSelectedClip` | comp | derived from selected node type |
| `activeClipRefsAtCursor` | comp | cursor + active timeline intervals |
| `previewFrameAtCursor` | comp | cursor + structural preview source |

Pure actions:

```ts
selectEntity: {
  to: ['selectedEntityId'],
  fn: (id) => typeof id === 'string' ? id : null,
}

setCursor: {
  to: ['cursor'],
  fn: (value) => roundToHundredths(Math.max(0, Number(value))),
}

tickPlayback: {
  to: ['cursor'],
  fn: [
    ['isPlaying', 'cursor', '< @one:playbackDuration < activeProject'],
    (deltaSeconds, isPlaying, cursor, playbackDuration) => {
      if (!isPlaying || playbackDuration <= 0) return '$noop'
      return (cursor + deltaSeconds) % playbackDuration
    },
  ],
}
```

Files to migrate first:

- `src/video-editor/app/sessionRootActions.ts`
- `src/video-editor/app/sessionRootActions.test.ts`
- future `src/video-editor/dkt/sessionRootModel.ts`
- future `src/video-editor/render-sync/createDktEditorRenderRuntime.ts`

Tests:

- `npm run test:video-editor -- src/video-editor/app/sessionRootActions.test.ts src/video-editor/app/createVideoEditorHarness.test.ts`
- after wiring: `npm run test:video-editor -- src/video-editor/tests/video-editor.happy-path.test.tsx`

### 5.3 `Project`, `Timeline`, `Track`

These models own structure and timeline invariants.

`Project`:

- attrs: `title`, `fps`, `width`, `height`, `duration`, `createdAt`, `updatedAt`, `version`, `resourceCount`, `clipCount`, `playbackDuration`.
- rels: `resources`, `timelines`, `activeTimeline`.
- actions: `rename`, `setFormat`, `addResource`, `addTextClip`, `addTrack`.

`Timeline`:

- attrs: `name`, `duration`, `trackCount`, `clipIntervals`, `maxClipEnd`.
- rels: `tracks`.
- actions: `addTrack`, `insertClipOnBestTrack`, `splitClipAtCursor` as saga/walker only after simple attrs are stable.

`Track`:

- attrs: `kind`, `name`, `muted`, `locked`, `height`, `clipCount`, `end`, `clipIntervals`.
- rels: `clips`.
- actions: `appendClip`, `insertClip`, `removeClip`, `reorderClip`.

Files to migrate later:

- `src/video-editor/domain/timelineCommandHandlers.ts`
- `src/video-editor/domain/timelineInvariants.test.ts`
- `src/video-editor/domain/selectors.ts`
- `src/video-editor/read-model/previewReadModel.ts`
- future DKT model files under `src/video-editor/dkt/`

Tests:

- `npm run test:video-editor -- src/video-editor/domain/timelineInvariants.test.ts src/video-editor/domain/randomCommandInvariants.test.ts`
- `npm run test:video-editor -- src/video-editor/tests/video-editor.happy-path.test.tsx`

### 5.4 `Clip`

First graph model to migrate because simple attr edits are narrow and user-visible.

Attrs:

| Attr | Kind | First action group |
| --- | --- | --- |
| `name` | input | `rename` |
| `color` | input | `setColor` |
| `opacity` | input structured scalar | `updateOpacity` |
| `fadeIn` / `fadeOut` | input | `setFade` |
| `audio` | input | `setAudio` |
| `transform` | input structured scalars | `setTransform` |
| `start`, `duration`, `in` | input | later timeline-safe actions |
| `end` | comp | `start + duration` |
| `previewSource` | comp | structural preview projection, no cursor dep |

Clean actions:

```ts
updateOpacity: {
  to: ['opacity'],
  fn: (opacityPercent) => ({ value: roundToTenths(opacityPercent / 100) }),
}

rename: {
  to: ['name'],
  fn: (name) => String(name),
}

setTransform: {
  to: ['transform'],
  fn: [['transform'], (partial, transform) => ({ ...transform, ...normalizeTransform(partial) })],
}
```

Files for the first clip slice:

- `src/video-editor/domain/actionCommandBuilders.ts` as oracle only, not target.
- `src/video-editor/domain/clipCommandHandlers.ts` as oracle only, not target.
- new `src/video-editor/dkt/clipActions.ts` for clean action specs and direct patch projection while DKT runtime wiring is additive.
- new `src/video-editor/dkt/clipActions.test.ts` for parity and no-command guarantees.

Tests:

- `npm run test:video-editor -- src/video-editor/dkt/clipActions.test.ts src/video-editor/domain/actionCommandBuilders.test.ts`
- after wiring to UI/runtime: `npm run test:video-editor -- src/video-editor/tests/video-editor.happy-path.test.tsx`

### 5.5 `Resource`

Resources remain pure data nodes. Live capabilities enter only through `dispatchTask`.

Attrs:

- `name`, `kind`, `url`, `mime`, `duration`, `width`, `height`, `size`, `source`, `data`, `status`.
- comps from `src/video-editor/domain/resourceData.ts`: `progress`, `isPlayable`, `loadedBytes`, `loadedRanges`, `requestedRanges`.

Clean task boundary:

```ts
projectModel.dispatchTask('$fx_handleInputFiles', {
  runtimeRef: files,
  data: { addToTimeline: true },
})
```

The effect creates serializable resource data by dispatching pure DKT project/timeline actions after reading runtime-only metadata.

Files:

- `src/video-editor/app/runtimeTaskFacade.ts` remains the pre-runtime contract test bed.
- `src/video-editor/app/mediaImportActions.ts` is replaced by a DKT effect/interface adapter later.
- `src/video-editor/media/resourceTransferManager.ts` remains external interface code.

Tests:

- `npm run test:video-editor -- src/video-editor/app/runtimeTaskFacade.test.ts src/video-editor/app/createVideoEditorHarness.test.ts`
- P2P import tests: `npm run test:video-editor -- src/video-editor/p2p` when touching transfer behavior.

### 5.6 `Effect`, `Text`, `Keyframe`

These can be migrated after `Clip` attr actions.

Files:

- `src/video-editor/domain/effectCommandHandlers.ts`
- `src/video-editor/domain/textCommandHandlers.ts`
- `src/video-editor/domain/textEditing.test.ts`
- future `src/video-editor/dkt/effectActions.ts`
- future `src/video-editor/dkt/textActions.ts`

Tests:

- `npm run test:video-editor -- src/video-editor/domain/textEditing.test.ts src/video-editor/domain/colorEffects.test.ts`
- `npm run test:video-editor -- src/video-editor/tests/video-editor.happy-path.test.tsx`

## 6. Pure read-model plan

The clean DKT read model should not re-export from Legend adapters.

Current neutral boundary:

- `src/video-editor/read-model/previewReadModel.ts`

Next steps:

1. Move pure preview type definitions out of `src/video-editor/legend/previewComps.ts` into `src/video-editor/read-model/previewComps.ts`.
2. Keep `legend/derivedTimeline.ts` as a Legend adapter that imports pure read-model functions.
3. Add future `dkt/previewComps.ts` or DKT model comps that produce the same `PreviewStructure` and `PreviewFrame` shapes.
4. Test Legend adapter and DKT adapter against the same pure read-model tests.

Files:

- `src/video-editor/read-model/previewReadModel.ts`
- `src/video-editor/legend/derivedTimeline.ts`
- `src/video-editor/legend/previewComps.ts`
- `src/video-editor/render/previewRenderPlan.ts`
- `src/video-editor/render/colorScopes.ts`
- `src/video-editor/ui/RendererStage.tsx`

Tests:

- `npm run test:video-editor -- src/video-editor/legend/derivedTimeline.test.ts src/video-editor/render/previewRenderPlan.test.ts src/video-editor/render/colorScopes.test.ts src/video-editor/ui/RendererStage.test.tsx`

## 7. Safest migration order

### Phase 0: Lock the plan and history boundary

Goal: remove command-bridge target language and make undo/history explicitly separate.

Files:

- `docs/dkt-legend-state-rewrite-plan-2026-05-04.md`
- `docs/dkt-history-undo-migration-plan-2026-05-05.md`

Tests:

- No runtime code required. Run a focused smoke after doc-only commit if desired:
  `npm run test:video-editor -- src/video-editor/app/runtimeTaskFacade.test.ts src/video-editor/app/actionTransactionExecutor.test.ts src/video-editor/app/sessionRootActions.test.ts`

### Phase 1: Add clean DKT action specs without runtime wiring

Goal: create executable clean DKT action semantics for one safe attr edit.

First action: `Clip.updateOpacity`.

Rules:

- No `CMD` import in the new DKT action module.
- No command-dispatch bridge.
- Action returns direct target attr value or direct patch projection.
- Tests may compare against current command output as oracle.

Files:

- `src/video-editor/dkt/clipActions.ts`
- `src/video-editor/dkt/clipActions.test.ts`

Tests:

- `npm run test:video-editor -- src/video-editor/dkt/clipActions.test.ts src/video-editor/domain/actionCommandBuilders.test.ts`

### Phase 2: Add local DKT alias configuration

Goal: prepare actual DKT runtime import path, following weather.

Files:

- `.gitignore`
- `vite.video-editor.config.js`
- `tsconfig.video-editor.json`
- possibly `vitest.video-editor.config.js`

Local setup:

```powershell
New-Item -ItemType Junction -Path .\tmp\dkt -Target D:\code\linkcraft\dkt
```

Tests:

- `npm run test:video-editor -- src/video-editor/dkt/clipActions.test.ts`
- `npm run video-editor:build`

### Phase 3: Add DKT runtime shell behind a disabled flag

Goal: start DKT runtime without replacing the app authority.

Files:

- `src/video-editor/dkt/models/AppRoot.ts`
- `src/video-editor/dkt/models/SessionRoot.ts`
- `src/video-editor/dkt/runtime/createMiniCutDktRuntime.ts`
- `src/video-editor/dkt/shared/messageTypes.ts`
- `src/video-editor/dkt/shared/createPortTransport.ts`
- `src/video-editor/worker/dktSharedWorker.ts`
- `vite.video-editor.config.js`

Tests:

- New runtime boot test.
- `npm run test:video-editor -- src/video-editor/app/createVideoEditorHarness.test.ts src/video-editor/tests/video-editor.happy-path.test.tsx`

### Phase 4: Wire DKT SessionRoot for session-only actions

Goal: replace local session action implementation for `selectEntity`, `setCursor`, `togglePlayback`, `zoomTimeline` with DKT session actions.

Files:

- `src/video-editor/app/sessionRootActions.ts`
- `src/video-editor/render-sync/createLegendEditorRenderRuntime.ts`
- future DKT render runtime files.

Tests:

- `npm run test:video-editor -- src/video-editor/app/sessionRootActions.test.ts src/video-editor/app/createVideoEditorHarness.test.ts`
- `npm run test:video-editor -- src/video-editor/tests/video-editor.happy-path.test.tsx`

### Phase 5: Wire `Clip.updateOpacity` through scoped DKT dispatch

Goal: first user-facing project graph edit through clean DKT action.

Files:

- `src/video-editor/dkt/clipActions.ts`
- `src/video-editor/dkt/models/Clip.ts`
- `src/video-editor/render-sync/createDktEditorRenderRuntime.ts`
- `src/video-editor/ui/inspector/InspectorEditTabPanel.tsx` only if dispatch API changes.

Tests:

- `npm run test:video-editor -- src/video-editor/dkt/clipActions.test.ts src/video-editor/tests/video-editor.happy-path.test.tsx`
- P2P/state sync smoke before making it default.

### Phase 6: Migrate remaining simple clip attrs

Goal: move `rename`, `setColor`, `setFade`, `setAudio`, `setTransform` to clean DKT actions.

Files:

- `src/video-editor/dkt/clipActions.ts`
- `src/video-editor/domain/actionCommandBuilders.ts` only to remove migrated cases after runtime is default.
- `src/video-editor/app/createLegendActionRuntime.ts` only as legacy adapter cleanup.

Tests:

- `npm run test:video-editor -- src/video-editor/domain/actionCommandBuilders.test.ts src/video-editor/dkt/clipActions.test.ts`
- `npm run test:video-editor -- src/video-editor/tests/video-editor.happy-path.test.tsx`

### Phase 7: Migrate text/effect attr actions

Goal: make `Text.updateText` and `Effect.updateAttrs` direct DKT writes.

Files:

- `src/video-editor/dkt/textActions.ts`
- `src/video-editor/dkt/effectActions.ts`
- `src/video-editor/domain/textCommandHandlers.ts`
- `src/video-editor/domain/effectCommandHandlers.ts`

Tests:

- `npm run test:video-editor -- src/video-editor/domain/textEditing.test.ts src/video-editor/domain/colorEffects.test.ts src/video-editor/tests/video-editor.happy-path.test.tsx`

### Phase 8: Migrate timeline-safe actions

Goal: move/resize/trim/split without losing overlap constraints.

Files:

- `src/video-editor/dkt/timelineActions.ts`
- `src/video-editor/dkt/trackActions.ts`
- `src/video-editor/dkt/clipTimelineActions.ts`
- `src/video-editor/domain/timelineCommandHandlers.ts`
- `src/video-editor/domain/selectors.ts`

Tests:

- `npm run test:video-editor -- src/video-editor/domain/timelineInvariants.test.ts src/video-editor/domain/randomCommandInvariants.test.ts`
- `npm run test:video-editor -- src/video-editor/tests/video-editor.happy-path.test.tsx`

### Phase 9: Migrate import/resource tasks

Goal: make file import a DKT task plus pure resource/timeline actions.

Files:

- `src/video-editor/app/runtimeTaskFacade.ts`
- `src/video-editor/app/mediaImportActions.ts`
- `src/video-editor/dkt/resourceActions.ts`
- `src/video-editor/dkt/importEffects.ts`

Tests:

- `npm run test:video-editor -- src/video-editor/app/runtimeTaskFacade.test.ts src/video-editor/app/createVideoEditorHarness.test.ts`
- `npm run test:video-editor -- src/video-editor/tests/video-editor.happy-path.test.tsx`
- P2P media transfer tests if resource transfer metadata changes.

### Phase 10: Replace authority/replica path after parity

Goal: DKT runtime owns project graph mutation for migrated groups.

Files:

- `src/video-editor/worker/sharedWorker.ts`
- `src/video-editor/worker/memoryWorker.ts`
- `src/video-editor/worker/authorityClient.ts`
- `src/video-editor/app/createVideoEditorHarness.ts`

Tests:

- worker tests: `npm run test:video-editor -- src/video-editor/worker`
- app tests: `npm run test:video-editor -- src/video-editor/app/createVideoEditorHarness.test.ts`
- integration: `npm run test:integration`

History/undo is still not migrated in this phase unless the separate history document has been implemented and accepted.

## 8. Completion table required for every migration step

Every step must be reported in this form:

| Step | Commit | Files changed | Tests run | Result | Problems / follow-up |
| --- | --- | --- | --- | --- | --- |
| Example | `abcdef0` | `src/video-editor/dkt/clipActions.ts`, `src/video-editor/dkt/clipActions.test.ts` | `npm run test:video-editor -- src/video-editor/dkt/clipActions.test.ts` | passed | none |

Rules:

- Use a Conventional Commit per step.
- Do not bundle unrelated migration groups.
- Tests must be listed exactly as run.
- If a test is flaky, rerun once in isolation and record both the failure and the isolation result.
- Keep history/undo out of this migration until the dedicated plan is executed.

## 9. Immediate next commits

1. Documentation commit: this plan plus the separate history/undo plan.
2. First migration code commit: add clean `Clip.updateOpacity` DKT action semantics with tests and no runtime wiring.
3. Next safe commit after that: add local DKT alias config and ignored `tmp/dkt` junction path, then build/test.
