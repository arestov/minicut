# Legend State to DKT-shape migration plan

Дата: 2026-05-05

Цель: приблизить текущий Legend State код к целевой DKT форме без замены runtime. Legend остается backing store, `MemoryWorkerAuthority`/patch protocol остаются рабочими, но model/action/derived слои получают DKT-like форму: `session root -> node scopes -> attrs/rels/comps -> node actions -> effects/ports`.

Это продолжение DKT-style render migration: React UI уже читает через scoped render facade. Следующий шаг - сделать внутренний Legend/action код похожим на будущий DKT слой, чтобы реальная замена runtime стала механической, а не переписыванием всей бизнес-логики.

## Что выглядит самым сложным

Самая сложная часть - `commands/actions`, но не из-за самих команд. Самая сложная зона сейчас находится между `src/video-editor/app/createVideoEditorHarness.ts`, `src/video-editor/domain/applyCommand.ts`, `src/video-editor/domain/validateCommand.ts` и effect-boundary кодом для File/media/P2P/export.

Почему именно она:

- `createVideoEditorHarness.ts` смешивает UI-facing actions, session mutations, domain commands, async media effects, object URL lifecycle, resource transfer sync, export effects и history sync.
- Многие actions сейчас implicit-selected: `renameSelectedClip`, `updateSelectedText`, `splitSelectedClip`, `deleteSelectedClip` читают `session$.selectedEntityId` внутри action. В DKT целевая форма лучше: action получает `_node_id`/scope и работает от конкретного узла.
- `applyCommand.ts` уже хорош как pure command -> patch-envelope слой, но он большой switch без явных node action declarations. Его можно приблизить к DKT через таблицу command handlers и scoped action builder, не меняя wire protocol.
- Async chains вроде `importFiles -> RESOURCE_IMPORT -> registerLocalResource -> auto add to timeline -> select clip` больше похожи на DKT walker/transaction, чем на одиночный command. Их нельзя просто переименовать: нужно явно описать transaction context, created ids, session updates и post-commit effects.
- `applyPatchEnvelope` проще: это Legend adapter для patch protocol. Его можно сделать table-driven и DKT-like, но он не главный риск.
- `derivedTimeline.ts` объемный, но в основном pure read-model/comp logic. Его проще разделить на pure graph readers и Legend computed wrappers.

Итог: hardest part = action transaction boundary: scoped actions + command builders + post-commit session/effect handling.

## Target shape before real DKT

Без добавления DKT runtime код должен прийти к такой форме:

```ts
// target shape, not exact final API
runEditorAction({
  scope: { type: 'clip', nodeId: clipId },
  name: 'splitAt',
  payload: { time },
  tx,
})
```

Где:

- `scope.nodeId` является будущим `_node_id`.
- `session` - отдельный root scope/model, а не набор ad-hoc `.set()` вызовов по harness.
- `attrs/rels` остаются в текущем graph shape, но readers/writers идут через маленький adapter слой.
- Domain mutations остаются pure: input registry + scoped action/command -> patch envelope + metadata.
- Effects (`File`, duration probing, object URLs, export renderer, resource transfer, P2P authority) живут за DI ports.
- Multi-step flows возвращают transaction result: patches, session patch, created/deleted ids, postCommit effects.

## Non-goals

- Не переписывать проект на DKT runtime сейчас.
- Не менять wire protocol `CMD`, `PATCH`, `MSG` в первом проходе.
- Не ломать public harness API для UI/tests: `harness.actions` может остаться compatibility facade.
- Не переносить `File`, `Blob`, object URL, P2P transport внутрь domain code.

## Step 1: document current-to-target boundary

Commit: `docs: add legend dkt-shape migration plan`

Files:

- Add `docs/legend-dkt-shape-migration-plan-2026-05-05.md`.

What to do:

- Зафиксировать target shape, сложную часть, порядок миграции, файлы и тесты.
- Отдельно отметить, что hardest part - action transaction boundary, а не Legend store сам по себе.

Tests:

- Не требуются, markdown-only.

Done when:

- Документ можно использовать как checklist для серии conventional commits.

## Step 2: introduce scoped action request types

Commit: `feat(video-editor): add scoped action request contracts`

Files:

- Add `src/video-editor/domain/actionScope.ts`.
- Add `src/video-editor/domain/actionRequests.ts`.
- Update `src/video-editor/render-sync/createLegendEditorRenderRuntime.ts` to use shared action names/types where practical.
- Optionally update `src/video-editor/render-sync/EditorRenderRuntime.tsx` to import the shared `EditorActionName`/payload type.

What to do:

- Define `EditorActionScope` as the domain-level equivalent of current `EditorScope`: root/session/history/project/timeline/track/resource/clip/effect/text.
- Define action request shape: `{ scope, name, payload }`.
- Introduce typed action names for existing render actions: `createProject`, `setActiveProject`, `addTrack`, `setCursor`, `zoomTimeline`, `select`, `moveBy`, `resize`, `splitAt`, etc.
- Keep it type-only/contract-only first. Do not move behavior yet.

Tests:

- Run `npm run test:video-editor -- src/video-editor/render-sync/createLegendEditorRenderRuntime.test.ts`.
- Run `npm run test:video-editor -- src/video-editor/tests/video-editor.happy-path.test.tsx`.

New tests:

- Add compile/runtime test if payload validation is implemented: `src/video-editor/domain/actionRequests.test.ts`.

Done when:

- Render-sync dispatch and upcoming harness runtime can share the same action request vocabulary.

## Step 3: split harness action runtime from harness construction

Commit: `refactor(video-editor): move harness actions behind scoped runtime`

Files:

- Add `src/video-editor/app/createLegendActionRuntime.ts`.
- Add `src/video-editor/app/actionRuntimeTypes.ts`.
- Update `src/video-editor/app/createVideoEditorHarness.ts`.
- Update `src/video-editor/app/createVideoEditorHarness.test.ts` if public action setup needs direct assertions.

What to do:

- Move the current `const actions = { ... }` block out of `createVideoEditorHarness.ts` into `createLegendActionRuntime`.
- Pass dependencies explicitly: `projects$`, `session$`, `history$`, `dispatch`, `syncHistoryState`, `platform`, `resourceTransferManager`, `exportRenderer`, `playbackDuration$`, lifecycle sets/timers where needed.
- Keep `harness.actions` as compatibility facade, but internally expose `runAction(request)`.
- This is still Legend-backed and still calls existing domain commands.

Tests:

- Run `npm run test:video-editor -- src/video-editor/app/createVideoEditorHarness.test.ts`.
- Run `npm run test:video-editor -- src/video-editor/render-sync/createLegendEditorRenderRuntime.test.ts src/video-editor/tests/video-editor.happy-path.test.tsx`.
- Run `npm run video-editor:build`.

Done when:

- `createVideoEditorHarness.ts` mostly wires stores/effects/bootstrap.
- Action implementation lives in one runtime module with explicit dependencies.
- Public behavior and `harness.actions` remain unchanged.

## Step 4: convert selected actions to node-scoped actions

Commit: `refactor(video-editor): make clip actions node scoped`

Files:

- Update `src/video-editor/app/createLegendActionRuntime.ts`.
- Update `src/video-editor/render-sync/createLegendEditorRenderRuntime.ts`.
- Update `src/video-editor/ui/inspector/InspectorClipHeader.tsx`.
- Update `src/video-editor/ui/inspector/InspectorEditTabPanel.tsx`.
- Update `src/video-editor/ui/inspector/InspectorColorTabPanel.tsx`.
- Update `src/video-editor/ui/inspector/InspectorAudioTabPanel.tsx`.
- Update `src/video-editor/ui/inspector/InspectorExportTabPanel.tsx` only if export gets scoped by clip id.

What to do:

- Add scoped runtime actions for clip scope: `rename`, `color`, `setOpacity`, `setFade`, `setTransform`, `setAudio`, `trim`, `delete`, `splitAt`, `addEffect`, `addColorCorrection`.
- Replace selected-clip implementations with node-id implementations internally.
- Keep old `renameSelectedClip`/`deleteSelectedClip` methods as wrappers that resolve selected clip and call scoped runtime. This avoids a large UI break.
- Render-sync dispatch should stop using selected wrappers where it already has `scope.nodeId`.

Tests:

- Run `npm run test:video-editor -- src/video-editor/tests/video-editor.happy-path.test.tsx`.
- Run `npm run test:video-editor -- src/video-editor/domain/timelineInvariants.test.ts src/video-editor/domain/textEditing.test.ts src/video-editor/domain/colorEffects.test.ts`.

New tests:

- Add cases to `src/video-editor/app/createVideoEditorHarness.test.ts` verifying scoped clip action updates the passed clip id even when another clip is selected.

Done when:

- Core clip actions no longer need `session$.selectedEntityId` except compatibility wrappers.
- The future `_node_id` path is visible in code.

## Step 5: introduce command builder/action handler registry

Commit: `refactor(video-editor): map scoped actions through command handlers`

Files:

- Add `src/video-editor/domain/actionCommandBuilders.ts`.
- Add `src/video-editor/domain/actionTransactions.ts`.
- Update `src/video-editor/domain/applyCommand.ts` only where helpers need to be exported/reused.
- Update `src/video-editor/app/createLegendActionRuntime.ts`.

What to do:

- Create a table from `{ scope.type, actionName }` to command builder.
- A command builder returns one of:
  - `{ type: 'command', command }`
  - `{ type: 'session', patch }`
  - `{ type: 'effect', effect }`
  - `{ type: 'transaction', steps }`
- Start with sync/simple actions: clip move/resize/update attrs, track create, text update, effect update/remove.
- Keep the existing `CMD` enum as wire format, but stop building commands ad hoc inside harness actions.

Tests:

- Add `src/video-editor/domain/actionCommandBuilders.test.ts`.
- Run `npm run test:video-editor -- src/video-editor/domain/actionCommandBuilders.test.ts src/video-editor/domain/validateCommand.test.ts src/video-editor/domain/randomCommandInvariants.test.ts`.
- Run `npm run test:video-editor -- src/video-editor/app/createVideoEditorHarness.test.ts`.

Done when:

- Most sync commands are built outside harness.
- Harness action runtime becomes an executor, not the place where command payloads are invented.

## Step 6: split applyCommand into command handler modules

Commit: `refactor(video-editor): split command handlers by graph domain`

Files:

- Add `src/video-editor/domain/commands/projectCommands.ts`.
- Add `src/video-editor/domain/commands/resourceCommands.ts`.
- Add `src/video-editor/domain/commands/timelineCommands.ts`.
- Add `src/video-editor/domain/commands/clipCommands.ts`.
- Add `src/video-editor/domain/commands/effectCommands.ts`.
- Add `src/video-editor/domain/commands/textCommands.ts`.
- Update `src/video-editor/domain/applyCommand.ts` to delegate to handlers.
- Update `src/video-editor/domain/validateCommand.ts` only if validators are split in the same pass.

What to do:

- Keep `buildDispatchResult(registry, command, context)` public API stable.
- Move each `CMD.*` case into domain-specific handler functions.
- Preserve patch envelopes and created/deleted id metadata exactly.
- Do not combine with behavioral changes.

Tests:

- Run `npm run test:video-editor -- src/video-editor/domain/validateCommand.test.ts src/video-editor/domain/timelineInvariants.test.ts src/video-editor/domain/randomCommandInvariants.test.ts`.
- Run `npm run test:video-editor -- src/video-editor/app/createVideoEditorHarness.test.ts src/video-editor/tests/video-editor.happy-path.test.tsx`.

Done when:

- `applyCommand.ts` reads like a dispatcher/table rather than one large switch.
- Command handlers become close to DKT action implementation bodies.

## Step 7: make patch application table-driven

Commit: `refactor(video-editor): table drive legend patch application`

Files:

- Update `src/video-editor/legend/projectStore.ts`.
- Add `src/video-editor/legend/patchAppliers.ts` if the table becomes non-trivial.
- Update `src/video-editor/legend/projectStore.test.ts` if added.

What to do:

- Convert the switch in `applyPatchEnvelope` into a map of patch appliers.
- Keep Legend-specific code here only: `.set`, `.assign`, `mergeIntoObservable`, `batch`.
- Preserve patch protocol exactly.
- Consider extracting scalar path application into a helper that can later be swapped for DKT attr mutation.

Tests:

- Add `src/video-editor/legend/projectStore.test.ts` for `PROJECT_SET`, `ENTITY_SET`, `ATTRS_MERGE`, `SCALAR_SET`, `REL_SPLICE`, `ENTITY_DELETE`.
- Run `npm run test:video-editor -- src/video-editor/legend/projectStore.test.ts src/video-editor/app/createVideoEditorHarness.test.ts`.
- Run `npm run test:video-editor -- src/video-editor/tests/video-editor.happy-path.test.tsx`.

Done when:

- Patch application is isolated as the Legend mutation adapter.
- Future DKT store writer can implement the same applier contract.

## Step 8: model session root explicitly

Commit: `refactor(video-editor): model editor session as root state`

Files:

- Add `src/video-editor/domain/sessionActions.ts`.
- Add `src/video-editor/legend/sessionModel.ts` or update `src/video-editor/legend/sessionStore.ts`.
- Update `src/video-editor/app/createLegendActionRuntime.ts`.
- Update `src/video-editor/render-sync/createLegendEditorRenderRuntime.ts`.

What to do:

- Treat `session` as a real root model with attrs: `activeProjectId`, `selectedEntityId`, `activeInspectorTab`, `cursor`, `isPlaying`, `timelineZoom`.
- Move direct session `.set()` calls into named session actions: `setActiveProject`, `selectEntity`, `setCursor`, `togglePlayback`, `tickPlayback`, `zoomTimeline`, `setActiveInspectorTab`.
- Keep session local/tab-scoped, separate from persisted project graph.
- Make root active project relation explicit: root/session -> activeProject.

Tests:

- Add/extend `src/video-editor/legend/sessionStore.test.ts` or `src/video-editor/domain/sessionActions.test.ts`.
- Run `npm run test:video-editor -- src/video-editor/app/roomUrlState.test.ts src/video-editor/app/createVideoEditorHarness.test.ts src/video-editor/render-sync/createLegendEditorRenderRuntime.test.ts`.
- Run `npm run test:video-editor -- src/video-editor/tests/video-editor.happy-path.test.tsx`.

Done when:

- Session mutations are named and centralized.
- The session root shape matches the future DKT session root idea.

## Step 9: move effects behind explicit DI ports

Commit: `refactor(video-editor): isolate media export and transfer effects`

Files:

- Add `src/video-editor/app/effects/mediaImportEffects.ts`.
- Add `src/video-editor/app/effects/exportEffects.ts`.
- Add `src/video-editor/app/effects/resourceTransferEffects.ts` if needed.
- Update `src/video-editor/app/platform/types.ts` only if port types need clearer names.
- Update `src/video-editor/app/createLegendActionRuntime.ts`.
- Update `src/video-editor/app/createVideoEditorHarness.ts`.

What to do:

- Move `File` detection, object URL creation/revoke registration, metadata duration probing, export rendering and resource transfer registration out of action command construction.
- Action runtime should call named effects, not inline platform logic.
- Effects may return action transaction follow-up data, e.g. imported resource id, local resource registration metadata, export download URL.
- Keep browser/node platform adapters unchanged unless types need tightening.

Tests:

- Run `npm run test:video-editor -- src/video-editor/app/createVideoEditorHarness.test.ts src/video-editor/media/resourceTransferManager.test.ts src/video-editor/render/exportRenderer.test.ts`.
- Run `npm run test:video-editor -- src/video-editor/tests/video-editor.happy-path.test.tsx`.

New tests:

- Add focused tests for media import effect if logic is moved out of harness: unsupported file filtering, duration fallback, object URL cleanup registration.

Done when:

- `File`, object URL, export renderer and P2P/resource transfer concerns are behind explicit ports/effects.
- Domain command builders remain pure and serializable.

## Step 10: introduce transaction/walker semantics for multi-step flows

Commit: `feat(video-editor): add action transaction executor`

Files:

- Add `src/video-editor/app/actionTransactionExecutor.ts`.
- Update `src/video-editor/app/createLegendActionRuntime.ts`.
- Update `src/video-editor/domain/actionTransactions.ts`.
- Update `src/video-editor/domain/actionCommandBuilders.ts`.
- Update `src/video-editor/app/createVideoEditorHarness.test.ts`.

What to do:

- Implement a small pre-DKT transaction executor with explicit phases:
  1. build command/session/effect steps;
  2. dispatch graph commands;
  3. collect created/deleted ids;
  4. apply session updates;
  5. run post-commit effects;
  6. sync history.
- Convert multi-step flows first:
  - `createProject -> select project -> reset cursor/selection`;
  - `importFiles -> resource import -> register local resource -> auto add to timeline if empty`;
  - `splitClip -> select created right clip`;
  - `deleteClip -> clear selectedEntityId`;
  - `queueSelectedClipExport -> export effect with snapshot`.
- This is the closest pre-DKT equivalent of inline walker transaction semantics.

Tests:

- Add `src/video-editor/app/actionTransactionExecutor.test.ts`.
- Extend `src/video-editor/app/createVideoEditorHarness.test.ts` for created id/session update order.
- Run `npm run test:video-editor -- src/video-editor/app/actionTransactionExecutor.test.ts src/video-editor/app/createVideoEditorHarness.test.ts src/video-editor/tests/video-editor.happy-path.test.tsx`.
- Run `npm run test:video-editor -- src/video-editor/domain/randomCommandInvariants.test.ts`.

Done when:

- Multi-step actions no longer hide `.then(...)` session mutations inside random action bodies.
- Created ids/deleted ids/session updates are first-class transaction outputs.

## Step 11: split derivedTimeline into pure comps and Legend wrappers

Commit: `refactor(video-editor): split derived timeline comps from legend wrappers`

Files:

- Add `src/video-editor/domain/previewReadModels.ts` or `src/video-editor/domain/timelineComps.ts`.
- Update `src/video-editor/legend/derivedTimeline.ts`.
- Update `src/video-editor/render-sync/previewReadModels.ts`.
- Update `src/video-editor/render-sync/createLegendEditorRenderRuntime.ts` for comp registry if needed.

What to do:

- Move pure calculations out of Legend computed wrappers:
  - timeline clip intervals;
  - playback duration;
  - active clips at cursor;
  - preview clip source resolution;
  - selected clip summary / track position.
- Keep Legend-specific wrappers as `createX$` functions only.
- Make comp names and dependencies visible, closer to DKT computed attrs/comps.

Tests:

- Run `npm run test:video-editor -- src/video-editor/legend/derivedTimeline.test.ts src/video-editor/render-sync/createLegendEditorRenderRuntime.test.ts src/video-editor/ui/RendererStage.test.tsx`.
- Run `npm run test:video-editor -- src/video-editor/tests/video-editor.happy-path.test.tsx`.

New tests:

- Add pure tests for extracted comp functions if existing `derivedTimeline.test.ts` is too Legend-specific.

Done when:

- Derived logic can be reused by a DKT runtime without importing Legend.
- Legend wrappers become thin computed adapters.

## Step 12: cleanup compatibility wrappers and enforce boundaries

Commit: `refactor(video-editor): enforce dkt-shaped legend boundaries`

Files:

- Update `src/video-editor/app/createLegendActionRuntime.ts`.
- Update `src/video-editor/render-sync/createLegendEditorRenderRuntime.ts`.
- Update `src/video-editor/app/createVideoEditorHarness.ts`.
- Update tests as needed.
- Optionally add architecture notes to `docs/` if decisions changed.

What to do:

- Mark selected-wrapper actions as compatibility-only or remove them if UI no longer calls them.
- Ensure direct Legend `.get()`/`.set()` calls are constrained to `legend/*`, action runtime adapter, and render-sync adapter.
- Ensure domain code stays pure and does not import Legend.
- Ensure UI calls scoped dispatch/action runtime, not harness internals.

Tests:

- Run `rg -n "@legendapp/state|\.get\(|\.set\(" src/video-editor/app src/video-editor/domain src/video-editor/ui src/video-editor/render-sync src/video-editor/legend` and manually classify allowed adapter hits.
- Run `npm run test:video-editor`.
- Run `npm run video-editor:build`.

Done when:

- The remaining Legend-specific code is adapter-shaped.
- The future DKT migration can replace adapters instead of rewriting UI/domain logic.

## Suggested implementation order

Recommended order:

1. Contract/types first (`actionScope`, `actionRequests`).
2. Move action runtime out of harness without behavior changes.
3. Convert selected clip actions to node-scoped actions.
4. Add command builder registry.
5. Split command handlers.
6. Table-drive patch appliers.
7. Model session root actions.
8. Isolate effects.
9. Add transaction executor.
10. Split derived comps.
11. Enforce boundaries.

Reason: this order keeps each PR/commit testable and avoids touching async effects and command semantics at the same time.

## Minimal test matrix per phase

Fast checks for most refactors:

```powershell
npm run test:video-editor -- src/video-editor/app/createVideoEditorHarness.test.ts src/video-editor/render-sync/createLegendEditorRenderRuntime.test.ts src/video-editor/tests/video-editor.happy-path.test.tsx
npm run video-editor:build
```

Domain/command-heavy checks:

```powershell
npm run test:video-editor -- src/video-editor/domain/validateCommand.test.ts src/video-editor/domain/timelineInvariants.test.ts src/video-editor/domain/randomCommandInvariants.test.ts src/video-editor/domain/textEditing.test.ts src/video-editor/domain/colorEffects.test.ts
```

Full completion check:

```powershell
npm run test:video-editor
npm run video-editor:build
```

## Risk notes

- Do not combine action-runtime extraction with transaction executor. That would make failures hard to localize.
- Do not move File/object URL logic into domain command builders. It must stay in effects/ports.
- Be careful with `session$.activeProjectId` vs `projects$.activeProjectId`: session is tab-local source of truth, registry active project is fallback/cross-tab hint.
- When converting selected actions to `_node_id`, add tests with two clips selected/targeted differently.
- Preserve patch envelope `version` behavior; many tests and worker flows rely on it.
- Keep P2P resource transfer sync after every authoritative patch until a dedicated effect transaction owns it.
