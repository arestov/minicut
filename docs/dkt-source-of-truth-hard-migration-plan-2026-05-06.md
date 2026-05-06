# DKT source-of-truth hard migration plan

Date: 2026-05-06

## Goal

Make DKT the only running source of truth for the MiniCut editor.

This is a staged migration, but each stage is hard in one direction: once a behavior moves to DKT, it must not keep a silent fallback to the old Legend/registry/read-model path. Temporary compatibility code is allowed only when it is explicitly named as a bridge and has a removal phase.

## Non-negotiable rules

- React render reads DKT scopes top-down: parent rels, child scopes, scoped attrs, scoped dispatch.
- Runtime app logic dispatches a DKT action or DKT task as early as possible.
- DKT models own attrs, rels, comp attrs, comp rels, and effects.
- Replica/debug graph APIs are diagnostic only. Production render and dispatch must not call `debugDumpGraph`, scan receiver nodes, or pull receiver model objects as app data.
- Legacy `ProjectRegistry`, Legend stores, command envelopes, and read-model selectors are compatibility inputs only until deleted. They must not be fallback render paths.
- Browser/P2P/export/worker code may hold platform handles, but state results must return through DKT actions/tasks.

## Phase 1: seal the render/runtime boundary

Status: complete in this pass.

Purpose: stop normalizing the wrong architecture before adding more model behavior.

Actions:

1. Rename DKT creation payloads from `ProxyInput` to `Seed` and rename creation shapes away from `*_PROXY_CREATION_SHAPE`.
2. Rename AppRoot creation actions from `create*Proxy` to `create*Model`.
3. Rename local runtime bridge helpers from `ensureProxy/findProxy*` to `ensureSeededModel/findModel*` so remaining bridge code is visible as a migration island, not a replica pattern.
4. Remove production use of `debugDumpGraph` and source-id graph scans from `createDktPageEditorRenderRuntime`.
5. When `pageRuntime` exists, remove silent `legacyRuntime` fallback for attrs/rels/comps/dispatch. Missing DKT data should surface as missing data, not old registry data.
6. Keep `legacyRuntime` only for the explicit disabled-DKT path where `pageRuntime` is null.

Exit checks:

- No `ProxyInput`, `*_PROXY_CREATION_SHAPE`, `create*Proxy`, `ensureProxy`, `findProxy*`, or `getProxy*` remains in DKT model/runtime code.
- `createDktPageEditorRenderRuntime` does not import receiver debug graph types and does not call `debugDumpGraph`.
- Unit tests assert that DKT-scoped dispatch updates DKT only and does not mirror through legacy source ids.

## Phase 2: DKT model ownership for timeline edits

Purpose: remove dual writes for the main editing surface.

Boundary rule: use `dispatchAction` for all synchronous editor-state mutations. Do not use `dispatchTask('$fx_*')` for rename, move, trim, resize, split, text attrs, effect attrs, selection, or rel membership unless the operation needs a runtime-only external side effect. UI/render code may only dispatch the scoped DKT action from the current scope.

Actions:

1. Add/confirm DKT rel ownership for `Project -> Track -> Clip -> Effect/Text/Resource`.
	- `dispatchAction`: parent model actions create or update child model attrs and rel membership in the same DKT action.
	- `dispatchTask('$fx_*')`: not used.
	- Fallback rule: remove legacy rel assembly fallback. No new code may infer tree structure from `ProjectRegistry`, source-id scans, or receiver debug data.
2. Add parent context where DKT model logic needs it: `Clip.track`, `Clip.project`, `Effect.clip`, `Effect.project`, either as rels or comp attrs owned by DKT.
	- `dispatchAction`: child/parent creation and move actions update parent context.
	- `dispatchTask('$fx_*')`: not used.
	- Fallback rule: do not rediscover parents through registry selectors, graph scans, or custom replica helpers.
3. Move rename/color/opacity/fade/audio/transform/move/trim/resize/split into scoped DKT actions only.
	- `dispatchAction`: yes, from render scope to `Clip` or `SessionRoot`.
	- `dispatchTask('$fx_*')`: not used.
	- Fallback rule: delete dual command-envelope dispatch for these edits; no compatibility write may run in parallel.
4. Add DKT actions for effect create/remove/reorder and text style/box updates.
	- `dispatchAction`: yes, `Clip.addEffect/removeEffect/reorderEffects`, `Text.setTextContent/setTextStyle/setTextBox`, `Effect.set*`.
	- `dispatchTask('$fx_*')`: not used.
	- Fallback rule: no effect/text update may call legacy `create*Command` builders from app actions.
5. Replace `createDktActionRuntime` dual dispatch for those operations with scoped DKT dispatch and a temporary one-way compatibility projection out of DKT if export/worker still needs it.
	- `dispatchAction`: yes, compatibility projection listens after DKT state changes; UI does not dispatch legacy commands.
	- `dispatchTask('$fx_*')`: not used unless the projection crosses a platform boundary.
	- Fallback rule: projection is not fallback. It must be named as projection, downstream-only, and removable in Phase 6.

Exit checks:

- Timeline editing UI no longer reads `env.stores.getRegistry()` to decide edit behavior.
- Editing tests create states through DKT actions, not direct Legend registry mutation.
- No new fallback code is allowed. Missing DKT attrs/rels must fail visibly and be fixed in DKT state, not patched by app-side registry reads.

## Phase 3: resource import and add-to-timeline as DKT task/effect

Purpose: remove `mediaImportActions.ts` as a source-of-truth side channel.

Boundary rule: use `dispatchTask('$fx_*')` only to carry runtime-only handles and platform work into the DKT DI/effect contour. The effect must report every state result back through `dispatchAction`. Project/resource/timeline decisions belong to DKT model actions, not to the task handler.

Actions:

1. Replace `importFiles` app logic with a DKT task: file refs go into runtime task storage, not app state.
	- `dispatchAction`: not for raw `File` objects.
	- `dispatchTask('$fx_handleInputFiles')`: yes. Payload `data` must be serializable; `runtimeRef` may hold `File[]`.
	- Fallback rule: the app task adapter must not import resources through command envelopes after dispatching the task.
2. Add a DKT Project/Session effect for object URL creation, metadata probing, P2P registration, and transfer descriptor creation.
	- `dispatchAction`: effect completion dispatches serializable resource-ready actions.
	- `dispatchTask('$fx_handleInputFiles')`: yes, this is the platform/DI boundary.
	- Fallback rule: effect code may use browser/P2P APIs but may not decide timeline placement from registry snapshots.
3. Add `Project.importResourceResolved` to create/update `Resource` attrs and rel membership in one DKT-owned action.
	- `dispatchAction`: yes, this is the state mutation.
	- `dispatchTask('$fx_*')`: not used.
	- Fallback rule: delete resource import command-envelope fallback for the running app path.
4. Move `addResourceToTimeline` into a scoped Project/Resource DKT action.
	- `dispatchAction`: yes, from `Resource` or `Project` scope.
	- `dispatchTask('$fx_*')`: not used.
	- Fallback rule: no app code may choose video/audio tracks through `getVideoTrack`, `getAudioTrack`, or `env.stores.getRegistry()`.
5. Create linked video audio in the same DKT action, using Resource kind from DKT attrs.
	- `dispatchAction`: yes, same DKT action creates video clip and linked audio clip/rel.
	- `dispatchTask('$fx_*')`: not used.
	- Fallback rule: legacy `includeLinkedAudio` command behavior is only a temporary parity reference until the command path is deleted.

Exit checks:

- `mediaImportActions.ts` is deleted or reduced to a tiny event-to-task adapter.
- MediaBin dispatches scoped DKT actions from Resource scope, not `sourceResourceId` through an app helper.
- The real-media Playwright import case has no `undefined`/`NaN` resource row failure class.
- No new fallback code is allowed. Missing import metadata or track rels must be represented as DKT state/effect errors, not hidden by registry-derived defaults.

## Phase 4: DKT preview and selection derived state

Purpose: remove registry-derived session mirrors.

Boundary rule: use `dispatchAction` for cursor/selection/playback/zoom and for effect results that update DKT attrs. Derived preview data must be DKT comp attrs/rels or DKT-owned state built from DKT rel traversal. React may only consume it through `useAttrs`, `useOne`, `useMany`, or the render-runtime equivalents.

Actions:

1. Move preview structure/frame generation to DKT comp attrs/effects fed by model rel traversal.
	- `dispatchAction`: only for source mutations that make preview dirty or update materialized DKT preview attrs.
	- `dispatchTask('$fx_*')`: not used unless preview needs a platform worker side effect; worker output must dispatch back into DKT.
	- Fallback rule: no registry-derived intermediate preview model in runtime render.
2. Move selected clip summary and track position to DKT comp attrs.
	- `dispatchAction`: yes, selection changes set DKT rels/attrs.
	- `dispatchTask('$fx_*')`: not used.
	- Fallback rule: no source-id reverse lookup and no registry selector fallback for selected clip context.
3. Delete `previewModelFromRegistry` from runtime use.
	- `dispatchAction`: no direct user action; delete runtime call sites after DKT preview comp attrs exist.
	- `dispatchTask('$fx_*')`: not used.
	- Fallback rule: pure functions may remain as math helpers only if fed by DKT attrs/rels, not `ProjectRegistry`.
4. Make `SessionRoot.selectedClip` the selected entity source, not source-id reverse lookup.
	- `dispatchAction`: yes, `selectEntity` updates `selectedClip` rel when a Clip scope is selected.
	- `dispatchTask('$fx_*')`: not used.
	- Fallback rule: no graph scans, registry reads, or legacy selected id mirror may be used to resolve selected scope.

Exit checks:

- Preview render reads DKT-derived `previewStructure` and `previewFrame`.
- Selection reads `selectedClip` rel or scoped attrs, not a source-id graph scan.
- No new fallback code is allowed. If preview needs data, add DKT comp attrs/rels or DKT actions/effects.

## Phase 5: export, transfer, and worker projections

Purpose: remove the remaining registry snapshot patching and worker side truth.

Boundary rule: use `dispatchTask('$fx_*')` for export/render/blob/network/worker operations because those are platform effects. Use `dispatchAction` for every state result from those effects: export status, transfer readiness, generated URLs, errors, and resource data status.

Actions:

1. Move export queue to DKT task/effect.
	- `dispatchAction`: sets export request/status attrs and records success/failure.
	- `dispatchTask('$fx_renderExport')` and `dispatchTask('$fx_exportBlobUrl')`: yes, for rendering and blob URL creation.
	- Fallback rule: export may not clone registry or overlay transfer state.
2. Reflect transfer readiness in Resource attrs/data through DKT actions.
	- `dispatchAction`: yes, resource transfer/status attrs are DKT state.
	- `dispatchTask('$fx_*')`: only for P2P/network interaction.
	- Fallback rule: no export/import path may read transfer manager as a competing source of resource truth.
3. Make export read a DKT-derived render/export plan.
	- `dispatchAction`: mutations update the derived plan inputs.
	- `dispatchTask('$fx_renderExport')`: consumes the DKT plan snapshot passed by DI, not registry.
	- Fallback rule: no registry selector fallback when the DKT plan is incomplete.
4. Keep pure rendering/math functions, but feed them from DKT attrs/rels rather than registry selectors.
	- `dispatchAction`: not used inside pure functions.
	- `dispatchTask('$fx_*')`: not used inside pure functions.
	- Fallback rule: pure helpers must not close over stores, registry snapshots, or runtime ports.

Exit checks:

- Export does not clone registry and overlay transfer state.
- Worker/preview/export projections are downstream from DKT, never competing sources of truth.
- No new fallback code is allowed. Export failures caused by missing DKT state must surface as export errors and then be fixed in DKT state.

## Phase 6: delete legacy source-of-truth code

Purpose: finish the migration instead of living with a bridge forever.

Boundary rule: only DKT state, DKT DI, DKT actions, DKT tasks, and DKT effects remain in the running app source-of-truth contour. Code outside that contour may prepare inputs, host platform APIs, render from `useAttrs`/rels, or run pure calculations from DKT-provided data. It must not decide app behavior from an intermediate representation.

Actions:

1. Delete `ProjectRegistry` from the running app path.
	- `dispatchAction`: all state mutations are DKT actions.
	- `dispatchTask('$fx_*')`: only runtime effects.
	- Fallback rule: no running app module may use registry as fallback source-of-truth.
2. Delete Legend `projects$`/registry store wiring from runtime behavior.
	- `dispatchAction`: DKT updates state.
	- `dispatchTask('$fx_*')`: DI/effect boundary only.
	- Fallback rule: Legend stores may not mirror app truth for render or business decisions.
3. Delete command-envelope dispatch from UI actions.
	- `dispatchAction`: replaces command envelopes for state changes.
	- `dispatchTask('$fx_*')`: replaces command envelopes only when the old operation was really an effect.
	- Fallback rule: no new command builder or command dispatch may be added to UI/app runtime.
4. Keep pure domain reducers/selectors only as isolated testable helpers where they still serve DKT model logic.
	- `dispatchAction`: DKT model actions may call pure helpers with attrs/rels passed as data.
	- `dispatchTask('$fx_*')`: not used inside pure helpers.
	- Fallback rule: helpers may not read global stores or produce a second app representation.

Exit checks:

- The editor can boot, import, edit, preview, export, and sync P2P using DKT actions/tasks/rels as the only app truth.
- Full unit and Playwright suites pass without waits that hide missing DKT attrs/rels.
- No new fallback code is allowed. Any remaining legacy code must be test-only, pure-helper-only, or deleted.

## Phase 1 implementation notes

Phase 1 intentionally does not solve import/export/preview yet. Its job is to make the remaining old path explicit and uncomfortable: no hidden graph scans, no hidden render fallback, no proxy terminology for DKT creation payloads.

Completed in this pass:

- DKT creation payload types are named `MiniCutDkt*Seed`.
- DKT creation shape constants are named `*_CREATION_SHAPE`.
- AppRoot model creation actions are named `create*Model`.
- Runtime bridge helper names now say `Seed`/`Model`, not `Proxy`.
- `createDktPageEditorRenderRuntime` no longer imports receiver debug graph types, no longer calls `debugDumpGraph`, no longer scans source ids through the receiver graph, and no longer falls back to `legacyRuntime` when `pageRuntime` exists.
- Focused unit tests and the Vite video-editor build pass.
