# MiniCut DKT Idiomatic Migration Audit

Date: 2026-05-05

Scope: compare the current MiniCut video editor DKT migration with the DKT AppGuide and the Linkkraft/weather reference. This audit focuses on whether MiniCut uses DKT as the main model/runtime architecture, or only as a sidecar facade around the old command/patch and observable store runtime.

## Target Shape

The target DKT shape from the AppGuide/weather code is:

- Models live as data models with pure attrs, rels, computed state, and concrete actions.
- Actions are concrete descriptors on the model that owns the state being changed.
- Action functions are pure and return data for the declared `to` target.
- Async, I/O, workers, transport, resource loading, and time belong to effects/interfaces/runtime boundaries.
- Runtime state replication uses DKT sync sender/receiver streams. Weather does not replay authority patch envelopes into model actions; the worker model runtime publishes sync messages and page/P2P transports relay those sync messages.
- React reads a replicated runtime/store shape, not a hand-maintained second source of truth pretending to be DKT.

## Audit Table

| Case | Previous MiniCut shape | Why it was not DKT/weather style | Target DKT form | Status |
| --- | --- | --- | --- | --- |
| Clip action-name reducer | `reduceDktClipAction(actionName, payload, attrs)` switched on strings, including `syncAttrs`. | A model action delegated to a generic dispatcher, so the action name, validation, and attr patching were outside the concrete DKT action. `syncAttrs` also made DKT a mirror target for authority patches. | Concrete pure functions per model action: rename, color, opacity, fade, audio, transform. `Clip` calls those functions directly from each action descriptor. | Fixed in `889684e`. |
| Timeline action-name reducer | `reduceDktTimelineClipAction(actionName, payload, attrs)` switched on `moveBy`, `trim`, `resize`, `splitAt`. | The timeline-safe operations were grouped behind one action-name wrapper instead of concrete action functions. | `reduceTimelineMoveByAction`, `reduceTimelineTrimAction`, `reduceTimelineResizeAction`, `reduceTimelineSplitAtAction`. | Fixed in `889684e`. |
| Session action-name reducer | `reduceDktSessionAction(actionName, payload, state)` simulated DKT dispatch outside the model. | Session UI code calculated patches through another generic action-name adapter. | Concrete session patch functions matching concrete `SessionRoot` actions. UI session actions call the corresponding function directly. | Fixed in `889684e`. |
| Authority envelope to DKT replica | `syncAuthorityEnvelopeToDktReplica` converted command patch envelopes into DKT model action dispatches. | This is the opposite of weather: DKT should be the replicated model runtime, not a subscriber that replays old authority patches by dispatching more actions. It also forced the fake `syncAttrs` action. | Remove patch-envelope replay. Keep current registry patch application as the legacy replica path until a real DKT sync sender/receiver replaces it. | Removed in `889684e`; full weather-style runtime sync remains open. |
| Verbose create proxy targets | `createEffectProxy: { to: { _effectProxy: ['<< effect << #', ...] }, fn: () => ({ _effectProxy: { attrs } }) }`. | Extra wrapper key made a simple create-rel target look like an internal adapter. AppGuide shows direct target addresses. | `to: ['<< effect << #', { method, can_create, creation_shape }]`, `fn: () => ({ attrs })`. | Fixed in `889684e`. |
| Data model location | DKT models lived under `src/video-editor/dkt/models`. | The user-requested architecture separates app data models from DKT runtime adapter modules. | `src/video-editor/models` for Clip/Text/Effect/SessionRoot/AppRoot. | Fixed in `4b91cc2`. |
| React component location | React UI lived under `src/video-editor/ui`. | The requested structure names React code as components. | `src/video-editor/components`. | Fixed in `4b91cc2`. |
| Command-builder switch | `domain/actionCommandBuilders.ts` used a large `switch(name)` with duplicated clip/timeline business logic. | It was an old action-to-command interpreter. For clip attrs, it duplicated the same logic DKT actions should own. | Compatibility table delegates clip/timeline attr calculation to concrete DKT action functions. Structural legacy commands remain clearly isolated. | Improved in `1a81e4c`; full removal requires replacing command authority. |
| Disabled history scope | `HISTORY_SCOPE`, `HISTORY_ACTION_SCOPE`, and AppRoot history attrs/actions remained after UI history removal. | Dead history state polluted the DKT/editor API surface. | Remove disabled history from model/editor scope. | Fixed in `78a6173`; worker wire history remains legacy compatibility. |
| Text action | `Text.updateText` is one broad partial attrs update. | It is concrete as a model action, but still broad and patch-shaped. DKT style would prefer intent actions when UI commands are distinct. | Split into `setTextContent`, `setTextStyle`, `setTextBox` if the UI treats these as separate commands. | Not fixed. Medium priority. |
| Effect action | `Effect.updateAttrs` accepts a broad attrs patch. | Similar to text: it is a concrete model action but still mirrors old patch-command shape. | Split into concrete effect actions such as `setEnabled`, `setAmount`, `setParams`, `setColor`, or per effect kind. | Not fixed. Medium priority. |
| Project/resource/track structural commands | Create project, add track, import resource, add resource to timeline, add/remove effect are still old `CMD.*` operations. | These are the remaining core behaviors where DKT is not the authority model. | Project/Track/Resource/Timeline models with concrete actions and effect targets for import/resource I/O. | Not fixed. High priority. |
| React/read model store | `dkt/state/*`, render-sync, harness, and transfer manager still use `@legendapp/state`. | This is not Linkkraft/weather style. Weather receives DKT sync into a page runtime/store. MiniCut still has a hand-maintained observable registry. | Replace observable graph with DKT sync receiver runtime/store or a thin DKT-react-sync equivalent. | Not fixed. Critical. |
| Runtime replication | MiniCut runtime creates local proxies and dispatches actions, but the app still relies on worker command patches for authoritative state. | Weather runs a model runtime in the worker with `sync_sender.addSyncStream(...)`; page and P2P clients exchange DKT sync messages. | Move authority state into DKT model runtime and route SharedWorker/P2P through DKT sync transport. | Not fixed. Critical. |
| File names with Legend | `createLegendActionRuntime.ts`, `createLegendEditorRenderRuntime.ts`, and tests still have legacy names, even with DKT aliases. | Names communicate the old architecture and hide remaining observable dependency. | Rename after the render/store migration, or sooner with compatibility shims. | Not fixed. Low to medium priority. |

## Current Assessment

MiniCut is now less hybrid in the model-action layer: Clip, timeline, and session updates no longer go through action-name switch wrappers, `syncAttrs` is gone, proxy creation uses direct DKT address targets, and models/components have the requested top-level structure.

The migration is still not a clean weather-style DKT app. The remaining hard boundary is authority and replication: MiniCut still treats the command/patch worker as the source of truth, then feeds React through a Legend observable registry. Weather treats the worker model runtime as the source of truth and uses DKT sync streams as the transport protocol. Until MiniCut does the same, the DKT runtime is still partly a local action facade, not the central application runtime.

## Recommended Next Migration Slices

1. Create MiniCut worker model runtime with `prepareAppRuntime({ sync_sender: true, warnUnexpectedAttrs: true, onError })`, mirroring weather's `model-runtime.ts` shape.
2. Add page sync receiver runtime and bridge SharedWorker/P2P messages as DKT sync messages, not MiniCut `PatchEnvelope` messages.
3. Replace `dkt/state/*` and render-sync observable access with the replicated DKT page store.
4. Move project, track, resource, text, and effect structural behaviors into real models/actions/effects.
5. Delete or quarantine `CMD.*`, `PatchEnvelope`, and `actionCommandBuilders` as a legacy import/export compatibility boundary only.
6. Rename remaining `createLegend*` files once they no longer expose Legend observable types.

## Validation Performed

- `npm run test:video-editor -- src/video-editor/dkt/clipActions.test.ts src/video-editor/dkt/timelineActions.test.ts src/video-editor/dkt/sessionActions.test.ts src/video-editor/dkt/runtime/createMiniCutDktRuntime.test.ts src/video-editor/app/createVideoEditorHarness.test.ts`
- `npm run test:video-editor -- src/video-editor/dkt/runtime/createMiniCutDktRuntime.test.ts src/video-editor/components/RendererStage.test.tsx src/video-editor/components/mediaElementRegistry.test.ts src/video-editor/app/createVideoEditorHarness.test.ts`
- `npm run test:video-editor -- src/video-editor/domain/actionCommandBuilders.test.ts src/video-editor/dkt/clipActions.test.ts src/video-editor/dkt/timelineActions.test.ts src/video-editor/app/createLegendActionRuntime.test.ts src/video-editor/app/createVideoEditorHarness.test.ts`
- `npm run test:video-editor -- src/video-editor/dkt/runtime/createMiniCutDktRuntime.test.ts src/video-editor/domain/actionCommandBuilders.test.ts src/video-editor/app/createVideoEditorHarness.test.ts`
- `npm run test:video-editor -- src/video-editor/render-sync/createLegendEditorRenderRuntime.test.ts`