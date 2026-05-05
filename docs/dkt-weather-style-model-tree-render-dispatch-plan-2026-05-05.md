# План миграции MiniCut на DKT model tree render и scoped dispatch

Дата: 2026-05-05

Цель: убрать registry snapshot / patch envelopes / command routing из основного render/write path и перейти на DKT-native схему:

```text
DKT model tree
  -> sync_sender
  -> React state replica
  -> current component scope = DKT node_id
  -> useAttrs / One / Many / Path render attrs and rels
  -> useActions dispatches to current scope
  -> worker resolves scope_node_id via getModelById
  -> targetModel.dispatch(action, payload)
```

Главное архитектурное правило: `src/dkt-react-sync` должен быть абстрактным DKT + React слоем. В нем не должно быть ни weather, ни MiniCut логики. MiniCut-специфичные transport messages, worker/session bootstrap, model action names, resource/export/P2P эффекты и video-editor UI adapters должны жить вне `src/dkt-react-sync`.

## 0. Сводная таблица по всем фазам (с ревью последних коммитов)

Последние проверенные коммиты для ревью факта выполнения: `9647973`, `91bc336`, `5e34484`, `dbfead2`, `cb9aa8b`, `35b6fd6`, `ab91d34`, `e4da124`, `7e4a419` плюс текущий follow-up 2026-05-06.

Архитектурная поправка от 2026-05-05: последняя попытка чинить DKT streaming через render adapter helpers (`debugDumpGraph()` lookup, graph-wide wakeups, legacy `readComp()`) признана неправильным направлением. Эти fixes могли быть полезны как диагностика реальных streaming gaps, но не должны становиться целевой архитектурой. Traversal/rels, агрегаты и cross-model writes должны жить в DKT моделях через rels, comp attrs/rels и action forwarding. React render должен идти top-down от текущей scope-модели.

Новые опорные документы:

- `src/dkt-react-sync/docs/minicut-rendering-postmortem-2026-05-05.md`
- `src/dkt-react-sync/docs/model-rendering-appguide-ru.md`

`ReactSyncReceiver.allSubs` признан антипаттерном и удален из generic receiver. Если UI требует такого wakeup, значит dependency не выражена в модели или shape/rel path. Новые DKT UI paths должны читать данные через `RootScope`/`One`/`Many`/`useAttrs`, чтобы attrs/rels запрашивались через `useShape`.

| № | Фаза | Название шага | Что реально сделано (ревью последних коммитов) | Коммиты | Измененные файлы | Проблемы при реализации |
|---|---|---|---|---|---|---|
| 1 | 1 | Создать `src/dkt-react-sync` и перенести generic files из weather | Полностью сделано: добавлен generic слой и базовая структура. | `9647973` | `src/dkt-react-sync/**` | Нет новых проблем в последних коммитах. |
| 2 | 1 | Убрать weather naming из generic shape metadata и imports | Частично проверено: критичных weather-specific импортов в слое не найдено. | `9647973` | `src/dkt-react-sync/shape/**`, `src/dkt-react-sync/runtime/**` | Требуется периодическая проверка при новых изменениях. |
| 3 | 1 | Добавить receiver tests для attrs/rels/root sync chunks | Сделано: добавлены receiver-тесты. | `9647973` | `src/dkt-react-sync/receiver/ReactSyncReceiver.test.ts` | Нет. |
| 4 | 1 | Добавить React tests для `One`, `Many`, `Path`, `useAttrs`, `useActions` | Сделано: есть покрытие `Path`, `useAttrs`, `Many`, `One`, `useActions`; test runtime умеет one-rel updates и stable scoped dispatch. | `9647973`, `7e4a419`, current | `src/dkt-react-sync/components/Path.test.tsx`, `src/dkt-react-sync/components/Many.test.tsx`, `src/dkt-react-sync/components/One.test.tsx`, `src/dkt-react-sync/hooks/useAttrs.test.tsx`, `src/dkt-react-sync/hooks/useActions.test.tsx`, `src/dkt-react-sync/test/createTestReactScopeRuntime.ts` | Нет. |
| 5 | 2 | Создать MiniCut page runtime adapter поверх generic receiver/store/shape registry | Сделано: адаптер создан и используется как transport runtime. | `91bc336` | `src/video-editor/dkt/runtime/createMiniCutPageSyncRuntime.ts`, `src/video-editor/dkt/runtime/pageRuntimeStore.ts` | Дальше нужен перенос production UI на этот runtime. |
| 6 | 2 | Добавить scoped `DISPATCH_ACTION` transport message with `scope_node_id` | Сделано: scoped transport-message внедрен. | `91bc336` | `src/video-editor/dkt/runtime/scopedActionTransport.ts`, `src/video-editor/dkt/shared/messageTypes.ts` | Нет. |
| 7 | 2 | Пробросить `SYNC_UPDATE_STRUCTURE_USAGE` и `SYNC_REQUIRE_SHAPE` из shape registry | Сделано: bridge callbacks пробрасываются. | `91bc336`, `dbfead2` | `src/video-editor/dkt/runtime/createMiniCutPageSyncRuntime.ts`, `src/video-editor/dkt/runtime/createMiniCutDktRuntime.ts` | Убран polling на стороне worker, но полный UI shape rollout еще впереди. |
| 8 | 2 | Разделить production protocol и legacy registry messages в `messageTypes.ts` | Частично сделано: legacy типы отмечены и продолжают жить для совместимости. | `91bc336` | `src/video-editor/dkt/shared/messageTypes.ts` | Полный вынос legacy сообщений запланирован на фазу 9. |
| 9 | 2 | Покрыть bootstrap, sync handle, root readiness, scoped dispatch tests | Сделано: тесты обновлены на event-driven DKT subscriptions. | `dbfead2` | `src/video-editor/worker/memoryWorker.test.ts`, `src/video-editor/dkt/runtime/createMiniCutDktRuntime.test.ts` | Нет. |
| 10 | 3 | Реализовать worker scoped dispatch through `getModelById` | Сделано: dispatch теперь идет через scope lookup в session tree. | `5e34484`, `dbfead2` | `src/video-editor/dkt/runtime/createMiniCutDktRuntime.ts` | Для legacy веток остается fallback-код. |
| 11 | 3 | Перевести sync stream target на session root model tree | Сделано: stream root перенесен на session root и важный path `[['pioneer']]`. | `5e34484`, `dbfead2` | `src/video-editor/dkt/runtime/createMiniCutDktRuntime.ts`, `src/video-editor/dkt/runtime/createMiniCutDktRuntime.test.ts` | Нет. |
| 12 | 3 | Поддержать null scope только для root/session actions | Частично сделано: null scope ведет в session root для page actions. | `dbfead2` | `src/video-editor/dkt/runtime/createMiniCutDktRuntime.ts` | Нужно зачистить оставшиеся legacy маршруты. |
| 13 | 3 | Убрать production dependency on `dispatchCommand` from worker switch | Частично сделано: production path использует scoped action, `DISPATCH_COMMAND` еще в switch для совместимости. | `dbfead2` | `src/video-editor/dkt/runtime/createMiniCutDktRuntime.ts` | Полный removal не сделан. |
| 14 | 3 | Добавить worker tests на scoped Clip/Track/Project dispatch | Частично сделано: расширены runtime tests и transport tests. | `dbfead2` | `src/video-editor/dkt/runtime/createMiniCutDktRuntime.test.ts`, `src/video-editor/worker/memoryWorker.test.ts` | Нужны отдельные более granular tests по Track/Project сценариям. |
| 15 | 4 | Описать SessionRoot attrs/rels for render in DKT models | Частично сделано: SessionRoot attrs есть, stream реально идет от session root. | `5e34484`, `dbfead2` | `src/video-editor/models/SessionRoot.ts`, `src/video-editor/dkt/runtime/createMiniCutDktRuntime.ts` | UI пока не читает это end-to-end через новый root. |
| 16 | 4 | Добавить shapes for SessionRoot and Project | Сделано: production `miniCutEditorRootShape` описывает session root, `pioneer`, `activeProject`, `selectedClip`, Project/Track/Clip/Text/Effect/Resource rels and attrs. | `ab91d34`, `7e4a419` | `src/video-editor/ui/dkt/shapes.ts`, `src/video-editor/render-sync/createDktEditorRenderRuntime.test.ts` | Для тестов реального PageSyncRuntime нужно явно mount-ить shape; это зафиксировано в postmortem. |
| 17 | 4 | Ввести `DktEditorRoot` with generic `RootScope` and `Path` | Сделано для production shell: `VideoEditorHarnessApp` wraps UI in `DktEditorRoot`, root shape mounts through generic `RootScope`; common UI panels read DKT hooks directly. | `ab91d34`, `7e4a419` | `src/video-editor/ui/dkt/DktEditorRoot.tsx`, `src/video-editor/app/VideoEditorHarnessApp.tsx`, `src/video-editor/components/**` | `Path` остается available generic primitive; active-project UI использует `One`/`useMany` напрямую для более явных fallbacks. |
| 18 | 4 | Перевести active project navigation на `Path` instead of nested adapter selectors | Сделано по архитектуре top-down: project dropdown, media bin, timeline read `activeProject`/`pioneer -> project` through generic `One`/`useMany`; stale `ui/dkt` hooks больше не импортируют `render-sync`. | `7e4a419`, current | `src/video-editor/components/ProjectDropdown.tsx`, `src/video-editor/components/MediaBin.tsx`, `src/video-editor/components/TimelineView.tsx`, `src/video-editor/ui/dkt/hooks/useActiveProjectScope.ts` | Fallback на первый project scope нужен, пока `activeProject` rel материализуется async. |
| 19 | 4 | Сохранить Legend session store only as compatibility read adapter | Сделано для render path: UI panels больше не читают Legend напрямую; Legend/harness остаются compatibility write/materialization bridge. | `ab91d34`, `7e4a419` | `src/video-editor/components/**`, `src/video-editor/app/createVideoEditorHarness.ts` | Полное удаление Legend write bridge остается фазой 7-9. |
| 20 | 5 | Добавить Track/Clip/Text/Effect shape definitions | Сделано: production shape map покрывает Track/Clip/Text/Effect plus Resource; root shape содержит `activeProject` and `selectedClip`. | `ab91d34`, `7e4a419` | `src/video-editor/ui/dkt/shapes.ts` | Нет. |
| 21 | 5 | Перевести Timeline root на active Project DKT scope | Сделано: `TimelineView` renders under `One rel="activeProject"` with `pioneer` fallback and uses `useMany('tracks')`. | `ab91d34`, `7e4a419` | `src/video-editor/components/TimelineView.tsx` | Add-track/write actions еще идут через compatibility facade. |
| 22 | 5 | Перевести TrackLane на `useAttrs` + `Many rel="clips"` | Сделано: Track label/lane read attrs in Track scope and iterate clips via `useMany('clips')`; clip attrs stay in Clip scope. | `ab91d34`, `7e4a419` | `src/video-editor/components/TrackRow.tsx`, `src/video-editor/components/ClipItem.tsx` | Используется hook `useMany`, а не JSX `Many`, чтобы lane layout could compute list width. |
| 23 | 5 | Перевести ClipItem/TextClipItem на scoped attrs and actions | Частично сделано: Clip/Text render attrs and effect/text/resource rels are scoped; writes still call compatibility `useVideoEditor().actions` for many edit commands. | `ab91d34`, `7e4a419` | `src/video-editor/components/ClipItem.tsx`, `src/video-editor/components/inspector/InspectorEditTabPanel.tsx` | Следующий шаг: заменить remaining id-based writes on `useActions()` once model actions cover import/export/linked audio effects. |
| 24 | 5 | Убрать registry reads из timeline render path | Сделано для React components: `src/video-editor/components/**` не импортирует `ProjectRegistry`/selectors/Legend stores for timeline render. | `ab91d34`, `7e4a419` | `src/video-editor/components/TimelineView.tsx`, `src/video-editor/components/TrackRow.tsx`, `src/video-editor/components/ClipItem.tsx` | Legacy `render-sync` files remain for tests/compatibility and are not the new component render path. |
| 25 | 6 | Перевести selected entity на SessionRoot DKT scope/rel | Сделано для selected clip render: `SessionRoot.selectedClip` rel exists, shape declares it, Inspector traverses `One rel="selectedClip"`. | `ab91d34`, `7e4a419`, current | `src/video-editor/models/SessionRoot.ts`, `src/video-editor/ui/dkt/shapes.ts`, `src/video-editor/components/Inspector.tsx`, `src/video-editor/ui/dkt/hooks/useSelectedEntityScope.ts` | Название legacy hook пока `useSelectedEntityScope`, но фактически target rel is selected clip. |
| 26 | 6 | Добавить `useSelectedEntityScope` outside generic layer | Сделано: hook находится outside generic layer and now uses generic `useOne('selectedClip')`, not compatibility `render-sync`. | current | `src/video-editor/ui/dkt/hooks/useSelectedEntityScope.ts` | Нет. |
| 27 | 6 | Перевести ClipInspector на scoped attrs/actions | Частично сделано: Clip inspector reads selected Clip attrs from current DKT scope; writes still routed through compatibility actions. | `ab91d34`, `7e4a419` | `src/video-editor/components/Inspector.tsx`, `src/video-editor/components/inspector/InspectorClipHeader.tsx`, `src/video-editor/components/inspector/InspectorEditTabPanel.tsx` | Remaining id-based writes keep this row partial. |
| 28 | 6 | Перевести TextInspector на scoped attrs/actions | Частично сделано: Text panel traverses `useOne('text')` and reads scoped text attrs; writes still use compatibility text update action. | `7e4a419` | `src/video-editor/components/inspector/InspectorEditTabPanel.tsx` | Text writes need model-local `useActions()` dispatch before closing. |
| 29 | 6 | Перевести EffectInspector на scoped attrs/actions | Частично сделано: effect lists/color slots iterate effect scopes and read attrs inside each effect component; effect writes still use compatibility action ids. | `7e4a419` | `src/video-editor/components/inspector/InspectorEditTabPanel.tsx`, `src/video-editor/components/inspector/InspectorColorTabPanel.tsx`, `src/video-editor/components/ClipItem.tsx` | Effect add/remove/update writes remain compatibility. |
| 30 | 6 | Удалить inspector dependency on registry/harness action ids | Частично сделано: render dependency removed; write dependency remains through `source*Id` and `useVideoEditor().actions`. | `7e4a419` | `src/video-editor/components/inspector/**` | Blocked by remaining phase 7 model action routing. |
| 31 | 7 | Завершить Project model actions for structural edits | Частично сделано: materialization использует model actions. | `dbfead2` | `src/video-editor/dkt/runtime/createMiniCutDktRuntime.ts`, `src/video-editor/dkt/runtime/createMiniCutDktRuntime.test.ts` | Не весь production write-path переведен. |
| 32 | 7 | Завершить Track model actions for timeline structure | Частично сделано: нормализация clip source attrs и runtime dispatch по track actions. | `dbfead2` | `src/video-editor/models/Track/actions.ts`, `src/video-editor/dkt/runtime/createMiniCutDktRuntime.ts` | Полный UI dispatch routing еще не сделан. |
| 33 | 7 | Завершить Clip model actions for media clip editing | Частично сделано: покрытие runtime tests есть. | `dbfead2` | `src/video-editor/models/Clip.ts`, `src/video-editor/dkt/runtime/createMiniCutDktRuntime.test.ts` | Нет полного UI scoped wiring. |
| 34 | 7 | Завершить Text model actions for text editing | Частично сделано: runtime materialization и dispatch присутствуют. | `dbfead2` | `src/video-editor/dkt/runtime/createMiniCutDktRuntime.ts` | UI inspector pending. |
| 35 | 7 | Завершить Effect model actions for effect editing | Частично сделано: runtime materialization и dispatch присутствуют. | `dbfead2` | `src/video-editor/dkt/runtime/createMiniCutDktRuntime.ts` | UI inspector pending. |
| 36 | 7 | Перевести UI writes с app action runtime на scoped DKT dispatch | Частично сделано: session-level playback/preview root actions use `useActions`; missing `tickPlayback` DKT action added. Most Clip/Text/Effect/Project writes still use compatibility facade. | `ab91d34`, current | `src/video-editor/components/VideoEditorApp.tsx`, `src/video-editor/components/PreviewPanel.tsx`, `src/video-editor/models/SessionRoot/actions.ts`, `src/video-editor/models/SessionRoot/actions.test.ts` | Remaining app action facade writes are the main open phase 7 work. |
| 37 | 7 | Пометить `createDktActionRuntime` and command builders as legacy compatibility | Сделано: compatibility/deprecated comments exist on action runtime and command builders. | `35b6fd6` | `src/video-editor/app/createDktActionRuntime.ts`, `src/video-editor/domain/actionCommandBuilders.ts` | Legacy code still exists because import/export/resource effects are not fully DKT-native yet. |
| 38 | 8 | Перевести import flow на Project/Resource DKT effects | Не сделано в последних коммитах. | — | — | Пока используется bridge через snapshot/materialization. |
| 39 | 8 | Перевести resource local blob/object URL state на Resource attrs/effects | Не сделано в последних коммитах. | — | — | Ownership у media runtime, не у model effects. |
| 40 | 8 | Перевести export flow на model tree/export projection | Не сделано в последних коммитах. | — | — | Export path не мигрирован. |
| 41 | 8 | Проверить P2P resource availability through Resource model state | Частично сделано: DKT transport проброшен через authority adapters. | `9767170`, `dbfead2` | `src/video-editor/p2p/P2PAuthorityAdapter.ts`, `src/video-editor/worker/authorityClient.ts`, `src/video-editor/worker/dktSharedWorkerClient.ts`, `src/video-editor/worker/fallbackAuthorityClient.ts` | Resource-model state/effects еще не перенесены. |
| 42 | 8 | Убрать production dependency on app import/export command wrappers | Не сделано в последних коммитах. | — | — | Требует завершения migration effects. |
| 43 | 9 | Удалить `DktRegistryRenderStore` из production render path | Не сделано в последних коммитах. | — | — | В compatibility path store по-прежнему используется. |
| 44 | 9 | Удалить `registrySnapshot` как UI state source | Не сделано в последних коммитах. | — | — | `registrySnapshot` все еще используется для bridge materialization. |
| 45 | 9 | Убрать legacy snapshot/patch/command messages из production runtime switch | Частично сделано: scoped action path стабилизирован, legacy messages оставлены. | `dbfead2` | `src/video-editor/dkt/runtime/createMiniCutDktRuntime.ts`, `src/video-editor/dkt/shared/messageTypes.ts` | Полное удаление legacy protocol не сделано. |
| 46 | 9 | Перенести или удалить command/patch domain modules | Не сделано в последних коммитах. | — | — | Нужно отдельной фазой после UI migration. |
| 47 | 9 | Обновить tests from patch assertions to DKT tree assertions | Частично сделано: добавлены DKT transport assertions без polling. | `dbfead2` | `src/video-editor/worker/memoryWorker.test.ts`, `src/video-editor/dkt/runtime/createMiniCutDktRuntime.test.ts` | Старые compatibility тесты сохраняются. |
| 48 | 10 | Запустить full video-editor unit suite | Сделано: после current follow-up `npm run test:video-editor` прошел 67 files / 313 tests. | current | `src/dkt-react-sync/**`, `src/video-editor/**` | Нет unit failures. |
| 49 | 10 | Запустить build and verify DKT chunks | Сделано: `npm run video-editor:build` completed successfully. | current | `dist-video-editor/**` generated output | Vite предупреждает о крупном chunk and mixed dynamic/static import for `createMiniCutDktRuntime.ts`; это warning, не failure. |
| 50 | 10 | Запустить critical Playwright integration tests | Частично: targeted playback test passed after adding DKT `tickPlayback`; full `tests/integration/video-editor.spec.ts` still 21 passed / 8 failed. | current | `src/video-editor/models/SessionRoot/actions.ts`, `tests/integration/video-editor.spec.ts` validation output | Remaining failures are import/export/resource/audio/OffscreenCanvas scenarios, matching open phase 8/9 work. |
| 51 | 10 | Обновить docs with final architecture and removed legacy list | Сделано для текущего render/scoped-dispatch slice: postmortem, appguide, and this table document completed render progress and remaining legacy list. | `7e4a419`, current | `docs/dkt-weather-style-model-tree-render-dispatch-plan-2026-05-05.md`, `docs/dkt-render-tree-postmortem-2026-05-05.md`, `src/dkt-react-sync/docs/**` | Не marked as full migration complete because phase 8/9 integration remains open. |
| 52 | 10 | Заполнить отчетные таблицы фактическими commits/files/problems | Сделано: таблица обновлена по фактическим commits, files, validation results, and blockers. | current | `docs/dkt-weather-style-model-tree-render-dispatch-plan-2026-05-05.md` | Self-referential exact commit hash for this doc update is intentionally not embedded. |

### Краткое ревью последних коммитов (что реально сделано)

- `9647973`: добавлен generic слой `src/dkt-react-sync` плюс базовые тесты receiver/shape/hooks.
- `91bc336`: добавлен MiniCut page sync runtime adapter (`createMiniCutPageSyncRuntime`, `scopedActionTransport`, `pageRuntimeStore`).
- `5e34484`: начат перенос bootstrap на session-root поток в runtime.
- `dbfead2`: доведен session-root/pioneer flow, убраны interim polling/debug-hacks, обновлены transport/runtime tests, расширены proxy attrs (`sourceResourceId/sourceTextId`).
- `cb9aa8b`: задокументирован фактический статус migration и ограничения, без новых runtime-фич.
- `ab91d34`: production React render moved onto DKT model tree scopes for editor panels.
- `e4da124`: stabilized DKT render runtime tests after the model-tree render migration.
- `7e4a419`: aligned generic `dkt-react-sync` with Weather, removed `useManyWithAttrs`, added receiver/hook/component stability tests, and documented postmortem.
- Current 2026-05-06 follow-up: added `One`/`useActions` tests, removed stale `render-sync` dependency from DKT UI hooks, added scoped `tickPlayback` SessionRoot action, ran unit/build/integration validation, and refreshed this table.

---

## 1. Эталонная идея из weather

Weather уже реализует нужную ось:

```text
React component
  -> ReactSyncScopeHandle { kind: 'scope', _nodeId }
  -> receiver.readAttrs/readOne/readMany
  -> component rerender through useSyncExternalStore
  -> runtime.getDispatch(scope)
  -> CONTROL_DISPATCH_APP_ACTION { action_name, payload, scope_node_id }
  -> worker getModelById(sessionRoot, scope_node_id)
  -> model.dispatch(action_name, payload)
```

Ключевые файлы weather:

- `D:\code\linkcraft\weather\src\dkt-react-sync\receiver\ReactSyncReceiver.ts`
- `D:\code\linkcraft\weather\src\dkt-react-sync\runtime\ReactScopeRuntime.ts`
- `D:\code\linkcraft\weather\src\dkt-react-sync\runtime\PageSyncRuntime.ts`
- `D:\code\linkcraft\weather\src\dkt-react-sync\runtime\createSyncStore.ts`
- `D:\code\linkcraft\weather\src\dkt-react-sync\scope\ScopeHandle.ts`
- `D:\code\linkcraft\weather\src\dkt-react-sync\scope\RootScope.tsx`
- `D:\code\linkcraft\weather\src\dkt-react-sync\components\One.tsx`
- `D:\code\linkcraft\weather\src\dkt-react-sync\components\Many.tsx`
- `D:\code\linkcraft\weather\src\dkt-react-sync\components\Path.tsx`
- `D:\code\linkcraft\weather\src\dkt-react-sync\hooks\useAttrs.ts`
- `D:\code\linkcraft\weather\src\dkt-react-sync\hooks\useActions.ts`
- `D:\code\linkcraft\weather\src\dkt-react-sync\hooks\useScope.ts`
- `D:\code\linkcraft\weather\src\dkt-react-sync\hooks\useShape.ts`
- `D:\code\linkcraft\weather\src\dkt-react-sync\shape\ShapeRegistry.ts`
- `D:\code\linkcraft\weather\src\dkt-react-sync\shape\defineShape.ts`
- `D:\code\linkcraft\weather\src\page\createPageSyncReceiverRuntime.ts`
- `D:\code\linkcraft\weather\src\worker\model-runtime.ts`

В MiniCut нужно переносить именно `src/dkt-react-sync` как generic слой. Weather-specific `page/createPageSyncReceiverRuntime.ts` надо использовать как образец для MiniCut adapter, но не класть его в generic folder в MiniCut.

---

## 2. Что должно быть в абстрактном `src/dkt-react-sync`

Будущая структура:

```text
src/
  dkt-react-sync/
    components/
      Many.tsx
      One.tsx
      Path.tsx
    context/
      ReactScopeRuntimeContext.tsx
      ScopeContext.tsx
    hooks/
      useActions.ts
      useAttrs.ts
      useReactScopeRuntime.ts
      useScope.ts
      useShape.ts
      useSyncRoot.ts
    receiver/
      ReactSyncReceiver.ts
    runtime/
      PageSyncRuntime.ts
      ReactScopeRuntime.ts
      createSyncStore.ts
    scope/
      RootScope.tsx
      ScopeHandle.ts
    shape/
      MountedShape.tsx
      ShapeRegistry.ts
      autoShapes.ts
      defineShape.ts
```

Допустимое содержимое:

- DKT sync protocol parsing: `SYNCR_TYPES`, compact update chunks, attrs/rels/tree root handling.
- React scope model: `{ kind: 'scope', _nodeId }`.
- Read API: `readAttrs`, `readOne`, `readMany`.
- Subscribe API: attr/one/many subscriptions.
- React bindings: `RootScope`, `One`, `Many`, `Path`, hooks.
- Shape/structure usage API: `defineShape`, `shapeOf`, `ShapeRegistry`.
- Generic runtime interfaces.
- Generic bridge callbacks: `RPCLegacy`, `updateStructureUsage`, `requireShapeForModel`.

Недопустимое содержимое:

- MiniCut action names: `addClip`, `trim`, `setEffectAmount`, `renderExport`.
- Weather action names: `retryWeatherLoad`.
- MiniCut transport enums: `DKT_MSG`, `RUNTIME_LOG_SCOPE`, P2P messages.
- Weather transport enums: `APP_MSG`.
- MiniCut model names: `Project`, `Track`, `Clip`, `Resource`.
- MiniCut registry types: `ProjectRegistry`, `PatchEnvelope`, `Command`, `DispatchResult`.
- Any app bootstrap policy: session id, P2P role, active project creation.

Если нужен app-specific runtime, он должен импортировать `src/dkt-react-sync` и жить в `src/video-editor/...`.

---

## 3. Как использовать `Path` вместо вложенных `One`

Для цепочек rels не нужно писать:

```tsx
<One rel="session">
  <One rel="activeProject">
    <Many rel="tracks" item={TrackLane} />
  </One>
</One>
```

В generic layer уже должен быть `Path.tsx`, как в weather:

```tsx
<Path rels={['session', 'activeProject']}>
  <Many rel="tracks" item={TrackLane} />
</Path>
```

`Path` рекурсивно заворачивает children в `One` по каждому rel. Это важно для MiniCut, потому что редактор будет часто переходить от root/session к active project, selected clip, selected effect, current resource и другим nested scopes.

Примеры целевого UI:

```tsx
<RootScope runtime={runtime}>
  <Path rels={['session', 'activeProject']} fallback={<EmptyProjectState />}>
    <Timeline />
  </Path>
</RootScope>
```

```tsx
const Timeline = () => (
  <Many rel="tracks" item={TrackLane} empty={<EmptyTimeline />} />
)
```

```tsx
const TrackLane = () => {
  const attrs = useAttrs(['name', 'kind', 'height'])

  return (
    <section data-track-kind={String(attrs.kind ?? '')}>
      <Many rel="clips" item={ClipItem} />
    </section>
  )
}
```

---

## 4. React оптимизации, которые нужно перенести из weather

### `useSyncExternalStore`

Weather использует `useSyncExternalStore` в `useAttrs`, `One`, `Many`, `useSyncRoot`. Это правильный React 18 API для внешнего store. MiniCut должен использовать его для подписок на DKT replica, а не дергать глобальный observable registry.

Требование: каждый component подписывается только на нужные attrs/rels текущего scope.

### `useMemo` для нормализации attr fields

`useAttrs` нормализует fields:

```ts
const normalizeFields = (fields: readonly string[]) => Array.from(new Set(fields)).sort()
const normalizedFields = useMemo(() => normalizeFields(fields), fields)
```

Это дает стабильный cache key для attrs read cache и shape cache. В MiniCut компонентах нужно передавать стабильные arrays, где возможно, но generic hook должен защищаться нормализацией.

### `useCallback` для subscribe/getSnapshot

`useAttrs` оборачивает subscribe и getSnapshot в `useCallback`, чтобы `useSyncExternalStore` не видел новые функции на каждый render без причины.

Требование: при переносе не удалять эти callbacks.

### Stable scope handles

`ReactSyncReceiver.getScope(nodeId)` кеширует `Object.freeze({ kind: 'scope', _nodeId })` в `scopesByNodeId`.

Польза:

- `WeakMap` dispatch cache работает корректно.
- React context получает стабильный object для того же node.
- `Many` key использует `_nodeId`, а не synthetic entity id.

### Stable empty values

Weather использует frozen constants:

- `EMPTY_OBJECT = Object.freeze({})`
- `EMPTY_ITEMS = Object.freeze([])`

Требование: не возвращать новый `{}` или `[]` из read APIs при каждом render.

### Attr read cache

`ReactSyncReceiver.readAttrs(nodeId, attrNames)` собирает `nextValues`, сравнивает каждое поле через `Object.is`, и если значения не изменились, возвращает прежний object reference.

Польза: component, читающий attrs, не получает новый object при unrelated updates.

### Many read cache

`readManyScopes(scope, relName)` кеширует array of scopes по `nodeId + relName` и возвращает прежний frozen array, если rel value не изменился.

Польза: списки tracks/clips/effects не получают новый array при unrelated attr updates.

### Dirty-by-name batching

Receiver собирает dirty attrs/rels/lists в maps:

```text
dirtyAttrsByNodeId: Map<nodeId, Set<attrName>>
dirtyRelsByNodeId: Map<nodeId, Set<relName>>
dirtyListsByNodeId: Map<nodeId, Set<relName>>
```

После batch update он вызывает только listeners, подписанные на конкретные измененные names. Это критично для timeline: изменение одного clip attr не должно перерисовывать весь project tree.

### Rel equality check

`sameRelValue` сравнивает one/many rel values и пропускает notify, если rel фактически не изменился.

Польза: stable rel subscriptions для больших списков.

### `scopeDispatchCache` WeakMap

Page runtime кеширует dispatch function per scope:

```ts
const scopeDispatchCache = new WeakMap<ReactSyncScopeHandle, DispatchFn>()
```

`useActions()` возвращает стабильную функцию для текущего scope. Это снижает лишние rerenders downstream, если dispatch передается в callbacks/components.

### ShapeRegistry compile/publish/request caches

`ShapeRegistry` оптимизирует structure usage:

- `compiledByShapeId`: compiled shape cache.
- `compilingShapeIds`: cycle detection.
- `publishedShapeIds`: publish only fresh shape graph chunks.
- `activeShapeRefsByNodeId`: ref counting per node/shape.
- `requestedShapeSetsByNodeId`: do not repeat `requireShapeForModel` for same node + shapeIds signature.

Это нужно перенести без MiniCut-специфики.

### Cleanup discipline

Weather использует cleanup wrappers (`once`, `EMPTY_CLEANUP`) и reverse cleanup order in shape registry. Для MiniCut это важно из-за mount/unmount активных panels, inspectors, timeline virtualized chunks.

---

## 5. Linkcraft DKT view/html render: какую идею повторить

Linkcraft HTML-DKT view устроен концептуально так же:

- `dk-rel` меняет current model scope для вложенной template subtree.
- `dk-events` отправляет event в view/model target.
- Remote form `click::dispatch:action` означает model dispatch, а не app-level registry update.
- Direct model RPC хранит `node_id` target model и args.

Ключевой перенос идеи в MiniCut React:

| Linkcraft HTML-DKT | Weather React sync | MiniCut target |
|---|---|---|
| `dk-rel="tracks"` | `<Many rel="tracks" item={TrackLane} />` | Track components render from Track model scopes |
| `dk-rel="activeProject"` | `<One rel="activeProject">` or `<Path rels={[...]}>` | Timeline under active Project scope |
| `dk-events="click::dispatch:rename"` | `useActions()('rename', payload)` | Button/input dispatches to current Clip/Text/Effect model |
| direct RPC `node_id + args` | `scope_node_id + payload` | Worker resolves DKT model by `_nodeId` |

Миникату не нужно копировать DOM owner runtime. Нужно повторить принцип: render subtree всегда имеет model scope, а event из subtree идет в эту model или явно выбранный parent/root scope.

---

## 6. Что нужно удалить из основной архитектуры MiniCut

Текущее состояние MiniCut смешивает две authority:

- legacy registry: `Command -> DispatchResult -> PatchEnvelope -> ProjectRegistry`;
- DKT model tree: attrs/rels/actions/effects.

В production render/write path должны исчезнуть:

- `registrySnapshot` как root attr для UI;
- `DktRegistryRenderStore` как источник UI state;
- `PATCHES` как page update protocol;
- `SNAPSHOT` / `GET_SNAPSHOT` / `REPLACE_SNAPSHOT` как runtime protocol;
- `DISPATCH_COMMAND` / `DISPATCH_RESULT` как app editing protocol;
- big `getDispatch` switch по `scope.type` в `createDktEditorRenderRuntime`;
- `VideoEditorHarnessActions` как route для production UI writes;
- shadow DKT dispatch после legacy command execution.

Legacy code можно временно оставить под `legacy`/tests/adapters, но он не должен быть imported by app runtime/render path.

### Ревью прогресса после сравнения с weather и Linkkraft

Проверка против `D:\code\linkcraft\weather` и `D:\code\linkcraft\src` показала, что правильная ось синхронизации не `app root -> page`, а `session root -> pioneer -> app root`. Weather вызывает `hookSessionRoot(app_model, app_model.start_page, ...)`, затем `sync_sender.addSyncStream(session.sessionRoot, stream, [['pioneer']])`; React UI читает приложение через `<One rel="pioneer">`. Linkkraft делает то же концептуально через `initBrowsing(appModel)`, `common_session_root`, `selectRoot` и `syncSender.addSyncStream(root, stream, IMPORTANT_REL_PATHS)`.

Ошибки, найденные в промежуточной MiniCut-реализации:

- stream был переведен на `appModel`, из-за чего session attrs и `pioneer` перестали быть first-class root contract;
- shape mount пытался компенсировать это через `setTimeout`/retry и debug graph lookup;
- harness получил local session fallback и debug methods, что смешивало Legend state и DKT replica;
- worker ждал internal `sync_sender.sockets`, то есть зависел от private shape/syncsender state;
- proxy lookup опирался на `getLinedStructure`/runtime debug dump и polling, хотя DKT rels нужно читать внутри `model.input(...)` consistency window.

Исправление в commit `dbfead2`: transport снова bootstraps session root, important rel path теперь `[['pioneer']]`, page scoped dispatch resolves through `getModelById(sessionRoot, scope_node_id)`, proxy materialization reads DKT rels inside `appModel.input(...)`, and the hybrid debug/local-session render adapter was removed from production wiring.

---

## 7. Целевая структура файлов MiniCut

### Generic DKT React layer

```text
src/dkt-react-sync/
  components/
    Many.tsx
    One.tsx
    Path.tsx
  context/
    ReactScopeRuntimeContext.tsx
    ScopeContext.tsx
  hooks/
    useActions.ts
    useAttrs.ts
    useReactScopeRuntime.ts
    useScope.ts
    useShape.ts
    useSyncRoot.ts
  receiver/
    ReactSyncReceiver.ts
  runtime/
    PageSyncRuntime.ts
    ReactScopeRuntime.ts
    createSyncStore.ts
  scope/
    RootScope.tsx
    ScopeHandle.ts
  shape/
    MountedShape.tsx
    ShapeRegistry.ts
    autoShapes.ts
    defineShape.ts
```

### MiniCut-specific DKT runtime adapters

```text
src/video-editor/dkt/runtime/
  createMiniCutDktRuntime.ts
  createMiniCutPageSyncRuntime.ts
  workerModelRuntime.ts
  scopedActionTransport.ts
  pageRuntimeStore.ts
```

Target responsibilities:

- `createMiniCutPageSyncRuntime.ts`: app-specific transport adapter around generic `ReactSyncReceiver`, `ShapeRegistry`, `createSyncStore`.
- `workerModelRuntime.ts`: session bootstrap, sync stream, scoped dispatch via `getModelById`.
- `scopedActionTransport.ts`: message creation/validation for `DISPATCH_ACTION`, `SYNC_HANDLE`, `SYNC_UPDATE_STRUCTURE_USAGE`, `SYNC_REQUIRE_SHAPE`.
- `pageRuntimeStore.ts`: boot/ready/session metadata only, not registry snapshot.

### MiniCut UI bindings

```text
src/video-editor/ui/dkt/
  DktEditorRoot.tsx
  shapes.ts
  rels.ts
  actionNames.ts
  hooks/
    useEditorSessionAttrs.ts
    useActiveProjectScope.ts
    useSelectedEntityScope.ts
```

Target responsibilities:

- Import generic `RootScope`, `Path`, `One`, `Many`, `useAttrs`, `useActions`.
- Define MiniCut shapes outside generic layer.
- Keep UI convenience wrappers outside generic layer.

### MiniCut model ownership

```text
src/video-editor/models/
  SessionRoot/
    actions.ts
    effects.ts
    shape.ts
  Project/
    actions.ts
    effects.ts
    shape.ts
  Track/
    actions.ts
    shape.ts
  Clip/
    actions.ts
    effects.ts
    shape.ts
  Text/
    actions.ts
    shape.ts
  Effect/
    actions.ts
    shape.ts
  Resource/
    actions.ts
    effects.ts
    shape.ts
```

Model folders own action semantics. UI dispatches action names to current scope; it does not build command objects.

---

## 8. Комплексный план миграции

### Фаза 1: Перенос абстрактного `src/dkt-react-sync` 1:1 из weather

Цель: добавить generic DKT + React sync layer без MiniCut логики и без подключения production UI.

Будущая структура файлов:

```text
src/dkt-react-sync/components/Many.tsx
src/dkt-react-sync/components/One.tsx
src/dkt-react-sync/components/Path.tsx
src/dkt-react-sync/context/ReactScopeRuntimeContext.tsx
src/dkt-react-sync/context/ScopeContext.tsx
src/dkt-react-sync/hooks/useActions.ts
src/dkt-react-sync/hooks/useAttrs.ts
src/dkt-react-sync/hooks/useReactScopeRuntime.ts
src/dkt-react-sync/hooks/useScope.ts
src/dkt-react-sync/hooks/useShape.ts
src/dkt-react-sync/hooks/useSyncRoot.ts
src/dkt-react-sync/receiver/ReactSyncReceiver.ts
src/dkt-react-sync/runtime/PageSyncRuntime.ts
src/dkt-react-sync/runtime/ReactScopeRuntime.ts
src/dkt-react-sync/runtime/createSyncStore.ts
src/dkt-react-sync/scope/RootScope.tsx
src/dkt-react-sync/scope/ScopeHandle.ts
src/dkt-react-sync/shape/MountedShape.tsx
src/dkt-react-sync/shape/ShapeRegistry.ts
src/dkt-react-sync/shape/autoShapes.ts
src/dkt-react-sync/shape/defineShape.ts
```

Изменения в файлах:

- Add files above from weather with mechanical import path adjustment.
- Rename weather-specific shape symbol from `weather.react_sync.shape` to generic `dkt.react_sync.shape`.
- Keep public API generic.
- Do not import from `src/video-editor`.
- Do not import MiniCut `DKT_MSG`.

Релевантные тесты:

- `npm run test:video-editor -- src/dkt-react-sync/receiver/ReactSyncReceiver.test.ts`
- `npm run test:video-editor -- src/dkt-react-sync/shape/ShapeRegistry.test.ts`
- `npm run test:video-editor -- src/dkt-react-sync/hooks/useAttrs.test.tsx`
- `npm run test:video-editor -- src/dkt-react-sync/components/Path.test.tsx`

См. единую сводную таблицу в начале документа (строки 1-4).

### Фаза 2: MiniCut page runtime adapter поверх generic layer

Цель: сделать MiniCut аналог weather `createPageSyncReceiverRuntime`, но вне `src/dkt-react-sync`.

Будущая структура файлов:

```text
src/video-editor/dkt/runtime/createMiniCutPageSyncRuntime.ts
src/video-editor/dkt/runtime/createMiniCutPageSyncRuntime.test.ts
src/video-editor/dkt/runtime/pageRuntimeStore.ts
src/video-editor/dkt/runtime/scopedActionTransport.ts
src/video-editor/dkt/shared/messageTypes.ts
```

Изменения в файлах:

- `createMiniCutPageSyncRuntime.ts` creates generic `ReactSyncReceiver`, `ShapeRegistry`, `createSyncStore`.
- `createMiniCutPageSyncRuntime.ts` handles only boot/ready/root metadata and DKT sync stream.
- `scopedActionTransport.ts` validates and creates messages:
  - `BOOTSTRAP_SESSION`
  - `CLOSE_SESSION`
  - `DISPATCH_ACTION`
  - `SYNC_HANDLE`
  - `SYNC_UPDATE_STRUCTURE_USAGE`
  - `SYNC_REQUIRE_SHAPE`
  - `RUNTIME_READY`
  - `RUNTIME_ERROR`
- `messageTypes.ts` marks legacy messages as deprecated and separates production protocol from legacy compatibility.
- Existing `pageSyncReceiver.ts` becomes compatibility wrapper or is replaced after call sites move.

Релевантные тесты:

- `npm run test:video-editor -- src/video-editor/dkt/runtime/createMiniCutPageSyncRuntime.test.ts`
- `npm run test:video-editor -- src/video-editor/dkt/shared/messageTypes.test.ts`
- `npm run test:video-editor -- src/video-editor/dkt/runtime/pageSyncReceiver.test.ts`

См. единую сводную таблицу в начале документа (строки 5-9).

### Фаза 3: Worker runtime dispatch by DKT scope

Цель: worker должен принимать scoped action и вызывать `model.dispatch` на DKT model, найденной по `scope_node_id`.

Будущая структура файлов:

```text
src/video-editor/dkt/runtime/workerModelRuntime.ts
src/video-editor/dkt/runtime/workerModelRuntime.test.ts
src/video-editor/dkt/runtime/createMiniCutDktRuntime.ts
src/video-editor/worker/dktSharedWorker.ts
```

Изменения в файлах:

- `workerModelRuntime.ts` owns session/app entries.
- On bootstrap: create or reuse session root and call `sync_sender.addSyncStream(sessionRoot, stream, importantRelPaths)`.
- On `DISPATCH_ACTION`: resolve target using `getModelById(sessionRoot, scope_node_id)`.
- Dispatch target action directly: `target.dispatch(action_name, payload)`.
- Handle null `scope_node_id` as session/app root dispatch only for root-level actions.
- Keep `DISPATCH_COMMAND` only in legacy adapter tests until removed.
- `createMiniCutDktRuntime.ts` stops being registry authority and becomes thin DKT runtime host.

Релевантные тесты:

- `npm run test:video-editor -- src/video-editor/dkt/runtime/workerModelRuntime.test.ts`
- `npm run test:video-editor -- src/video-editor/dkt/runtime/createMiniCutDktRuntime.test.ts`
- `npm run test:video-editor -- src/video-editor/worker/dktSharedWorker.test.ts`

См. единую сводную таблицу в начале документа (строки 10-14).

### Фаза 4: SessionRoot и Project navigation через DKT rels

Цель: заменить session/active project render source на DKT rels and attrs.

Будущая структура файлов:

```text
src/video-editor/models/SessionRoot/actions.ts
src/video-editor/models/SessionRoot/effects.ts
src/video-editor/models/SessionRoot/shape.ts
src/video-editor/models/Project/shape.ts
src/video-editor/ui/dkt/DktEditorRoot.tsx
src/video-editor/ui/dkt/hooks/useEditorSessionAttrs.ts
src/video-editor/ui/dkt/hooks/useActiveProjectScope.ts
```

Изменения в файлах:

- SessionRoot exposes attrs/rels needed by UI:
  - `activeProject`
  - `selectedEntity`
  - `cursor`
  - `timelineZoom`
  - `isPlaying`
  - `activeInspectorTab`
- UI root renders through generic `RootScope`.
- Active project UI uses `Path rels={['session', 'activeProject']}` or equivalent root rel path.
- Legend session store remains read-only compatibility until all UI panels migrate.

Релевантные тесты:

- `npm run test:video-editor -- src/video-editor/models/SessionRoot/actions.test.ts`
- `npm run test:video-editor -- src/video-editor/ui/dkt/DktEditorRoot.test.tsx`
- `npm run test:video-editor -- src/video-editor/app/createVideoEditorHarness.test.ts`

См. единую сводную таблицу в начале документа (строки 15-19).

### Фаза 5: Timeline render from model tree

Цель: Timeline должен читать Project/Track/Clip/Text/Effect scopes из DKT replica, не из `ProjectRegistry`.

Будущая структура файлов:

```text
src/video-editor/models/Track/shape.ts
src/video-editor/models/Clip/shape.ts
src/video-editor/models/Text/shape.ts
src/video-editor/models/Effect/shape.ts
src/video-editor/ui/timeline/Timeline.tsx
src/video-editor/ui/timeline/TrackLane.tsx
src/video-editor/ui/timeline/ClipItem.tsx
src/video-editor/ui/timeline/TextClipItem.tsx
src/video-editor/ui/dkt/shapes.ts
```

Изменения в файлах:

- Timeline uses `Many rel="tracks" item={TrackLane}` under active Project scope.
- TrackLane uses `useAttrs(['name', 'kind', 'height'])` and `Many rel="clips"`.
- ClipItem reads clip attrs directly: `start`, `duration`, `resource`, `transform`, `opacity`, `color`, `audio`.
- TextClipItem reads Text model attrs directly.
- Effect panels use `Many rel="effects"` from Clip/Text scope.
- No component should read `ProjectRegistry.entitiesById` for timeline render.

Релевантные тесты:

- `npm run test:video-editor -- src/video-editor/ui/timeline/Timeline.test.tsx`
- `npm run test:video-editor -- src/video-editor/ui/timeline/TrackLane.test.tsx`
- `npm run test:video-editor -- src/video-editor/models/Track/actions.test.ts src/video-editor/models/Clip/actions.test.ts`
- `npm run test:video-editor -- tests/integration/video-editor.spec.ts`

См. единую сводную таблицу в начале документа (строки 20-24).

### Фаза 6: Inspector and property editing через scoped dispatch

Цель: inspector controls должны dispatch-ить action в текущую selected model scope.

Будущая структура файлов:

```text
src/video-editor/ui/inspector/InspectorPanel.tsx
src/video-editor/ui/inspector/ClipInspector.tsx
src/video-editor/ui/inspector/TextInspector.tsx
src/video-editor/ui/inspector/EffectInspector.tsx
src/video-editor/ui/dkt/hooks/useSelectedEntityScope.ts
src/video-editor/models/Clip/actions.ts
src/video-editor/models/Text/actions.ts
src/video-editor/models/Effect/actions.ts
```

Изменения в файлах:

- Selection is DKT rel/attr on SessionRoot, not only Legend state.
- Inspector resolves selected model through DKT scope.
- Controls call `const dispatch = useActions()` and dispatch model-local actions.
- Remove `updateClipById`, `updateTextById`, `updateEffectById` from production UI action route.

Релевантные тесты:

- `npm run test:video-editor -- src/video-editor/ui/inspector/InspectorPanel.test.tsx`
- `npm run test:video-editor -- src/video-editor/models/Clip/actions.test.ts src/video-editor/models/Text/actions.test.ts src/video-editor/models/Effect/actions.test.ts`
- `npm run test:video-editor -- tests/integration/video-editor.spec.ts`

См. единую сводную таблицу в начале документа (строки 25-30).

### Фаза 7: Editing actions as DKT model actions

Цель: все editing writes становятся model-local DKT actions/effects.

Будущая структура файлов:

```text
src/video-editor/models/Project/actions.ts
src/video-editor/models/Track/actions.ts
src/video-editor/models/Clip/actions.ts
src/video-editor/models/Text/actions.ts
src/video-editor/models/Effect/actions.ts
src/video-editor/models/Resource/actions.ts
src/video-editor/app/createDktActionRuntime.ts
src/video-editor/domain/actionCommandBuilders.ts
src/video-editor/domain/actionTransactions.ts
```

Изменения в файлах:

- Project actions: `addTrack`, `removeTrack`, `importResource`, `createText`, `renderExport`.
- Track actions: `addClip`, `addTextClip`, `removeClip`, `splitAt`, `reorderClip`.
- Clip actions: `rename`, `trim`, `move`, `setTransform`, `setOpacity`, `setAudio`, `addEffect`, `removeEffect`, `reorderEffect`.
- Text actions: `setContent`, `setStyle`, `setBox`, `setTiming`.
- Effect actions: `setEnabled`, `setKind`, `setAmount`, `setParams`, `setColor`.
- `createDktActionRuntime.ts` becomes legacy compatibility adapter only.
- `actionCommandBuilders.ts` stops being production path.

Релевантные тесты:

- `npm run test:video-editor -- src/video-editor/models/Project/actions.test.ts`
- `npm run test:video-editor -- src/video-editor/models/Track/actions.test.ts`
- `npm run test:video-editor -- src/video-editor/models/Clip/actions.test.ts`
- `npm run test:video-editor -- src/video-editor/models/Text/actions.test.ts`
- `npm run test:video-editor -- src/video-editor/models/Effect/actions.test.ts`

См. единую сводную таблицу в начале документа (строки 31-37).

### Фаза 8: Import/export/resource/P2P через DKT effects

Цель: runtime capabilities остаются эффектами, но ownership находится у моделей.

Будущая структура файлов:

```text
src/video-editor/models/Project/effects.ts
src/video-editor/models/Resource/effects.ts
src/video-editor/models/Clip/effects.ts
src/video-editor/media/resourceTransferManager.ts
src/video-editor/render/exportRenderer.ts
src/video-editor/app/mediaImportActions.ts
src/video-editor/app/exportActions.ts
```

Изменения в файлах:

- File picker remains UI capability, then dispatches Project effect request.
- Project effect creates Resource and timeline model nodes through DKT actions.
- Resource effect registers blob/object URL/P2P metadata and exposes status attrs.
- Export effect reads model tree/export projection, not `ProjectRegistry` snapshot.
- `mediaImportActions.ts` and `exportActions.ts` become compatibility wrappers or are removed from production UI.

Релевантные тесты:

- `npm run test:video-editor -- src/video-editor/models/Project/effects.test.ts`
- `npm run test:video-editor -- src/video-editor/models/Resource/effects.test.ts`
- `npm run test:video-editor -- tests/integration/export-audio-artifacts.spec.ts`
- `npm run test:video-editor -- tests/integration/p2p-media-transfer.spec.ts`
- `npm run test:video-editor -- tests/integration/p2p-media-large-chunk-transfer.spec.ts`

См. единую сводную таблицу в начале документа (строки 38-42).

### Фаза 9: Удаление snapshot/patch/registry render path

Цель: удалить legacy registry authority из production runtime/render.

Будущая структура файлов:

```text
src/video-editor/render-sync/DktRegistryRenderStore.ts
src/video-editor/render-sync/createDktEditorRenderRuntime.ts
src/video-editor/dkt/runtime/pageSyncReceiver.ts
src/video-editor/dkt/runtime/createMiniCutDktRuntime.ts
src/video-editor/domain/applyPatch.ts
src/video-editor/domain/applyPatchInPlace.ts
src/video-editor/domain/applyCommand.ts
src/video-editor/domain/commandHandlerRegistry.ts
src/video-editor/domain/actionCommandBuilders.ts
src/video-editor/domain/actionTransactions.ts
src/video-editor/domain/*CommandHandlers.ts
```

Изменения в файлах:

- Remove `DktRegistryRenderStore` from app imports.
- Remove `registrySnapshot` root attr reliance.
- Remove `PATCHES`, `SNAPSHOT`, `DISPATCH_COMMAND`, `DISPATCH_RESULT` from production message switch.
- Move legacy command/patch code to `src/video-editor/domain/legacy/*` only if historical tests still need it.
- Delete obsolete tests that assert patch envelopes instead of model tree updates.

Релевантные тесты:

- `npm run test:video-editor -- src/video-editor/dkt/runtime/createMiniCutDktRuntime.test.ts`
- `npm run test:video-editor -- src/video-editor/dkt/runtime/createMiniCutPageSyncRuntime.test.ts`
- `npm run test:video-editor -- src/video-editor/render-sync/createDktEditorRenderRuntime.test.ts`
- `npm run test:video-editor -- tests/integration/video-editor.spec.ts`
- `npm run test:video-editor -- tests/integration/shared-worker-sync.spec.ts`

См. единую сводную таблицу в начале документа (строки 43-47).

### Фаза 10: Полная валидация и документация результата

Цель: доказать, что MiniCut работает через DKT replica + scoped dispatch end-to-end.

Изменения в файлах:

- Update architecture docs.
- Fill report tables in this document with actual commits/files/problems.
- Add migration notes for removed legacy paths.

Релевантные тесты:

- `npm run test:video-editor`
- `npm run video-editor:build`
- `npm run test:video-editor -- tests/integration/video-editor.spec.ts`
- `npm run test:video-editor -- tests/integration/shared-worker-sync.spec.ts`
- `npm run test:video-editor -- tests/integration/p2p-state-sync.spec.ts`
- `npm run test:video-editor -- tests/integration/p2p-media-transfer.spec.ts`
- `npm run test:video-editor -- tests/integration/export-audio-artifacts.spec.ts`

См. единую сводную таблицу в начале документа (строки 48-52).

---

## 9. Глобальные acceptance criteria

1. `src/dkt-react-sync` не импортирует ничего из `src/video-editor` и не содержит app-specific logic.
2. `Path` используется для common nested rel navigation вместо ручных цепочек nested `One`.
3. React render читает DKT attrs/rels через `useSyncExternalStore`, not registry snapshots.
4. UI dispatch из component идет через `useActions()` to current scope.
5. Worker resolves `scope_node_id` to DKT model and calls `model.dispatch`.
6. Timeline/Inspector render path does not import `ProjectRegistry`.
7. Production runtime does not send/receive `PATCHES` or `SNAPSHOT` for editor state.
8. Production UI write path does not build `Command` objects.
9. ShapeRegistry sends structure usage and required shapes for mounted UI scopes.
10. Existing import/export/P2P capabilities work through model effects and Resource state.

---

## 10. Почему это комплексная миграция, а не first slice

Первый вертикальный slice все еще полезен для проверки идеи, но его недостаточно как критерий завершения. Завершенной миграция считается только когда:

- generic layer перенесен и покрыт тестами;
- page runtime and worker runtime работают через DKT sync/action protocol;
- SessionRoot/Project/Timeline/Inspector читают model tree;
- editing/import/export/P2P writes идут через model actions/effects;
- snapshot/patch/command path удален из production runtime;
- отчетные таблицы выше заполнены реальными commits, changed files и фактическими проблемами реализации.
