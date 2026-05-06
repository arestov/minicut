# DKT source-of-truth postmortem and app guide

Date: 2026-05-06

## Short verdict

The current MiniCut runtime still has two source-of-truth paths:

1. Legacy `ProjectRegistry` command envelopes, Legend stores, and selector/read-model helpers.
2. DKT model graph streamed to React and read top-down through rels and attrs.

The render direction is mostly top-down in React now, but the data production path is not yet clean. The largest remaining problem is the bridge code that materializes a legacy registry into DKT models and then manually updates rel arrays. That bridge encourages reading model objects, searching by source ids, and syncing intermediate session attrs. Those operations are exactly the kind of manual replica/state juggling that causes the `undefined`/`NaN` media and clip bugs.

The target rule is stricter:

- App logic that changes state should enter DKT as an action or DKT task as early as possible.
- DKT models own attrs, comp attrs, rels, comp rels, and effects.
- React reads only scoped attrs/rels from the current traversal scope and dispatches scoped actions.
- Replica/debug objects are internal and must not be used as application data.
- P2P, workers, raw browser media handles, object URLs, and export encoders are allowed boundary code, but they must report results back through DKT actions/tasks instead of becoming an alternate truth graph.

## About the word proxy

The code currently uses names like `MiniCutDktClipProxyInput`, `RESOURCE_PROXY_CREATION_SHAPE`, `clipProxyNodeIds`, and `ensureProxy`. This naming is misleading.

In this app, these objects are not supposed to be app-level "proxies". They are DKT model instances or creation payloads. A real replica proxy, meaning the copied model object inside the synced client/receiver, is an internal transport/runtime detail and should not be touched by render or app logic.

Recommended rename:

- `MiniCutDktClipProxyInput` -> `MiniCutDktClipSeed` or `MiniCutClipCreationAttrs`
- `RESOURCE_PROXY_CREATION_SHAPE` -> `RESOURCE_CREATION_SHAPE`
- `ensureProxy` -> remove, or temporarily `ensureModelBySourceId` only inside migration code
- `clipProxyNodeIds` -> remove with the registry materializer, or temporarily `clipNodeIdsBySourceId`

Important distinction:

- Acceptable: a DKT action creates a `minicut_clip` child under a track using a creation shape.
- Not acceptable: app/render code asks the replica/debug graph for model objects and feeds those objects into another rel to force traversal.

## Answer: should Clip/Effect know timeline/project?

Yes, if a model needs that context for rules, effects, or derived attrs, the context should be represented in the DKT model graph. It should not be rediscovered by graph scans or source-id lookup helpers.

There are two acceptable patterns:

1. Top-down parent ownership: `Project -> Track -> Clip -> Effect` is the primary render traversal. Components needing project context receive it through ancestor scope traversal or read comp attrs exposed by the parent chain.
2. Explicit model rel/comp rel: if `Clip` or `Effect` logic itself needs parent context, add a rel or comp attr to DKT models so DKT owns the relationship. Example target concepts: `Clip.track`, `Clip.project`, `Effect.clip`, `Effect.project`. The concrete DKT declaration should use normal model rel/action semantics, not a debug graph lookup.

Adding parent context as rels is better than manually passing model objects in `materializeRegistryHierarchy`, because DKT becomes the relationship source of truth. The app should not rebuild the tree by copying registry rel arrays into DKT rel arrays after every command.

## What `src/video-editor/app/mediaImportActions.ts` is now

`mediaImportActions.ts` is a harness action factory. It currently does all of these jobs in one place:

- reads the active project from app-side state;
- creates and consumes runtime tasks for `FileList` handles;
- probes browser media metadata and object URLs;
- dispatches legacy resource import commands;
- registers local resources in the transfer manager;
- conditionally adds clips to the timeline;
- decides track placement for `addResourceToTimeline` from the legacy registry.

This does not fit the target architecture. It is boundary/effect code mixed with source-of-truth decisions.

Target shape:

- UI event dispatches a DKT task immediately: `Project.importFiles(files)` or `Session.importFiles(files)`.
- A DKT effect owns browser-only work: object URL, duration probing, File snapshot, P2P registration.
- Effect result dispatches a DKT action: `project.importResourceResolved(...)`.
- DKT action creates the `Resource` model under `Project.resources`.
- Auto-add behavior is a DKT action/effect decision: `project.addResourceToTimeline(resource)` or comp rule, not an app helper reading `isProjectTimelineEmpty` from registry.
- `addResourceToTimeline` should be a scoped resource/project action, not an app function that resolves tracks from `env.stores.getRegistry()`.

## Current violations and migration targets

| Area | Current code | Why it violates the rule | Target design |
| --- | --- | --- | --- |
| Registry materialization | `src/video-editor/dkt/runtime/createMiniCutDktRuntime.ts` uses `registrySnapshot`, `materializeRegistryHierarchy`, `ensureProxy`, `findProxyNodeId`, `getProxyModelByNodeId`, and `setTracks/setResources/setClips/setEffects` | DKT graph is rebuilt from a separate legacy truth. Bugs appear when attrs/rel objects are stale or when app graph and streamed session graph diverge. | Replace legacy registry bridge with DKT actions as the primary mutation path. Project/Track/Clip/Effect actions should create/update rels directly. Keep registry only as export/compat projection until removed. |
| Replica/debug traversal | `src/video-editor/render-sync/createDktPageEditorRenderRuntime.ts` uses `debugDescribeNode`, `debugDumpGraph`, `readGraph`, `findDktScopeBySourceId`, `findSourceIdForDktScope` | Render/dispatch maps scopes by scanning replica/debug data and source attrs. That is not top-down traversal. | Remove source-id graph scans. Components keep DKT scopes from `One`/`Many`. Dispatch uses current scope node directly. Selection should be a rel (`selectedClip`) from SessionRoot, not a source-id lookup. |
| Legacy render runtime fallback | `createDktPageEditorRenderRuntime.ts` delegates root/session attrs, comps, fallback rels, and comp subscriptions to `legacyRuntime` | Render can silently read old Legend registry-derived data. This hides missing DKT attrs/rels. | Delete fallback for production render. Any missing field should be added as DKT attr/comp attr/rel/comp rel. |
| Session derived attrs from registry | `syncSessionPreviewAttrs`, `syncSessionSelectedClipTrackPosition`, `previewModelFromRegistry.ts` | Preview model and selected-clip summary are built from registry snapshots outside DKT comps. | Move preview structure/frame and selected summary into DKT comp attrs or model actions/effects. SessionRoot can expose `previewStructure`, `previewFrame`, `selectedClipSummary`, but they should be derived from DKT rel traversal. |
| Action runtime dual dispatch | `src/video-editor/app/createDktActionRuntime.ts` dispatches DKT action and then legacy command transaction for the same UI event | Two write paths can race or disagree. DKT can update visually while registry remains authoritative for export/import/worker. | UI dispatches one DKT scoped action. Compatibility projection listens to DKT changes if needed, not the other way around. |
| App action environment as state API | `src/video-editor/app/editorActionEnvironment.ts` exposes `stores.getRegistry`, `session.get`, `dkt.dispatchClipAction`, `dkt.dispatchEffectAction` | Application code can read/write state through several ports. This makes it easy to decide business logic outside DKT. | Narrow app boundary to platform ports and task dispatch. State mutation should be DKT actions/effects. Remove `dispatchClipAction` that takes model creation payloads. |
| Media import | `src/video-editor/app/mediaImportActions.ts` | Browser effect logic is mixed with project/timeline decisions and legacy command dispatch. | Move to DKT task/effect pipeline. Keep only a thin UI handler that dispatches task with `FileList` runtime ref. |
| Export snapshot patching | `src/video-editor/app/exportActions.ts` clones registry and overlays transfer state before rendering | Export gets a third view of resource truth by merging transfer manager state into registry. | Export is a DKT task/effect. Transfer readiness should be reflected in Resource attrs/data through DKT actions, then export reads DKT-derived render plan. |
| Legend derived timeline | `src/video-editor/dkt/state/derivedTimeline.ts` and `read-model/*` | These are useful pure read-model functions, but today they run over Legend registry, not DKT model attrs/rels. | Keep pure math functions (`createPreviewFrame`, timing, color filters), but feed them from DKT comp attrs/rels. Remove registry-specific selectors from runtime path. |
| Session store mirrors | `createVideoEditorHarness.ts` keeps `projects$`, `session$`, authority snapshot, and page runtime in sync manually | Multiple stores represent the same active project, selection, cursor, playback, zoom. | SessionRoot DKT model owns session attrs. Browser/app code dispatches DKT session actions. Legacy stores become test/projection compatibility only. |
| Direct test state mutation | Tests set `harness.projects$.entitiesById[...]` directly in some happy-path cases | Tests can create states that production DKT actions cannot create. | Tests should dispatch DKT actions or DKT tasks. For fixture setup, use model creation actions. |

## Concrete bug class from the current failure

The media-bin failure was not really a Playwright waiting problem. The symptom was a third resource row rendered as `undefined`, `video`, `NaNs`. That means React received a DKT Resource scope with rel membership but without current resource attrs.

The bridge can create this because it does all of the following manually:

- create/find a resource model by source id;
- dispatch attr refresh separately;
- collect model objects into a parent `resources` rel array;
- stream that relation to the page;
- render reads attrs from the scope it received.

If any step uses stale model object identity or the wrong graph copy, rel traversal and attrs diverge. Top-down DKT design should make this impossible: creating/importing a Resource under Project should create the child and attrs in one DKT action/effect, and the parent rel should be the creation target, not a later manually assembled array.

## Immediate code hygiene decisions

Do not add helpers that read active session models from the replica to build rel payloads. A helper like `getSyncedProxyModelByNodeId` is the wrong fix. It treats the synced replica as a source of app model objects and makes the bug more subtle.

Do not solve this class of failure by increasing Playwright timeouts. Waiting may hide timing but cannot fix a rel/attrs split.

Do not use `debugDumpGraph` or `debugDescribeNode` for production traversal or source-id reverse lookup. Keep them only for diagnostics and tests.

Do not allow MediaBin to fall back from `sourceResourceId` to a DKT node id when dispatching app commands. A DKT node id is not a domain resource id. The better long-term fix is scoped DKT resource dispatch, but the fallback is unsafe even during migration.

## Recommended migration sequence

1. Rename public `Proxy` terminology to DKT model/seed terminology to stop normalizing the wrong mental model.
2. Add/confirm DKT rels required for top-down traversal: AppRoot -> Project -> Track -> Clip -> Effect/Text/Resource, SessionRoot -> activeProject/selectedClip.
3. Add parent/context rels or comp attrs where model logic needs context: Clip track/project, Effect clip/project. Prefer these over source-id lookups.
4. Move `addResourceToTimeline` into DKT model actions. The Resource or Project scope should dispatch to create Clip under the right Track; linked audio should be created by the same DKT action when resource kind is video.
5. Move file import to a DKT task/effect. The browser boundary can hold `File` runtime refs, but all resulting resource state enters DKT through a model action.
6. Move preview structure and selected summaries to DKT comp attrs built from model rel traversal. `previewModelFromRegistry.ts` can remain temporarily as a pure migration reference, not runtime source of truth.
7. Remove `createDktActionRuntime` dual dispatch. Replace with scoped DKT dispatches and optional compatibility projection out of DKT for worker/export until those are migrated.
8. Remove `createDktPageEditorRenderRuntime` graph scans and legacy fallback. React should use `RootScope`, `One`, `Many`, `Path`, `useAttrs`, and `useActions` directly.
9. Move export queue to DKT task/effect. Export reads render plan from DKT-derived preview/export model and browser effect only produces a Blob/download URL.
10. Delete Legend registry store from the running app once import/export/P2P projections no longer need it. Keep pure domain functions as testable reducers/math only where useful.

## Local rule for future fixes

When a bug appears in render traversal:

- First question: which DKT model owns the missing attr or rel?
- Second question: which DKT action/effect should update it?
- Third question: which parent-to-child traversal should expose it?

Avoid this sequence:

- scan debug graph;
- map source ids to node ids;
- pull model objects from the receiver;
- write a cached helper to compare replica state;
- patch UI fallback strings or Playwright waits.

That sequence treats symptoms and reintroduces the split-brain state that the DKT migration is supposed to remove.
