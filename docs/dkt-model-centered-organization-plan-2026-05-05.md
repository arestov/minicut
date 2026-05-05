# План модельно-центричной DKT-организации MiniCut

Дата: 2026-05-05

Основа анализа:

- текущая рабочая копия MiniCut;
- `docs/dkt-idiomatic-migration-completion-2026-05-05.md`;
- стиль Linkkraft/weather в `D:\code\linkcraft\weather\src\models` и `D:\code\linkcraft\weather\src\worker\model-runtime.ts`;
- DKT AppGuide: модели держат `attrs`, `rels`, `actions`, `effects`; actions чистые и пишут в конкретные `to`; I/O уходит в `effects.api/in/out`; forwarding между моделями идет через rel-targets, `$fx_` и `sub_flow`/child action boundaries.

## Главный вывод

MiniCut уже начал двигаться к DKT: есть `src/video-editor/models/*`, конкретные actions у Clip/Text/Effect/SessionRoot, убрана app history surface, появились Project/Track/Resource proxy-модели и зачаток DKT SharedWorker/sync transport.

Но код еще не организован вокруг моделей в стиле Linkkraft. Сейчас бизнес-поведение рассыпано по четырем слоям:

1. `models/*` — DKT declarations, но часть action logic вынесена в `dkt/*Actions.ts`.
2. `app/*Actions.ts` и `createDktActionRuntime.ts` — UI action facade, который одновременно диспатчит DKT actions и старые `CMD.*` commands.
3. `domain/*CommandHandlers.ts` — фактическая authority-бизнес-логика создания проектов, ресурсов, треков, клипов, эффектов и rel-splice.
4. `dkt/state/*` / `render-sync/*` — read-model/derived state на `@legendapp/state`, а не на DKT sync receiver shape.

В Linkkraft/weather основная логика наоборот находится возле модели-владельца: model file содержит attrs/rels/actions, model-local `effects.ts` содержит API/effects, helpers лежат рядом с моделью, runtime только запускает DKT app и sync streams.

## Таблица action-функций MiniCut

| Где сейчас лежит | Функции/actions | Фактическая модель-владелец | Можно ли перенести ближе к модели | Что сделать |
| --- | --- | --- | --- | --- |
| `models/AppRoot.ts` | `replaceRegistrySnapshot` | Не DKT-домен, а legacy registry snapshot bridge | Не как финальную модельную логику | Удалить после перевода authority на DKT sync. До удаления держать как compatibility quarantine, не развивать. |
| `models/AppRoot.ts` | `createProjectProxy` | Сейчас AppRoot; в чистой форме AppRoot должен создавать Project | Да, но не как proxy | Переименовать в `createProject`, убрать `sourceProjectId`, создавать реальный Project rel. Нормализацию payload вынести в `models/Project/actions.ts`. |
| `models/AppRoot.ts` | `createTrackProxy` | Сейчас AppRoot; в чистой форме Project/Timeline | Да, сменить owner | Перенести в `Project.addTrack` или `Timeline.addTrack`; target должен писать в rel `tracks`, а не в flat root `track`. |
| `models/AppRoot.ts` | `createResourceProxy` | Сейчас AppRoot; в чистой форме Project/Resource | Да, сменить owner | Перенести в `Project.importResource` + `Resource` creation shape. File/object URL work вынести в `$fx_importResource`/resource API. |
| `models/AppRoot.ts` | `createClipProxy` | Сейчас AppRoot; в чистой форме Track/Clip | Да, сменить owner | Перенести в `Track.addClip` или `Timeline.addClip`; linked audio должен быть multi-step DKT action, не command handler. |
| `models/AppRoot.ts` | `createTextProxy` | Сейчас AppRoot; в чистой форме Track/Text/Clip | Да, сменить owner | Перенести в `Track.addTextClip`: создать Text и Clip через refs, записать Clip в `Track.clips`. |
| `models/AppRoot.ts` | `createEffectProxy` | Сейчас AppRoot; в чистой форме Clip/Effect | Да, сменить owner | Перенести в `Clip.addEffect`, `Clip.addColorCorrection`; Effect остается child rel/attached model. |
| `models/AppRoot.ts` | `setActiveProjectHint` | AppRoot/session routing | Частично | Если нужен UI hint, оставить на AppRoot; если это session state, перенести в SessionRoot. |
| `models/Clip.ts` + `dkt/clipActions.ts` | `updateOpacity`, `rename`, `color`, `setFade`, `setAudio`, `setTransform` | Clip | Да | Перенести reducers/normalizers из `dkt/clipActions.ts` в `models/Clip/actions.ts` или рядом с `Clip.ts`. Оставить `dkt/clipActions.ts` только как временный re-export для тестов. |
| `models/Clip.ts` + `dkt/timelineActions.ts` | `moveBy`, `trim`, `resize` | Clip, но с контекстом Track/Timeline | Да, но с уточнением owner | Простые attr edits могут остаться Clip actions. Rel-sensitive операции, которые требуют parent track/order, лучше оформить как Track actions forwarding to Clip or modifying `tracks.clips`. |
| `models/Clip.ts` + `dkt/timelineActions.ts` | `splitAt` | Track/Timeline, не только Clip | Да, сменить owner | Перевести в `Track.splitClipAt`: уменьшить source Clip, создать right Clip, клонировать effects, вставить right Clip в `Track.clips` через `can_hold_refs`. |
| `models/Text.ts` + `dkt/textActions.ts` | `setTextContent`, `setTextStyle`, `setTextBox` | Text | Да | Перенести reducers и defaults в `models/Text/actions.ts` / `models/Text/defaults.ts`; UI не должен отправлять broad `updateText`. |
| `models/Effect.ts` + `dkt/effectActions.ts` | `setEffectName`, `setEffectKind`, `setEffectEnabled`, `setEffectAmount`, `setEffectParams`, `setEffectColor` | Effect | Да | Перенести reducers в `models/Effect/actions.ts`; для effect kind defaults сделать `models/Effect/defaults.ts`. |
| `models/Project.ts` | `renameProject`, `setProjectFormat`, `setProjectDuration` | Project | Уже близко | Добавить rels `timeline`, `tracks`, `resources`; Project должен стать настоящим owner структурных операций. |
| `models/Track.ts` | `renameTrack`, `setTrackMuted`, `setTrackLocked` | Track | Уже близко | Добавить rel `clips` с корректным linking/creation strategy; перенести timeline operations из command handlers. |
| `models/Resource.ts` | `renameResource`, `setResourceStatus` | Resource | Уже близко | Добавить attrs/comp attrs для chunk progress/playable; перенести resource transfer status updates в model actions/effects. |
| `models/SessionRoot.ts` + `dkt/sessionActions.ts` | `selectEntity`, `setActiveProject`, `setCursor`, `togglePlayback`, `zoomTimeline` | SessionRoot | Да | Перенести descriptors/reducers из `dkt/sessionActions.ts` в `models/SessionRoot/actions.ts`. `app/sessionRootActions.ts` должен стать UI adapter без бизнес-логики. |
| `app/sessionRootActions.ts` | `createProject`, `setActiveProject`, `addTrack`, `selectEntity`, `setActiveInspectorTab`, playback/cursor/zoom actions | SessionRoot + AppRoot/Project | Да, разделить | Session-only оставить SessionRoot. `createProject` -> AppRoot action. `addTrack` -> Project/Timeline action. UI facade только вызывает DKT dispatch. |
| `app/createDktActionRuntime.ts` | `renameClipById`, `colorClipById`, opacity/fade/transform/audio/trim/resize/split/move wrappers | Clip/Track | Частично | Это должен быть thin React command adapter. Убрать чтение legacy registry как source of truth после появления DKT read model. |
| `app/createDktActionRuntime.ts` | `addEffectToClip`, `addColorCorrectionToClip`, `removeEffectFromClip` | Clip/Effect | Да | Перевести в `Clip.addEffect`, `Clip.addColorCorrection`, `Clip.removeEffect`, `Clip.reorderEffect`; удалить `CMD.EFFECT_*` path. |
| `app/createDktActionRuntime.ts` | `updateTextById`, `updateEffectAttrs` | Text/Effect | Частично | UI facade может остаться, но должен диспатчить только concrete DKT actions, без `dispatchBuiltCommand`. |
| `app/mediaImportActions.ts` | `importSampleResource`, `importFiles`, `addResourceToTimeline`, `addTextClip` | Project/Resource/Track/Text | Да | `importFiles` -> Project/Resource effect flow; `addResourceToTimeline` -> Track/Project action; `addTextClip` -> Track action. File APIs остаются в effects/interfaces. |
| `app/exportActions.ts` | `queueClipExportById`, `queueSelectedClipExport`, `queueProjectExport`, `createExportRegistrySnapshot` | Project/Clip + export effect | Да | Сделать `$fx_renderExport` / `$fx_exportBlobUrl` model effect. Snapshot брать из DKT runtime/read model, не из observable registry. |
| `domain/projectCommandHandlers.ts` | `handleProjectCreate`, `handleResourceImport`, `handleTrackCreate` | AppRoot/Project/Resource/Track | Да | Перенести как DKT actions и creation shapes. Оставить command handler только в legacy import compatibility до удаления `CMD.*`. |
| `domain/timelineCommandHandlers.ts` | `handleTimelineAddClip`, `handleTextAdd`, `handleTimelineMoveClip`, `handleTimelineSplitClip`, `handleTimelineDeleteClip` | Track/Clip/Text/Effect | Да | Разложить по Track/Clip actions; удалить patch envelope как основной write path. |
| `domain/effectCommandHandlers.ts` | `handleEffectAdd`, `handleEffectUpdateAttrs`, `handleEffectReorder`, `handleEffectRemove` | Clip/Effect | Да | Добавить rel actions на Clip; Effect update уже есть в DKT, add/remove/reorder должны стать Clip rel mutations. |
| `domain/clipCommandHandlers.ts`, `domain/textCommandHandlers.ts` | `handleClipUpdateAttrs`, `handleTextUpdateAttrs` | Clip/Text | Да | Удалить после перевода UI на concrete DKT actions; временно оставить как command compatibility. |
| `dkt/runtime/createMiniCutDktRuntime.ts` | `ensureProxy`, `dispatchProjectAction`, `dispatchTrackAction`, `dispatchResourceAction`, `dispatchClipAction`, `dispatchTextAction`, `dispatchEffectAction` | Runtime bridge, не model owner | Частично | В финале заменить proxy maps на DKT sync receiver/model ids. Runtime не должен знать бизнес-мэппинг `source*Id -> proxy`. |
| `dkt/runtime/createMiniCutDktRuntime.ts` | `dispatchCommand`, `replaceRegistrySnapshot`, `getRegistrySnapshot` | Legacy authority bridge | Нет как DKT стиль | Удалить после worker DKT authority. Сейчас это quarantine path, не целевая архитектура. |

## Сравнение стиля Linkkraft/weather и MiniCut

| Область | Linkkraft/weather | MiniCut сейчас | Что нужно изменить |
| --- | --- | --- | --- |
| Организация model files | `models/AppRoot.ts`, `WeatherLocation.ts`, `SelectedLocation.ts`; helpers/effects рядом с моделью (`AppRoot/effects.ts`, `SelectedLocationPopoverRouter/effects.ts`). | Модели есть, но action reducers лежат в `dkt/*Actions.ts`, app actions в `app/*Actions.ts`, authority logic в `domain/*CommandHandlers.ts`. | Ввести модельные папки: `models/Clip/actions.ts`, `models/Project/actions.ts`, `models/Resource/effects.ts`, etc. `dkt/*Actions.ts` постепенно удалить или сделать re-export. |
| Actions | Actions объявлены у модели-владельца; multi-step actions пишут в attrs/rels, создают children через `creation_shape`, дергают `$fx_` через `to`. | Часть actions в DKT-моделях, но структурные операции идут через `CMD.*`; UI facade одновременно dispatch DKT и command. | Модель становится write path. UI action runtime вызывает DKT action; command layer остается только временным adapter. |
| DKT effects | `effects.api/in/out` model-local. I/O описан как state_request/out effect; action только ставит request attrs или `$fx_`. | Есть task facade (`runtimeTaskFacade`, `$fx_exportBlobUrl`, import files task), но model-local `effects` почти отсутствуют; media/export I/O в app services. | Создать `Resource.effects.ts`, `Project.effects.ts`, `Export.effects.ts` или model-local effects. File/object-url/render APIs инжектить через runtime interfaces. |
| Comp attrs | Derived values живут в model attrs: weather summaries, sparkline, load status, child-rel aggregates. | Есть точечные comp attrs (`hasProjects`, `isLandscape`, `isReady`), но timeline/preview/export derived state в `dkt/state/derivedTimeline.ts` на observable. | Перенести важные derived values в DKT comp attrs: project duration, resource progress, clip end, track duration, preview structure summaries. |
| Comp rels | Используются rel linking и parent rel comp (`<<<<`, `<< location`, `<< weatherLocation`), структура описана декларативно. | Root flat rels `project/track/resource/clip/text/effect`; Project/Track пока без настоящей hierarchy. | Добавить Project -> Timeline/Track/Resource rels, Track -> Clip rels, Clip -> Effect/Text/Resource rels. Root хранит top-level projects/sessions, не все entity proxies. |
| Flow patterns | Parent action может создавать child, держать refs, затем запускать child action/effect через rel target; sync runtime распространяет изменения. | Создание children и rel splice делает command handler; DKT proxies зеркалят старые ids. | Переписать create/add/split/remove как DKT multi-step actions с `can_hold_refs`, `can_use_refs`, `$fx_`, `sub_flow` where needed. |
| Runtime authority | Worker запускает DKT runtime with `sync_sender: true`; clients получают sync messages и требуют shapes/structure usage. | В текущей рабочей копии уже есть `dktSharedWorker` и `SYNC_*`, но остается `dispatchCommand`/registry snapshot bridge. | Завершить worker DKT authority: убрать `CMD.*` из worker protocol, передавать DKT sync как основной канал, snapshot только debug/export compatibility. |
| React read model | Weather имеет `dkt-react-sync` receiver/shape layer. | MiniCut render runtime все еще читает `@legendapp/state` observable registry. | Завести MiniCut DKT React receiver или адаптировать weather `dkt-react-sync`; удалить `dkt/state/*` как source of truth. |

## Целевая структура файлов

```text
src/video-editor/models/
  AppRoot.ts
  AppRoot/
    actions.ts
    effects.ts
    creationShapes.ts
  Project.ts
  Project/
    actions.ts
    effects.ts
    creationShapes.ts
    helpers.ts
  Timeline.ts
  Timeline/
    actions.ts
    creationShapes.ts
  Track.ts
  Track/
    actions.ts
    creationShapes.ts
  Clip.ts
  Clip/
    actions.ts
    creationShapes.ts
    defaults.ts
  Text.ts
  Text/
    actions.ts
    defaults.ts
    creationShapes.ts
  Effect.ts
  Effect/
    actions.ts
    defaults.ts
    creationShapes.ts
  Resource.ts
  Resource/
    actions.ts
    effects.ts
    resourceData.ts
    creationShapes.ts

src/video-editor/dkt/
  runtime/
    createMiniCutDktRuntime.ts
    workerModelRuntime.ts
    pageSyncReceiver.ts
  shared/
    messageTypes.ts
    createPortTransport.ts
```

Правило: если функция меняет attrs/rels конкретной модели, она должна жить рядом с этой моделью. Если функция делает I/O, она должна быть `effects` этой модели или injected interface. Если функция только переводит React event в DKT dispatch, она может жить в `app`, но не должна содержать бизнес-расчетов и `CMD.*`.

## Комбинированный план изменений

### Срез 1. Разнести action helpers по model folders

Цель: убрать промежуточный слой `dkt/*Actions.ts` как дом для бизнес-логики.

Шаги:

1. Создать `models/Clip/actions.ts`, перенести туда opacity/name/color/fade/audio/transform/move/trim/resize helpers.
2. Создать `models/Text/actions.ts`, `models/Text/defaults.ts`, перенести text reducers/defaults.
3. Создать `models/Effect/actions.ts`, `models/Effect/defaults.ts`, перенести effect reducers/defaults.
4. Создать `models/SessionRoot/actions.ts`, перенести session descriptors/reducers.
5. Оставить `dkt/clipActions.ts`, `dkt/textActions.ts`, etc. временными re-export files или удалить после обновления imports/tests.

Критерий готовности: модельные files импортируют actions из соседних папок, а не из `dkt/*Actions.ts`.

### Срез 2. Сделать Project/Track/Resource настоящей hierarchy

Цель: перестать хранить структурные entities плоскими root proxies.

Шаги:

1. Добавить `Timeline` model или явно решить, что Project владеет tracks напрямую.
2. Добавить rels: `Project.timeline`, `Project.resources`, `Timeline.tracks` или `Project.tracks`, `Track.clips`, `Clip.effects`, `Clip.text`, `Clip.resource`.
3. Перенести `createProjectProxy` в реальный `AppRoot.createProject`.
4. Перенести `createTrackProxy` в `Project.addTrack` / `Timeline.addTrack`.
5. Перенести `createResourceProxy` в `Project.importResource` creation step.
6. Перенести `createClipProxy` и `createTextProxy` в `Track.addClip` / `Track.addTextClip`.

Критерий готовности: новые клипы/ресурсы/треки появляются через DKT rel targets, а не через `CMD.*` + patch replay.

### Срез 3. Переписать timeline/effect structural commands как DKT actions

Цель: удалить основную бизнес-логику из `domain/*CommandHandlers.ts`.

Шаги:

1. `handleTimelineAddClip` -> `Track.addResourceClip`.
2. `handleTextAdd` -> `Track.addTextClip`.
3. `handleTimelineSplitClip` -> `Track.splitClipAt` with right clip ref and cloned effects.
4. `handleTimelineDeleteClip` -> `Track.removeClip` + cleanup child effects/text if needed.
5. `handleEffectAdd/remove/reorder` -> `Clip.addEffect/removeEffect/reorderEffect`.
6. `handleClipUpdateAttrs` and `handleTextUpdateAttrs` disappear after UI stops using patch commands.

Критерий готовности: `domain/*CommandHandlers.ts` becomes legacy-only adapter or is deleted from runtime path.

### Срез 4. Перевести import/export/resource transfer в DKT effects

Цель: приблизить I/O к Linkkraft style.

Шаги:

1. `Project.effects.ts`: `$fx_importFiles` / `state_request` for metadata extraction where applicable.
2. `Resource.effects.ts`: chunk request/load/status updates, local file registration, P2P availability.
3. `Project` или `Clip` export effect: `$fx_renderExport`, `$fx_exportBlobUrl`.
4. `app/mediaImportActions.ts` становится file-picker/UI adapter: получает `FileList`, кладет runtime refs, dispatches DKT action/effect request.
5. `app/exportActions.ts` становится UI adapter; render/export service injected through DKT interfaces.

Критерий готовности: I/O не выполняется внутри action facade и не пишет напрямую в legacy registry.

### Срез 5. Завершить worker DKT authority и sync receiver

Цель: заменить command/patch authority DKT runtime authority.

Шаги:

1. Довести `dktSharedWorker` до weather-like model runtime: session map, connection lifecycle, `sync_sender.addSyncStream`, shape/structure usage.
2. Убрать `DISPATCH_COMMAND`, `PATCHES`, `replaceRegistrySnapshot`, `dispatchCommand` из основного протокола. Если нужны для миграции, пометить как legacy debug/import boundary.
3. Добавить page sync receiver/read model по образцу weather `dkt-react-sync`.
4. Перевести React render runtime на DKT receiver shape.
5. Удалить `@legendapp/state` из runtime path: `dkt/state/*`, observable selectors, patch adapter.

Критерий готовности: worker model runtime является source of truth; page получает sync messages; legacy patch envelopes не участвуют в обычном editing flow.

### Срез 6. Убрать legacy `CMD.*` API из public editing flow

Цель: сделать MiniCut action layer DKT-native.

Шаги:

1. `createDktActionRuntime.ts` перестает вызывать `dispatchBuiltCommand` для операций, у которых есть DKT action.
2. `actionCommandBuilders.ts` остается только для старого import/export compatibility, затем удаляется.
3. `applyCommand.ts`, `applyPatch.ts`, `commandHandlerRegistry.ts` становятся migration/debug utilities или удаляются.
4. Tests переписываются с `worker.dispatch({ c: CMD.* })` на DKT action dispatch / sync receiver assertions.

Критерий готовности: обычный UI сценарий project -> import -> clip -> edit -> export проходит без `CMD.*` commands.

## Риски и порядок выполнения

| Риск | Почему важен | Как снизить |
| --- | --- | --- |
| Одновременный перенос models и runtime sync слишком большой | Легко получить полуработающий гибрид | Делать срезами: сначала файлы/actions рядом с моделями, затем hierarchy, затем sync authority. |
| `splitClipAt` и linked audio требуют parent Track context | Clip сам не знает свой index в track | Делать owner action на Track/Timeline, а Clip action оставить только для attr-only edits. |
| Import/export завязаны на browser APIs и runtime refs | Нельзя класть File/Blob в DKT attrs напрямую | Использовать `$fx_` + runtime refs + injected interfaces, как уже начато в task facade. |
| React render depends on observable registry | Прямое удаление `@legendapp/state` сломает UI | Сначала добавить DKT receiver рядом, затем переключить render runtime, затем удалить observable path. |
| Существующие tests проверяют `CMD.*` | Миграция без тест-плана даст шумные failures | Для каждого command handler сначала добавить DKT-action parity test, потом переключить старый test. |

## Проверки для будущих срезов

Минимальный набор для action/model переносов:

```text
npm run test:video-editor -- src/video-editor/dkt/runtime/createMiniCutDktRuntime.test.ts src/video-editor/app/createDktActionRuntime.test.ts src/video-editor/domain/actionCommandBuilders.test.ts
```

Для structural DKT hierarchy:

```text
npm run test:video-editor -- src/video-editor/dkt/runtime/createMiniCutDktRuntime.test.ts src/video-editor/worker/authorityRuntimeParity.test.ts src/video-editor/app/createVideoEditorHarness.test.ts
```

Для sync authority/read model migration:

```text
npm run test:video-editor -- src/video-editor/worker/workerBoundary.test.ts src/video-editor/p2p/P2PAuthorityAdapter.test.ts src/video-editor/render-sync/createDktEditorRenderRuntime.test.ts src/video-editor/tests/video-editor.happy-path.test.tsx
npm run video-editor:build
```

## Definition of Done

Код можно считать организованным вокруг моделей в стиле Linkkraft, когда выполняются все пункты:

- каждая модель содержит или импортирует только соседние `actions/effects/defaults/creationShapes`;
- структурные операции выражены DKT rel-targets, refs и multi-step actions;
- I/O описан в `effects.api/in/out`, а не в action facade;
- React читает DKT sync receiver state, а не manually patched observable registry;
- worker authority публикует DKT sync messages, а не MiniCut patch envelopes;
- `CMD.*`, `PatchEnvelope`, `applyPatch`, `actionCommandBuilders` не участвуют в основном editing flow.