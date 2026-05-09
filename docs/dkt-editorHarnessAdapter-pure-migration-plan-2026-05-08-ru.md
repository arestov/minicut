# editorHarnessAdapter -> DKT pure migration plan (2026-05-08)

## Цель

Убрать из `editorHarnessAdapter.ts` внешний imperative orchestration, traversal через `pageRuntime.readOne/readMany/readAttrs`, busy-wait циклы и fallback логику, перенеся доменное поведение в DKT actions (deps/multi-step/$output/$input/$noop) и, при необходимости, в `$fx_...` задачи.

База по адресации и special tokens: `docs/dkt-addressing-and-spec-addr-ru.md`.

## Ключевые наблюдения

1. `editorHarnessAdapter.ts` и `createDktActionRuntime.ts` содержат почти дублирующий imperative слой (same anti-pattern в двух местах).
2. В моделях уже есть DKT multi-step паттерны (`SessionRoot.createProject`, `SessionRoot.splitSelectedClip`, `Project.importResource`, `Project.addResourceToTimeline`).
3. Сейчас есть две конкурирующие стратегии экспорта: eager `exportPlan` как `comp` в `Project` и fallback-сборка в adapter. Это дает divergence и лишние пересчеты.
4. `waitForRuntimeReady` / `waitForActiveProjectScope` / `waitForPeerId` это polling и temporal coupling; так нельзя оставлять в production adapter.
5. `dispatchClipActionById` решает удобство API, но ценой traversal + hidden fallback на selected clip (маскировка ошибок).
6. В `editorHarnessAdapter.ts` есть мертвый код: `getTrackScopeByKind`, `getResourceAttrsById`, `dispatchTrackClip` (используются только внутри файла и нигде не вызываются).
7. Дополнительно обнаружена внешняя оркестрация, ранее не описанная в плане:
	- `VideoEditorHarnessApp.tsx`: debug-метод `dispatchCreateProject` с polling-ready loop.
	- `createVideoEditorHarness.ts`: `subscribeToResourceScopes` с `setTimeout` retry и `setInterval` refresh (500ms).
8. Polling для debug/test сценариев должен жить только в явных test helpers с маркировкой `testing` в имени файла.

## Ревью: exportPlan comp vs fallback

### Что делает текущий `exportPlan` comp

- `Project.exportPlan` собирается как `comp` из `sourceProjectId/fps/width/height/duration/previewClipSources`.
- `previewClipSources` в свою очередь собирается из `Clip.clipRenderData` по deps `< @all:clipRenderData < tracks.clips`.
- `clipRenderData` уже включает `effects`, `filters`, `resourceUrl/mime` (через `resource.renderSummary`) и `text` (через `text.renderAttrs`).

### Что делает fallback в adapter

- Обходит `project -> tracks -> clips` и вручную читает attrs/resources/effects через `readMany/readAttrs`.
- Ручной merge эффектов и ручное построение `clipSources`.
- Восстанавливает `projectId` через `activeProjectId`, если `sourceProjectId` пуст.

### Различия и риски

| Аспект | `exportPlan` comp | fallback adapter | Риск |
|---|---|---|---|
| Точка вычисления | Реактивно, при изменении зависимостей | Только в момент export | Сейчас одновременно живут обе стратегии |
| Источник clip data | `clipRenderData` (единый projection) | Ручной traversal + attrs read | Drift логики со временем |
| `text` в clip | Поддерживается (`text.renderAttrs`) | Всегда `text: null` | Потеря данных в fallback |
| `duration` проекта | Берется из `Project.duration` | Пересчитывается как max(`start+duration`) | Возможные расхождения длительности |
| `projectId` | `sourceProjectId` | Патч через `activeProjectId` fallback | Маскировка проблем инициализации |
| Стоимость вычисления | Eager пересчет при апдейтах timeline | Lazy on export | Лишняя нагрузка для export-only projection |

### Вывод по ревью

1. Fallback надо удалить полностью.
2. Если цель: считать экспорт только по клику Export, то `exportPlan` не должен быть `comp` на `Project`.
3. Нужен on-demand export projection в action/saga (внутри DKT), который строится один раз на команду экспорта и передается в `$fx_renderExport`.

## Таблица ревью: internal/helpers

| Функция | Зачем сейчас | Проблема относительно DKT pure | План замены |
|---|---|---|---|
| `roundToHundredths` | Округление времени split/cursor | Не проблема | Оставить util (можно вынести в общий util). |
| `asFiniteNumber` | Нормализация чисел при fallback export plan | Работает только из-за imperative чтений | Убрать вместе с fallback export планом из adapter. |
| `createSourceId` | Генерация source id для project/text/clip/resource | Нормально для boundary | Оставить на boundary или перенести в DKT action payload normalizer. |
| `getRootScope` | Доступ к root scope | Технический traversal | Минимизировать: adapter должен только dispatch root actions. |
| `getActiveProjectScope` | Поиск active project через rel чтение | Traversal вне DKT action deps | Убрать; target project должен резолвиться в DKT action (через `<< activeProject`). |
| `getSelectedClipScope` | Поиск selected clip rel | Traversal вне DKT | Убрать; selected clip использовать внутри SessionRoot actions. |
| `dispatchRoot` | Dispatch на root | Допустимый boundary | Оставить как единую точку dispatch из UI в DKT. |
| `dispatchProject` | Dispatch на active project scope | Внешний traversal | Заменить root-level actions, которые внутри DKT идут в `<< activeProject`. |
| `dispatchSelectedClipAction` | Dispatch на selected clip | Внешний traversal | Заменить root-level selected-clip actions с inline_subwalker. |
| `findClipScopeById` | Поиск clip model по id в tracks.clips | Глубокий traversal + manual attrs read | Перенести в deps внутри action (`< @all:sourceClipId < activeProject.tracks.clips` + `<< @all:activeProject.tracks.clips`). |
| `dispatchClipActionById` | Dispatch clip action by clipId, fallback на selected clip | Imperative traversal + скрытый fallback | Удалить. Ввести DKT multi-step action per command by id (или универсальный dispatch command на SessionRoot). |
| `pushExportDebug` | Runtime debug событий экспорта | Не core-domain, но норм как boundary | Оставить временно; в long-term через debug fx/logging port. |
| `getTrackScopeByKind` | Поиск track по kind | Мертвый код | Удалить. |
| `getResourceAttrsById` | Поиск attrs resource по id | Мертвый код | Удалить. |
| `toResolvedScalar` | Приведение value/keyframes | Нужен только fallback export plan | Убрать вместе с fallback export. |
| `buildFallbackExportPlan` | Императивная сборка export plan обходом графа | Крупное нарушение DKT pure + duplicate логики | Удалить. Заменить on-demand projection в DKT action/saga. |
| `dispatchTrackClip` | Dispatch addClip на track scope | Мертвый код | Удалить. |
| `isTimelineEmpty` | Проверка timelineDuration для import behavior | Внешнее attrs чтение | Логику держать в DKT (уже частично есть в `Project.importResource`). |
| `waitForActiveProjectScope` | Polling ожидание active project | Side-effect + temporal coupling | Убрать из production adapter; если нужно в тестах, перенос в testing helper file. |
| `waitForRuntimeReady` | Polling readiness | Side-effect + busy wait | Убрать из production adapter; тестовый helper/fixture. |
| `waitForPeerId` | Polling peerId | Side-effect + busy wait | Убрать из production adapter; в runtime task executor или testing helper. |
| `importFilesDirectly` | Async import pipeline: media probe, importResource, registerLocalResource, delay 300ms | Imperative orchestration в adapter | Разбить: DKT action формирует domain mutations + `$fx_handleInputFiles` / `$fx_registerLocalResource` task dispatch; runtime executor выполняет IO. |
| `queueExport` | Берет plan и запускает render | Сейчас содержит traversal/readAttrs и fallback | Убрать из adapter. Экспорт запускать через root action -> `$fx_renderExport`. |
| `createEditorHarnessAdapter` | Сборка публичного API | Сейчас смешивает UI API и domain orchestration | Оставить thin adapter: root dispatch + минимум boundary вызовов (без traversal/readAttrs). |

## Таблица ревью: public API methods

| Метод API | Зачем | Статус | План |
|---|---|---|---|
| `createProject` | Создать проект | Ок | Оставить, dispatch root `createProject`. |
| `setActiveProject` | Переключить проект | Ок | Оставить. |
| `importSampleResource` | Импорт sample | Ок | Оставить. |
| `importFiles` | Импорт файлов | Не ок (imperative pipeline) | Перевести на DKT action + `$fx_handleInputFiles` / runtime task executor. |
| `addResourceToTimeline` | Добавить resource | Не ок (dispatchProject) | Root action, внутри DKT переход в `<< activeProject` + `addResourceToTimeline`. |
| `addTextClip` | Добавить text clip | Почти ок | Оставить root dispatch, id generation можно оставить на boundary. |
| `addTrack` | Добавить track | Не ок (dispatchProject) | Root action -> `<< activeProject` subwalker. |
| `selectEntity` | Выбор сущности | Ок | Оставить. |
| `setActiveInspectorTab` | Выбор вкладки | Ок | Оставить. |
| `renameClipById` | rename by id | Не ок (`dispatchClipActionById`) | Новый DKT action by id (multi-step). |
| `renameSelectedClip` | rename selected | Не ок (dispatchSelectedClipAction) | Root selected-clip action с inline_subwalker. |
| `colorClipById` | color by id | Не ок | Новый DKT action by id. |
| `colorSelectedClip` | color selected | Не ок | Root selected-clip action. |
| `updateClipOpacityById` | opacity by id | Не ок | Новый DKT action by id. |
| `updateSelectedClipOpacity` | opacity selected | Не ок | Root selected-clip action. |
| `updateClipFadeById` | fade by id | Не ок | Новый DKT action by id. |
| `updateSelectedClipFade` | fade selected | Не ок | Root selected-clip action. |
| `updateClipTransformById` | transform by id | Не ок | Новый DKT action by id. |
| `updateSelectedClipTransform` | transform selected | Не ок | Root selected-clip action. |
| `updateClipAudioById` | audio by id | Не ок | Новый DKT action by id. |
| `updateSelectedClipAudio` | audio selected | Не ок | Root selected-clip action. |
| `trimClipById` | trim by id | Не ок | Новый DKT action by id. |
| `trimSelectedClip` | trim selected | Не ок | Root selected-clip action. |
| `resizeClipById` | resize by id | Не ок | Новый DKT action by id. |
| `addEffectToClip` | add effect by id | Не ок | Новый DKT action by id. |
| `addEffectToSelectedClip` | add effect selected | Не ок | Root selected-clip action. |
| `addColorCorrectionToClip` | add CC by id | Не ок | Новый DKT action by id. |
| `addColorCorrectionToSelectedClip` | add CC selected | Не ок | Root selected-clip action. |
| `deleteClipById` | delete by id | Не ок | Новый DKT action by id. |
| `deleteSelectedClip` | delete selected | Частично ок | Оставить root `deleteSelectedClip`. |
| `splitSelectedClip` | split selected at cursor | Ок | Оставить root `splitSelectedClip` (уже saga в DKT). |
| `splitClipByIdAt` | split by id/time | Не ок | Новый DKT action by id + payload time. |
| `removeEffectFromClip` | remove effect by id | Не ок | Новый DKT action by id. |
| `removeEffectFromSelectedClip` | remove effect selected | Не ок | Root selected-clip action. |
| `queueClipExportById` | экспорт клипа | Не ок (queueExport с traversal/fallback) | Root action `requestClipExportById` + `$fx_renderExport`. |
| `queueSelectedClipExport` | экспорт selected clip | Не ок (readAttrs selected) | Root action `requestSelectedClipExport`, внутри DKT резолв selected clip. |
| `queueProjectExport` | экспорт проекта | Не ок (queueExport with fallback path) | Root action `requestProjectExport` + on-demand projection + `$fx_renderExport`. |
| `nudgeSelectedClip` | move selected | Не ок (dispatchSelectedClipAction) | Root selected-clip action. |
| `moveClipById` | move by id | Не ок | Новый DKT action by id. |
| `togglePlayback` | toggle | Ок | Оставить. |
| `setCursor` | set cursor | Ок | Оставить. |
| `tickPlayback` | playback tick | Ок | Оставить. |
| `zoomTimeline` | zoom | Ок | Оставить. |

## Зачем сейчас нужен `dispatchClipActionById`

Практически он закрывает UX-кейс: UI часто знает `clipId`, а не runtime `clipScope`, и нужно применить clip action к конкретному клипу.

Что не так:
- Для этого он вручную travers-ит `activeProject -> tracks -> clips` и читает `sourceClipId` через `readAttrs`.
- Если клип не найден, молча применяет действие к selected clip (`dispatchSelectedClipAction`), что делает поведение неявным и хрупким.

Рекомендация:
- Удалить helper.
- Ввести DKT-level by-id actions (multi-step), где выбор target происходит через deps-addressing.
- Никакого fallback к selected clip без явного `when_fn` и явной ветки в action.

## Нормативное правило: запрет на by-id wrapper helpers вне DKT

Это правило обязательно для нового кода.

Запрещено:

1. Добавлять wrapper-методы в adapter/UI вида `actions.renameClipById`, `actions.colorClipById`, `actions.trimClipById`, если внутри есть graph traversal.
2. Добавлять helper-ы `findClipScopeById`/`dispatchClipActionById`/аналогичные по track/effect вне DKT action layer.
3. Делать `pageRuntime.readOne/readMany/readAttrs` в adapter ради target resolution.
4. Делать неявный fallback на selected entity при lookup failure.

Разрешено:

1. Root dispatch на `SessionRoot` как command entrypoint.
2. Target resolution только внутри DKT actions через deps/subwalker.
3. Async/IO через `$fx_*`/task executor, но выбор target также внутри DKT.

Идеальный путь:

1. UI формирует payload (`clipId`, `delta`, `effectId`, ...).
2. UI dispatch-ит root command.
3. `SessionRoot` action внутри DKT находит target.
4. Следующий шаг dispatch-ит subwalker action в найденную модель.
5. При отсутствии target: явный `$noop` или controlled error branch.

Принцип:

- traversal и address resolution принадлежат DKT actions;
- adapter не должен знать, как искать clip в `activeProject.tracks.clips`;
- UI boundary должен знать command payload, но не graph traversal rules.

## Обзор реальных `*ById` call sites и scope-контекста

По текущему workspace прямые вызовы `actions.*ById` в React-компонентах есть только в двух местах.

| Метод | Где вызывается | Scope в месте вызова | Можно ли заменить на `useActions()` | Комментарий |
|---|---|---|---|---|
| `renameClipById` | `components/inspector/InspectorClipHeader.tsx` | `Clip scope` выбранного клипа (через `ScopeContext.Provider value={resolvedClipScope}` в `Inspector`) | Да | Для этого call site wrapper не нужен. |
| `queueClipExportById` | `components/inspector/InspectorExportTabPanel.tsx` | `Clip scope` выбранного клипа | Нет, не напрямую | Это async orchestration, не простой clip reducer action. |

Следствия:

1. Тезис "Inspector вне clip scope, значит нужен by-id wrapper" неверен.
2. Для sync clip actions в inspector при наличии scope использовать `useActions()`.
3. Для async export/import не делать adapter traversal, а переводить flow в DKT command/saga + `$fx_*`.

### Почему не просто сделать export action внутри `Clip`

Сделать можно, но это отдельная архитектурная фаза, а не точечная замена wrapper-метода.

Что потребуется:

1. Описать async lifecycle (request/progress/success/failure).
2. Вынести IO в `$fx_renderExport`/executor.
3. Определить ownership результата (где хранить status/result/blob url).
4. Сохранить target resolution внутри DKT action chain.

Вывод:

- для `rename/color/trim/resize/transform/audio/effects` by-id wrappers вне DKT должны быть убраны;
- для export делать полноценный DKT command/saga pipeline, а не adapter helper с graph reads.

## Предлагаемая целевая архитектура

1. Adapter = thin boundary:
- генерирует payload (например id/time)
- вызывает только root-level `dispatch`
- не читает graph state
- не travers-ит rel
- не делает wait loops

2. Domain behavior = DKT actions:
- выбор активного проекта/клипа через deps
- multi-step orchestration (`$output` между шагами)
- `$noop` для раннего выхода

3. Side effects = runtime task layer:
- через `$fx_...` target (если нужен IO/async)
- task payload serializable, runtimeRef через `tasks.dispatchTask`
- execution в отдельном executor (не в adapter)

## Конкретный план миграции

### Phase 0. Stop duplication

1. Выбрать один runtime entrypoint: `createEditorHarnessAdapter` или `createDktActionRuntime`.
2. Удалить дублирующий файл после выбора источника истины.

### Phase 1. Root-level action façade для project/clip команд

1. В `SessionRoot/actions.ts` добавить root actions:
- `addTrackToActiveProject`
- `addResourceToActiveProjectTimeline`
- `renameSelectedClip`, `colorSelectedClip`, `updateSelectedClipOpacity`, `updateSelectedClipFade`, `updateSelectedClipTransform`, `updateSelectedClipAudio`, `trimSelectedClipByDelta`, `resizeSelectedClipByDelta`, `addEffectToSelectedClip`, `removeEffectFromSelectedClip`, `moveSelectedClipByDelta`
2. Каждая selected-clip команда: `to: ['<< selectedClip', { action: '...', inline_subwalker: true }]`.
3. Adapter methods заменить на root dispatch этих actions.

### Phase 2. By-id команды внутри DKT (замена dispatchClipActionById)

1. Добавить унифицированный root action `runClipCommandById` (или набор typed by-id actions).
2. Step 1 deps: массив clip моделей + массив sourceClipId, матчинг id, результат в `$output`.
3. Step 2: dispatch subwalker action на найденный clip (через `$input` base или промежуточную rel/field с описанным shape).
4. Если clip не найден: явный `$noop` или controlled error path (без silent fallback).

Примечание по shape:
- При передаче model через `$output` и чтении через `$input*` обязательно описать `output_base_rel_shape` и `input_base_rel_shape`.

### Phase 3. Import pipeline: убрать waits и imperative orchestration

1. Удалить из adapter:
- `waitForRuntimeReady`
- `waitForActiveProjectScope`
- `waitForPeerId`
- `importFilesDirectly`
2. Ввести root/project action `importFilesRequested`:
- формирует task payload
- пишет в `$fx_handleInputFiles` с `intent: 'call'` (или `request` по протоколу)
3. Runtime task executor:
- consume runtime refs
- media probe duration
- dispatch model actions (`importResource`, `addEmbeddedAudioToTimeline`)
- registerLocalResource
4. 300ms delay убрать; заменить readiness condition/event-driven attachment (или retry policy в task executor).

### Phase 4. Export pipeline: on-demand plan в action (без `exportPlan` comp)

1. Удалить `buildFallbackExportPlan` и связанные helper-преобразования.
2. Удалить `Project.exportPlan` из `Project.attrs` (не держать export-only projection как eager comp).
3. Оставить `previewClipSources` для preview runtime, но не использовать его как persisted export attr.
4. Добавить root action:
- `requestProjectExport`
- `requestClipExportById`
5. Реализация action как multi-step saga:
- Step 1: deps читают export projection из active project (`sourceProjectId`, `fps`, `width`, `height`, `duration`, `< @all:clipRenderData < activeProject.tracks.clips`) и формируют plan в `$output`.
- Step 2: фильтруют range (project/clip) и при необходимости clip-by-id selection.
- Step 3: target в `$fx_renderExport` с `intent: 'call'`.
6. Runtime task executor делает `env.export.render`, создает blob URL и публикует результат/прогресс.
7. Если `projectId` пустой: чинить инициализацию проекта (`sourceProjectId`), без fallback-патчинга в adapter.

### Phase 5. Тестовый контур и quarantine для imperative helper

1. Вынести test-only helpers в явный testing файл, например:
- `src/video-editor/dkt/testing/runtimeWaits.ts`
2. В production коде не оставлять polling helpers.
3. Тесты adapter перефокусировать:
- проверка, что adapter делает корректный dispatch
- доменная логика проверяется в DKT model tests (`src/video-editor/dkt/models/...`).
4. Debug polling из UI-харнесса держать только через helper из `src/video-editor/app/testing/*.testing.ts`.

### Phase 6. Дополнительные внешние orchestrators (новый аудит)

1. `VideoEditorHarnessApp.tsx`
- `dispatchCreateProject` должен использовать только тестовый helper ожидания runtime-ready (без inline polling loops в файле компонента).
2. `createVideoEditorHarness.ts`
- `runtimeReadyTimeout` и `projectRefreshInterval` в `subscribeToResourceScopes` формально являются orchestration debt.
- Вынести retry/refresh policy в runtime task/executor слой или событийный механизм синхронизации, чтобы не держать polling в app harness.
3. Зафиксировать правило:
- Любой новый polling (`while + setTimeout`, `setInterval` refresh) в `src/video-editor/app/**` допускается только в файлах `*.testing.ts` или в явном runtime task executor с документированной причиной.

## Минимальные критерии готовности

1. В `editorHarnessAdapter.ts` нет `readOne/readMany/readAttrs`.
2. В `editorHarnessAdapter.ts` нет `setTimeout`-polling loops.
3. Нет `dispatchClipActionById` и `findClipScopeById`.
4. В `Project` нет `exportPlan` как eager `comp`; export plan строится только в export action/saga.
5. Все clip-by-id кейсы покрыты DKT actions tests.

## Приоритеты (что делать первым)

1. Убрать by-id traversal (`dispatchClipActionById`) через DKT root actions.
2. Перевести export на on-demand action/saga и удалить `exportPlan` comp + fallback traversal.
3. Убрать import waits и вынести async IO в `$fx_`/task executor.
4. Удалить dead helpers и дубль runtime файла.

## Карта использования: internal/helpers (каждая функция)

Поиск: `rg` по `src/video-editor/app/editorHarnessAdapter.ts` и `src/video-editor/app/createDktActionRuntime.ts`.

| Функция | Где используется сейчас |
|---|---|
| `roundToHundredths` | В `splitClipByIdAt` (adapter и дубль runtime). |
| `asFiniteNumber` | Только внутри `toResolvedScalar`/`buildFallbackExportPlan` в adapter. |
| `createSourceId` | `createProject`, `addTextClip`, `importFilesDirectly` (adapter и дубль runtime). |
| `getRootScope` | `getActiveProjectScope`, `getSelectedClipScope`, `dispatchRoot`, `queueExport` (adapter и дубль runtime). |
| `getActiveProjectScope` | `dispatchProject`, `findClipScopeById`, `waitForActiveProjectScope`, `queueExport` (adapter и дубль runtime). |
| `getSelectedClipScope` | `dispatchSelectedClipAction`, `queueSelectedClipExport` (adapter и дубль runtime). |
| `dispatchRoot` | `createProject`, `setActiveProject`, `importSampleResource`, `addTextClip`, `selectEntity`, `setActiveInspectorTab`, `deleteSelectedClip`, `splitSelectedClip`, `togglePlayback`, `setCursor`, `tickPlayback`, `zoomTimeline` (adapter и дубль runtime). |
| `dispatchProject` | `addResourceToTimeline`, `addTrack` (adapter и дубль runtime). |
| `dispatchSelectedClipAction` | `renameSelectedClip`, `colorSelectedClip`, `updateSelectedClipOpacity`, `updateSelectedClipFade`, `updateSelectedClipTransform`, `updateSelectedClipAudio`, `trimSelectedClip`, `addEffectToSelectedClip`, `addColorCorrectionToSelectedClip`, `removeEffectFromSelectedClip`, `nudgeSelectedClip`; также fallback из `dispatchClipActionById` (adapter и дубль runtime). |
| `findClipScopeById` | Только из `dispatchClipActionById` (adapter и дубль runtime). |
| `dispatchClipActionById` | Все by-id методы: `renameClipById`, `colorClipById`, `updateClipOpacityById`, `updateClipFadeById`, `updateClipTransformById`, `updateClipAudioById`, `trimClipById`, `resizeClipById`, `addEffectToClip`, `addColorCorrectionToClip`, `deleteClipById`, `splitClipByIdAt`, `removeEffectFromClip`, `moveClipById` (adapter и дубль runtime). |
| `pushExportDebug` | `queueExport` + edge cases в `queueSelectedClipExport` (adapter и дубль runtime). |
| `getTrackScopeByKind` | Не используется (мертвый код, только declaration). |
| `getResourceAttrsById` | Не используется (мертвый код, только declaration). |
| `toResolvedScalar` | Только внутри `buildFallbackExportPlan`. |
| `buildFallbackExportPlan` | Только fallback-ветка в `queueExport`, когда нет `computed exportPlan`. |
| `dispatchTrackClip` | Не используется (мертвый код, только declaration). |
| `isTimelineEmpty` | Только `importFilesDirectly` для условия `addEmbeddedAudioToTimeline`. |
| `waitForActiveProjectScope` | Удален из shared adapter/runtime; импорт теперь fail-fast без polling ожидания active project. |
| `waitForRuntimeReady` | Удален из shared adapter/runtime; debug/test polling вынесен в `src/video-editor/app/testing/runtimeWaits.testing.ts`. |
| `waitForPeerId` | Удален из shared adapter/runtime; используется мгновенный `getPeerId()` без polling. |
| `importFilesDirectly` | Только `importFiles` public method (adapter и дубль runtime). |
| `queueExport` | `queueClipExportById`, `queueSelectedClipExport`, `queueProjectExport` (adapter и дубль runtime). |
| `createEditorHarnessAdapter` | Вызывается в `createVideoEditorHarness.ts` и в `editorHarnessAdapter.test.ts`. |

## Карта использования: public API methods (каждая функция)

Поиск: `rg -n "actions.<method>("` по `src` и `tests`.

| Метод | Где используется сейчас |
|---|---|
| `createProject` | `Toolbar.tsx`, `MediaBin.tsx`, `ProjectDropdown.tsx`, `VideoEditorHarnessApp.tsx` (debug flow). |
| `setActiveProject` | `ProjectDropdown.tsx`. |
| `importSampleResource` | Прямых call sites через `actions.importSampleResource(...)` в `src/tests` не найдено. |
| `importFiles` | `MediaBin.tsx` (`input[type=file]`). |
| `addResourceToTimeline` | `MediaBin.tsx`. |
| `addTextClip` | `MediaBin.tsx`. |
| `addTrack` | Прямых call sites в `src/tests` не найдено. |
| `selectEntity` | Прямых call sites в `src/tests` не найдено. |
| `setActiveInspectorTab` | Прямых call sites в `src/tests` не найдено. |
| `renameClipById` | `InspectorClipHeader.tsx`. |
| `renameSelectedClip` | Прямых call sites в `src/tests` не найдено. |
| `colorClipById` | Прямых call sites в `src/tests` не найдено. |
| `colorSelectedClip` | Прямых call sites в `src/tests` не найдено. |
| `updateClipOpacityById` | Прямых call sites в `src/tests` не найдено. |
| `updateSelectedClipOpacity` | Прямых call sites в `src/tests` не найдено. |
| `updateClipFadeById` | Прямых call sites в `src/tests` не найдено. |
| `updateSelectedClipFade` | Прямых call sites в `src/tests` не найдено. |
| `updateClipTransformById` | Прямых call sites в `src/tests` не найдено. |
| `updateSelectedClipTransform` | Прямых call sites в `src/tests` не найдено. |
| `updateClipAudioById` | Прямых call sites в `src/tests` не найдено. |
| `updateSelectedClipAudio` | Прямых call sites в `src/tests` не найдено. |
| `trimClipById` | Прямых call sites в `src/tests` не найдено. |
| `trimSelectedClip` | Прямых call sites в `src/tests` не найдено. |
| `resizeClipById` | Прямых call sites в `src/tests` не найдено. |
| `addEffectToClip` | Прямых call sites в `src/tests` не найдено. |
| `addEffectToSelectedClip` | Прямых call sites в `src/tests` не найдено. |
| `addColorCorrectionToClip` | Прямых call sites в `src/tests` не найдено. |
| `addColorCorrectionToSelectedClip` | Прямых call sites в `src/tests` не найдено. |
| `deleteClipById` | Прямых call sites в `src/tests` не найдено. |
| `deleteSelectedClip` | Прямых call sites в `src/tests` не найдено. |
| `splitSelectedClip` | Прямых call sites в `src/tests` не найдено. |
| `splitClipByIdAt` | Прямых call sites в `src/tests` не найдено. |
| `removeEffectFromClip` | Прямых call sites в `src/tests` не найдено. |
| `removeEffectFromSelectedClip` | Прямых call sites в `src/tests` не найдено. |
| `queueClipExportById` | `InspectorExportTabPanel.tsx`. |
| `queueSelectedClipExport` | Прямых call sites в `src/tests` не найдено. |
| `queueProjectExport` | `Toolbar.tsx`, `editorHarnessAdapter.test.ts`. |
| `nudgeSelectedClip` | Прямых call sites в `src/tests` не найдено. |
| `moveClipById` | Прямых call sites в `src/tests` не найдено. |
| `togglePlayback` | Прямых call sites в `src/tests` не найдено. |
| `setCursor` | `VideoEditorHarnessApp.tsx` (debug flow). |
| `tickPlayback` | Прямых call sites в `src/tests` не найдено. |
| `zoomTimeline` | Прямых call sites в `src/tests` не найдено. |

## Риски, проблемы и REPL runbook

### Основные риски миграции

1. **Semantic drift export payload**: on-demand action начнет формировать payload иначе, чем старый `clipRenderData`.
2. **Потеря текста/эффектов**: при ручной сборке плана легко забыть `text.renderAttrs` или `effects` flatten/merge.
3. **Range bugs (clip vs project)**: неверная фильтрация clip-by-id в saga даст пустой export или лишние clip.
4. **Race в `$fx_renderExport`**: repeated clicks могут порождать дубликаты задач без queue policy.
5. **Регрессия UX progress/result**: если runtime task executor не публикует completion/error, UI зависнет в exporting.
6. **ID consistency**: если `sourceProjectId` пустой, раньше fallback это маскировал; после удаления fallback всплывут реальные init bugs.
7. **Разъезд preview/export**: preview остается через `previewClipSources`, export уходит в on-demand action; важно удержать единый projection source.

### Как используем REPL, если что-то ломается

Источник инструментов и сценариев: `docs/repl-tools-usage-ru.md`.

#### Слой 1: jsdom authoritative state (быстрый smoke)

Команда:

```bash
npm run repl:run
```

Проверяем:
- что root action `requestProjectExport`/`requestClipExportById` dispatch-ится,
- что saga формирует корректный payload (`projectId`, `range`, `clipSources`, `effects/text`),
- что нет silent `$noop` из-за неверных deps.

#### Слой 2: browser runtime sync graph

Команда:

```bash
npm run repl:playwright:runtime
```

Проверяем:
- совпадают ли active project/tracks/clips между authoritative и page runtime,
- что debug API видит тот же clip/source ids перед export,
- что в runtime messages есть шаги export action/saga.

#### Слой 3: browser smoke + screenshot

Команда:

```bash
npm run repl:playwright
```

Проверяем:
- UI триггер export,
- нет визуального зависания панели экспорта,
- финальный screenshot и messages после клика Export.

#### Слой 4: CSS/overlay (если кажется, что не нажимается кнопка)

Команда:

```bash
npm run repl:playwright:css
```

Проверяем:
- hit-testing, `pointer-events`, `z-index` у export panel/button,
- что проблема не в layout, а реально в action/fx pipeline.

### Мини-runbook по типовым авариям

1. **Экспорт ничего не делает**:
- `repl:run` -> убедиться, что action не уходит в `$noop`.
- `repl:playwright:runtime` -> проверить runtime messages на `requestProjectExport`.

2. **Экспорт без text/effects**:
- `repl:run` -> сравнить `clipRenderData` vs payload, который saga отправляет в fx.
- проверить deps на `'< @all:clipRenderData < activeProject.tracks.clips'`.

3. **Экспорт не того клипа**:
- `repl:playwright:runtime` -> проверить `sourceClipId` selection до вызова fx.
- `repl:run` с custom scenario (`MINICUT_REPL_SCENARIO`) для конкретного clipId.

4. **Повторные клики создают гонки**:
- в jsdom и browser runtime проверить queue policy (`replace-last`/`keep-first`) для `'$fx_renderExport'` intent key.


## Связанные файлы

- `src/video-editor/app/editorHarnessAdapter.ts`
- `src/video-editor/app/createDktActionRuntime.ts`
- `src/video-editor/models/SessionRoot/actions.ts`
- `src/video-editor/models/Project.ts`
- `src/video-editor/models/Project/effects.ts`
- `src/video-editor/app/runtimeTaskFacade.ts`
- `docs/dkt-addressing-and-spec-addr-ru.md`
