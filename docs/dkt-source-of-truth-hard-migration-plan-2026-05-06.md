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

Actions:

1. Add/confirm DKT rel ownership for `Project -> Track -> Clip -> Effect/Text/Resource`.
2. Add parent context where DKT model logic needs it: `Clip.track`, `Clip.project`, `Effect.clip`, `Effect.project`, either as rels or comp attrs owned by DKT.
3. Move rename/color/opacity/fade/audio/transform/move/trim/resize/split into scoped DKT actions only.
4. Add DKT actions for effect create/remove/reorder and text style/box updates.
5. Replace `createDktActionRuntime` dual dispatch for those operations with scoped DKT dispatch and a temporary one-way compatibility projection out of DKT if export/worker still needs it.

Exit checks:

- Timeline editing UI no longer reads `env.stores.getRegistry()` to decide edit behavior.
- Editing tests create states through DKT actions, not direct Legend registry mutation.

## Phase 3: resource import and add-to-timeline as DKT task/effect

Purpose: remove `mediaImportActions.ts` as a source-of-truth side channel.

Actions:

1. Replace `importFiles` app logic with a DKT task: file refs go into runtime task storage, not app state.
2. Add a DKT Project/Session effect for object URL creation, metadata probing, P2P registration, and transfer descriptor creation.
3. Add `Project.importResourceResolved` to create/update `Resource` attrs and rel membership in one DKT-owned action.
4. Move `addResourceToTimeline` into a scoped Project/Resource DKT action.
5. Create linked video audio in the same DKT action, using Resource kind from DKT attrs.

Exit checks:

- `mediaImportActions.ts` is deleted or reduced to a tiny event-to-task adapter.
- MediaBin dispatches scoped DKT actions from Resource scope, not `sourceResourceId` through an app helper.
- The real-media Playwright import case has no `undefined`/`NaN` resource row failure class.

## Phase 4: DKT preview and selection derived state

Purpose: remove registry-derived session mirrors.

Actions:

1. Move preview structure/frame generation to DKT comp attrs/effects fed by model rel traversal.
2. Move selected clip summary and track position to DKT comp attrs.
3. Delete `previewModelFromRegistry` from runtime use.
4. Make `SessionRoot.selectedClip` the selected entity source, not source-id reverse lookup.

Exit checks:

- Preview render reads DKT-derived `previewStructure` and `previewFrame`.
- Selection reads `selectedClip` rel or scoped attrs, not a source-id graph scan.

## Phase 5: export, transfer, and worker projections

Purpose: remove the remaining registry snapshot patching and worker side truth.

Actions:

1. Move export queue to DKT task/effect.
2. Reflect transfer readiness in Resource attrs/data through DKT actions.
3. Make export read a DKT-derived render/export plan.
4. Keep pure rendering/math functions, but feed them from DKT attrs/rels rather than registry selectors.

Exit checks:

- Export does not clone registry and overlay transfer state.
- Worker/preview/export projections are downstream from DKT, never competing sources of truth.

## Phase 6: delete legacy source-of-truth code

Purpose: finish the migration instead of living with a bridge forever.

Actions:

1. Delete `ProjectRegistry` from the running app path.
2. Delete Legend `projects$`/registry store wiring from runtime behavior.
3. Delete command-envelope dispatch from UI actions.
4. Keep pure domain reducers/selectors only as isolated testable helpers where they still serve DKT model logic.

Exit checks:

- The editor can boot, import, edit, preview, export, and sync P2P using DKT actions/tasks/rels as the only app truth.
- Full unit and Playwright suites pass without waits that hide missing DKT attrs/rels.

## Phase 1 implementation notes

Phase 1 intentionally does not solve import/export/preview yet. Its job is to make the remaining old path explicit and uncomfortable: no hidden graph scans, no hidden render fallback, no proxy terminology for DKT creation payloads.

Completed in this pass:

- DKT creation payload types are named `MiniCutDkt*Seed`.
- DKT creation shape constants are named `*_CREATION_SHAPE`.
- AppRoot model creation actions are named `create*Model`.
- Runtime bridge helper names now say `Seed`/`Model`, not `Proxy`.
- `createDktPageEditorRenderRuntime` no longer imports receiver debug graph types, no longer calls `debugDumpGraph`, no longer scans source ids through the receiver graph, and no longer falls back to `legacyRuntime` when `pageRuntime` exists.
- Focused unit tests and the Vite video-editor build pass.
