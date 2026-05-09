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

## Аудит actions: потребности в SessionRoot данных

### Ключевой вывод

Полный аудит всех actions на всех моделях (Clip, Effect, Track, Resource, Text) показывает:

**Ни один entity-level action не нуждается в SessionRoot-данных.**

Все actions читают только:
- свои собственные attrs
- свои собственные downward rels (`<< effects`, `<< clips`)
- payload от caller-а
- upward rels как dispatch target (`<< track`, `<< project`) — но не как data source

У каждой модели есть upward rels для traversal:
- Clip: `track`, `project`, `resource`, `text`
- Effect: `clip`, `project`
- Track: `project`
- Resource: `project`, `clips`
- Text: `clip`

### Таблица: Clip actions (23 action)

| Action | Deps (что читает) | Root данные? | Достаточно scoped dispatch? |
|---|---|---|---|
| `updateOpacity` | payload | нет | да |
| `rename` | payload | нет | да |
| `setClipAttrs` | payload (15 полей) | нет | да |
| `setMediaKind` | payload | нет | да |
| `color` | payload | нет | да |
| `setFade` | `fadeIn`, `fadeOut`, `duration` (self) | нет | да |
| `setAudio` | `audio` (self) | нет | да |
| `setTimelineAttrs` | payload | нет | да |
| `setTransform` | `transform` (self) | нет | да |
| `moveBy` | `start` (self) | нет | да |
| `trim` | `start`, `in`, `duration` (self) | нет | да |
| `resize` | `start`, `in`, `duration` (self) | нет | да |
| `splitAt` | `start`, `duration` (self) | нет | да |
| `addEffect` | payload | нет | да |
| `setResource` | payload | нет | да |
| `setText` | payload | нет | да |
| `setTrack` | payload | нет | да |
| `setProject` | payload | нет | да |
| `setEffects` | payload | нет | да |
| `removeEffect` | `<< @all:effects` (self rel) | нет | да |
| `reorderEffect` | `<< @all:effects` (self rel) | нет | да |
| `removeSelf` | `sourceClipId` (self), `<< track` (upward dispatch) | нет | да |
| `splitSelfAt` | 14 self attrs + `<< track` (upward dispatch) | нет | да |

### Таблица: Effect actions (8 action)

| Action | Deps | Root данные? | Достаточно scoped dispatch? |
|---|---|---|---|
| `setEffectName` | payload | нет | да |
| `setEffectKind` | payload | нет | да |
| `setEffectEnabled` | payload | нет | да |
| `setEffectAmount` | payload | нет | да |
| `setEffectParams` | payload | нет | да |
| `setEffectColor` | payload | нет | да |
| `setEffectClip` | payload | нет | да |
| `setEffectProject` | payload | нет | да |

### Таблица: Track actions (9 action)

| Action | Deps | Root данные? | Достаточно scoped dispatch? |
|---|---|---|---|
| `renameTrack` | payload | нет | да |
| `setTrackMuted` | payload | нет | да |
| `setTrackLocked` | payload | нет | да |
| `addClip` | `<<<<` (self) | нет | да |
| `addTextClip` | `<<<<` (self) | нет | да |
| `splitClipAt` | `<<<<` (self) | нет | да |
| `setClips` | payload | нет | да |
| `removeClip` | `<< @all:clips` (self rel) | нет | да |
| `removeClipBySourceId` | `<< @all:clips` (self rel) | нет | да |

### Таблица: Resource actions (6 action)

| Action | Deps | Root данные? | Достаточно scoped dispatch? |
|---|---|---|---|
| `renameResource` | payload | нет | да |
| `setResourceStatus` | payload | нет | да |
| `setResourceAttrs` | payload | нет | да |
| `requestAddToTimeline` | payload | нет | да |
| `setProject` | payload | нет | да |
| `setClips` | payload | нет | да |

### Таблица: Text actions (4 action)

| Action | Deps | Root данные? | Достаточно scoped dispatch? |
|---|---|---|---|
| `setTextContent` | payload | нет | да |
| `setTextStyle` | `style` (self) | нет | да |
| `setTextBox` | `box` (self) | нет | да |
| `setClip` | payload | нет | да |

### Таблица: SessionRoot actions (21 action) — root по определению

| Action | Root данные | Почему root |
|---|---|---|
| `handleInit` | activeProjectId, pendingProjectInit | Создание проекта при инициализации |
| `createProject` | activeProjectId, activeProject (rel) | Создание нового проекта |
| `setActiveProject` | activeProjectId, activeProject (rel) | Переключение проекта |
| `selectEntity` | selectedEntityId | Session-level selection |
| `syncActiveProjectRel` | activeProject (rel) | Sync от P2P runtime |
| `syncPreviewModel` | previewStructure | Sync от P2P runtime |
| `syncSelectedClipTrackPosition` | selectedClipTrackPosition | Sync от P2P runtime |
| `syncSelectedClipSummary` | selectedClipSummary | Sync от P2P runtime |
| `setActiveInspectorTab` | activeInspectorTab | Session-level UI state |
| `setCursor` | cursor | Session-level playback |
| `setPlaying` | isPlaying | Session-level playback |
| `setTimelineZoom` | timelineZoom | Session-level UI state |
| `tickPlayback` | cursor, isPlaying | Session-level playback |
| `togglePlayback` | isPlaying | Session-level playback |
| `zoomTimeline` | timelineZoom | Session-level UI state |
| `addTextClipToTimeline` | activeProject (rel), selectedEntityId | Root → project delegation + selection |
| `deleteSelectedClip` | selectedClip (rel), selectedEntityId | Root → clip delegation + cleanup |
| `splitSelectedClip` | selectedClip (rel), cursor | Root → clip delegation + cursor |
| `startPreviewBuffer` | previewStructure, cursor | Session-level preview |
| `clearPreviewBuffer` | previewBuffer | Session-level preview |
| `syncSelectedClipRel` | selectedClip (rel) | Sync от P2P runtime |

### Таблица: adapter methods → реальная потребность

| Adapter method | Вызов в UI | UI в scope? | Clip action нуждается в root? | Что делать |
|---|---|---|---|---|
| **Session control** | | | | |
| `createProject` | Toolbar, MediaBin, ProjectDropdown | session | N/A | `dispatchRoot` (без изменений) |
| `setActiveProject` | ProjectDropdown | session | N/A | `dispatchRoot` (без изменений) |
| `selectEntity` | нет call sites | — | N/A | `dispatchRoot` |
| `setActiveInspectorTab` | нет call sites | — | N/A | `dispatchRoot` |
| `togglePlayback` | нет call sites | — | N/A | `dispatchRoot` |
| `setCursor` | VideoEditorHarnessApp (debug) | session | N/A | `dispatchRoot` |
| `tickPlayback` | нет call sites | — | N/A | `dispatchRoot` |
| `zoomTimeline` | нет call sites | — | N/A | `dispatchRoot` |
| **Root → entity delegation** | | | | |
| `deleteSelectedClip` | нет call sites | — | нет, но root чистит selectedEntityId | `dispatchRoot` (уже реализован) |
| `splitSelectedClip` | нет call sites | — | нет, но root передаёт cursor | `dispatchRoot` (уже реализован) |
| `addTextClip` | MediaBin | session | нет, но root делегирует в activeProject | `dispatchRoot` (уже реализован) |
| `importSampleResource` | нет call sites | — | N/A | `dispatchRoot` |
| **Entity scoped** | | | | |
| `renameClipById` | InspectorClipHeader | **Да, Clip scope** | нет | → `useActions()` + `dispatch('rename', {name})` |
| `colorClipById` | нет call sites | — | нет | Удалить |
| `updateClipOpacityById` | нет call sites | — | нет | Удалить |
| `updateClipFadeById` | нет call sites | — | нет | Удалить |
| `updateClipTransformById` | нет call sites | — | нет | Удалить |
| `updateClipAudioById` | нет call sites | — | нет | Удалить |
| `trimClipById` | нет call sites | — | нет | Удалить |
| `resizeClipById` | нет call sites | — | нет | Удалить |
| `addEffectToClip` | нет call sites | — | нет | Удалить |
| `addColorCorrectionToClip` | нет call sites | — | нет | Удалить |
| `deleteClipById` | нет call sites | — | нет | Удалить |
| `splitClipByIdAt` | нет call sites | — | нет | Удалить |
| `removeEffectFromClip` | нет call sites | — | нет | Удалить |
| `moveClipById` | нет call sites | — | нет | Удалить |
| `renameSelectedClip` | нет call sites | — | нет | Удалить |
| `colorSelectedClip` | нет call sites | — | нет | Удалить |
| `updateSelectedClipOpacity` | нет call sites | — | нет | Удалить |
| `updateSelectedClipFade` | нет call sites | — | нет | Удалить |
| `updateSelectedClipTransform` | нет call sites | — | нет | Удалить |
| `updateSelectedClipAudio` | нет call sites | — | нет | Удалить |
| `trimSelectedClip` | нет call sites | — | нет | Удалить |
| `addEffectToSelectedClip` | нет call sites | — | нет | Удалить |
| `addColorCorrectionToSelectedClip` | нет call sites | — | нет | Удалить |
| `removeEffectFromSelectedClip` | нет call sites | — | нет | Удалить |
| `nudgeSelectedClip` | нет call sites | — | нет | Удалить |
| `addResourceToTimeline` | MediaBin | **Да, Project scope** | нет | → `useActions()` + `dispatch('addResourceToTimeline', {resourceId})` |
| `addTrack` | нет call sites | — | нет | Удалить (если понадобится — scoped dispatch) |
| **Import/Export (saga/fx)** | | | | |
| `importFiles` | MediaBin | session | N/A | → `dispatchRoot` + `$fx_handleInputFiles` |
| `queueClipExportById` | InspectorExportTabPanel | **Да, Clip scope** | нет, но нужен fx pipeline | → scoped action + `$fx_renderExport` |
| `queueSelectedClipExport` | нет прямых call sites | — | нет, но нужна миграция в action | → `dispatchRoot('requestSelectedClipExport', { refId })` + DKT action с резолвом selected clip |
| `queueProjectExport` | Toolbar, test | session | N/A | → `dispatchRoot('requestProjectExport', { refId })` + `$fx_renderExport` |

### Вывод

Из 43 adapter methods:
- **8** остаются как `dispatchRoot` (session control, root-level orchestration)
- **2** переходят на scoped `useActions()` (`renameClipById` → `dispatch('rename')`, `addResourceToTimeline` → `dispatch('addResourceToTimeline')`)
- **27** удаляются без замены (нет call sites, все данные локальны)
- **4** переписываются в DKT saga/fx pipeline (`importFiles`, `queueClipExportById`, `queueSelectedClipExport`, `queueProjectExport`)
- **2** остаются как `dispatchRoot` для существующих root-level clip delegation (`deleteSelectedClip`, `splitSelectedClip`)

## Нормативное правило: scoped dispatch first

Это правило обязательно для нового кода.

### Приоритет dispatch

1. **Scoped `useActions()`** — дефолт для entity actions, если компонент в нужном scope.
2. **`dispatchRoot`** — только когда action реально нуждается в SessionRoot-данных (cursor, isPlaying, selectedEntityId, activeProject rel) или это session-level concern.
3. **`dispatchRoot` + `$fx_*`** — для async/IO pipelines (import, export).

### Запрещено

1. Добавлять wrapper-методы `actions.*ById(...)` в adapter с graph traversal.
2. Использовать кастомный `clipId`/`sourceClipId` для адресации между слоями — только DKT `_node_id`.
3. Делать `pageRuntime.readOne/readMany/readAttrs` в adapter ради target resolution.
4. Делать неявный fallback на selected entity при lookup failure.
5. Добавлять helper-ы `findClipScopeById`/`dispatchClipActionById`/аналогичные вне DKT action layer.

### Разрешено

1. Scoped `useActions()` для model actions, если компонент в нужном scope.
2. Root dispatch (`dispatchRoot`) для session-level команд и root → entity delegation.
3. Async/IO через DKT command → `$fx_*` → executor.
4. Доступ к model references через comp rels с zip (`<< @one:primaryVideoTrack` даёт runtime model reference, `<< @all:effects` даёт список references).

### Принцип

- adapter не знает graph topology;
- traversal и address resolution принадлежат DKT actions;
- UI boundary формирует payload, но не ищет target;
- каждая модель имеет upward rels (Clip→track, Clip→project, Effect→clip, Track→project) — если нужны данные от parent, они доступны через deps.

### Примечание: model references через deps

`<< @one:<rel>` и `<< @all:<rel>` в deps возвращают **runtime model references**, а не scalar values.

Это значит:
- `<< @one:primaryVideoTrack` в deps даёт model reference Track
- `<< @all:effects` в deps даёт массив model references Effect
- `<< @one:activeProject` в deps даёт model reference Project

Эти references можно использовать:
- как base для дальнейшего чтения attrs (`< @one:title < activeProject`)
- как dispatch target (`to: ['<< primaryVideoTrack', { action: 'addClip', inline_subwalker: true }]`)
- для передачи через `$output`/`$input` между steps

См. `docs/dkt-addressing-and-spec-addr-ru.md`, раздел "Nesting-only traversal" и "Zip names".

### Примечание: `inline_subwalker` vs `sub_flow` — два направления delegation

DKT поддерживает два паттерна delegation через rels:

**Downward: `inline_subwalker`** — parent делегирует action child-модели через named rel.

```ts
// SessionRoot → activeProject
to: ['<< activeProject', { action: 'handleInit', inline_subwalker: true }]

// Project → primaryVideoTrack
to: ['<< primaryVideoTrack', { action: 'addClip', inline_subwalker: true }]
```

**Upward: `sub_flow`** — child делегирует action parent-модели.

```ts
// Clip → track (upward delegation)
to: ['<< track', { action: 'removeClipBySourceId', sub_flow: true }]
to: ['<< track', { action: 'splitClipAt', sub_flow: true }]
```

Оба паттерна уже используются в minicut (12 `inline_subwalker`, 2 `sub_flow`). При добавлении новых root-level действий, которые делегируют от root через project в clip и затем clip в track, может потребоваться комбинированный паттерн: root action → `inline_subwalker` в clip → clip action → `sub_flow` в track.

## Архитектурный контракт: разделение ответственности state vs DI

Эта миграция вводит четкую границу между доменным слоем и runtime интеграцией.

### DKT state слой

**Ответственность**:
- Определить доменную модель и её правила (что изменяется, когда и почему).
- Хранить только данные, нужные для воспроизводимой вычисляемой модели.
- Target resolution и graph traversal для адресации.
- Синхронизация между состоянием разных клиентов.

**Исключено из state**:
- File, Blob, stream объекты напрямую.
- Callbacks и функции (функциональность — через `$fx_*` targets).
- Сессионные ссылки на runtime объекты (кроме stateless refId).

### DI и runtime интерфейсы

**Назначение**: работа с side effects, эфемерными runtime объектами и ссылками на них.

**Ответственность**:
- Выполнение IO операций (media probe, file transfer, rendering).
- Управление жизненным циклом runtime объектов (File, Blob, WebCodec, worker connection).
- Трансляция доменных команд (`$fx_*` targets) в конкретные технические действия.
- Управление async workflows и их progress/error reporting.
- Хранение и публикация эфемерных результатов (blob urls, transfer state).

**Модель коммуникации**:
- Control plane: DKT actions и fx-payload (serializable).
- Data plane: параллельный механизм между render и worker через DI, оперирующий runtime объектами по refId.
- refId lifecycle: register (render side) → consume (worker executor) → release (оба стороны).

### Ключевой принцип: resolution → execution → publication

1. **Resolution** (в action chain или comp deps): определить, ЧТО нужно сделать и ГДЕ.
2. **Execution** (в fx executor или DI): выполнить ИЗ-ЧЕМ и КАК технически.
3. **Publication** (в state или DI callback): поместить результат туда, откуда его смогут прочитать.

Resolution никогда не возникает в executor/bridge; это дело action chain. Executor получает уже готовый план и выполняет по нему.

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
- вызывает `dispatchRoot` для session-level команд
- не читает graph state
- не travers-ит rel
- не делает wait loops

2. React render = scoped dispatch:
- компоненты в entity scope используют `useActions()` напрямую
- `dispatch('rename', {name})` вместо `actions.renameClipById(id, name)`
- `dispatch('addResourceToTimeline', {resourceId})` вместо `actions.addResourceToTimeline(resourceId)`
- export из scope: `dispatch('requestClipExport', ...)` или `dispatchRoot('requestProjectExport')`

3. Domain behavior = DKT actions:
- session-level actions на SessionRoot (createProject, setCursor, splitSelectedClip, deleteSelectedClip)
- все entity actions уже существуют на соответствующих моделях
- multi-step orchestration (`$output` между шагами) только для import/export
- `$noop` для раннего выхода

4. Side effects = runtime task layer:
- через `$fx_...` target (если нужен IO/async)
- task payload serializable, runtimeRef через `tasks.dispatchTask`
- execution в отдельном executor (не в adapter)

## Разделение работы: React render vs DKT

### Что меняется в React render

| Компонент | Сейчас | Станет | Тип работы |
|---|---|---|---|
| `InspectorClipHeader.tsx` | `actions.renameClipById(sourceClipId, value)` | `useActions()` + `dispatch('rename', { name: value })` | React: добавить import useActions, заменить вызов |
| `InspectorExportTabPanel.tsx` | `actions.queueClipExportById(clipId, onProgress)` | `useActions()` + `dispatch('requestClipExport')`, читать progress через `useAttrs(['exportProgress'])` (после Phase 3) | React: заменить; DKT: добавить clip export action с exportProgress field |
| `MediaBin.tsx` (addResourceToTimeline) | `actions.addResourceToTimeline(sourceResourceId)` | `useActions()` + `dispatch('addResourceToTimeline', { sourceResourceId })` | React: заменить; adapter method удалить |
| `MediaBin.tsx` (importFiles) | `actions.importFiles(files)` | `dispatchRoot('importFilesRequested', { files })` (после Phase 2) | React: заменить; DKT: добавить root action |
| `MediaBin.tsx` (addTextClip) | `actions.addTextClip()` | `dispatchRoot('addTextClipToTimeline', payload)` — без изменений | Без изменений |
| `Toolbar.tsx` (queueProjectExport) | `actions.queueProjectExport(onProgress)` | `dispatchRoot('requestProjectExport')`, читать progress через `useAttrs(['exportProgress'])` на SessionRoot (после Phase 3) | React: заменить; DKT: добавить root action с exportProgress field |
| N/A (опционально в UI) | (нет текущего call site) | `dispatch('requestSelectedClipExport')` или `dispatchRoot('requestSelectedClipExport')` (после Phase 3, в зависимости от scope), читать progress из attrs | React: опционально через scoped dispatch или root; DKT: добавить action с резолвом selected clip и exportProgress field |
| Inspector panels (Edit/Audio/Color) | уже используют `useActions()` | без изменений | Уже корректно |

### Что меняется в DKT

| Что | Файл | Тип работы |
|---|---|---|
| Удалить dead code (3 функции) | `editorHarnessAdapter.ts` | Adapter cleanup |
| Удалить 26 unused methods | `editorHarnessAdapter.ts` | Adapter cleanup |
| Удалить `findClipScopeById`, `dispatchClipActionById` | `editorHarnessAdapter.ts` | Adapter cleanup |
| Удалить `buildFallbackExportPlan` | `editorHarnessAdapter.ts` | Adapter cleanup |
| Удалить `createDktActionRuntime.ts` | новый | Удалить файл |
| Добавить `requestProjectExport` action | `SessionRoot/actions.ts` | DKT: new root action |
| Добавить `requestClipExport` action на Clip или root | `Clip.ts` или `SessionRoot/actions.ts` | DKT: new action |
| Добавить `requestSelectedClipExport` action | `SessionRoot/actions.ts` | DKT: new root action, делегирует через selected clip rel |
| Добавить `importFilesRequested` action | `Project.ts` или `SessionRoot/actions.ts` | DKT: new root action |
| Удалить `Project.exportPlan` comp | `Project.ts` | DKT: удалить eager comp |
| Вынести polling в testing helpers | `createVideoEditorHarness.ts` | Infrastructure |
| Удалить production import `.testing.ts` | `VideoEditorHarnessApp.tsx` | Infrastructure |

### Что НЕ нужно менять в DKT

- Все 23 Clip actions — остаются как есть, не нуждаются в root данных
- Все 8 Effect actions — остаются как есть
- Все 9 Track actions — остаются как есть
- Все 6 Resource actions — остаются как есть
- Все 4 Text actions — остаются как есть
- SessionRoot actions `deleteSelectedClip`, `splitSelectedClip` — уже реализованы корректно

## Phase gates: hard cutover без fallback

Эта миграция применяет принцип: **лучше явная поломка на фазе, чем даже маленький fallback на старую логику**.

### Контрольные ворота каждой фазы

Каждая фаза обязана пройти все три проверки перед мержем:

1. **compile-green**: `npm run tsc --noEmit` — нет type errors, полностью типизировано.
2. **smoke-green**: `npm run repl:run` (jsdom smoke), `npm run repl:playwright` (browser smoke) — базовые сценарии работают.
3. **no fallback**: grep-проверка на запрещенные паттерны:
   - Нет `readOne/readMany/readAttrs` в adapter (кроме локальных utility props).
   - Нет `setTimeout` polling loops в production adapter.
   - Нет дуального пути (new action путь И старый adapter путь одновременно).

### Жесткий cutover

- Если новая ветка Phase N не готова → не мержим Phase N.
- Если что-то ломается на Phase N → чиним в DKT/fx, не возвращаем старый путь.
- Если нужен fallback → это признак неправильного разделения Phase; перепроектируем.

Исключение: явные test helpers в файлах с маркировкой `*.testing.ts` (Phase 4).

## Конкретный план миграции

### Phase 0. Consolidate duplication + remove dead code

1. **Verify and delete `createDktActionRuntime.ts`** — полный дубликат `editorHarnessAdapter.ts`:
   - Файл содержит идентичное повторение всех методов адаптера (43 методов VideoEditorHarnessActions)
   - Все helpers одинаковые: queueExport, buildFallbackExportPlan, importFilesDirectly, etc.
   - Нигде не импортирован (grep: 0 ссылок, кроме определения в самом файле)
   - `editorHarnessAdapter.ts` — **единственный authoritative implementation**, который ИСПОЛЬЗУЕТСЯ
   - Перед удалением: `rg "createDktActionRuntime" src/ --type ts --type tsx` → 0 ссылок ✅
   - Затем: `rm src/video-editor/app/createDktActionRuntime.ts`
   - После удаления: `npm run tsc --noEmit` → должно пройти без ошибок

2. **Удалить dead code из `editorHarnessAdapter.ts`**: 
   - `getTrackScopeByKind` (строка ~160) — не используется ни где
   - `getResourceAttrsById` (строка ~177) — не используется
   - `dispatchTrackClip` (строка ~311) — не используется

**Примечание**: После Phase 0 код полностью консолидирован в `editorHarnessAdapter.ts`, нет дубликатов.

Подсказки для дебага проблем на шаге:

- Проверка типов/ссылок: `npm run test:video-editor:node` + `rg` по удаленным символам.
- Если после удаления runtime не стартует: `npm run repl:run` и смотреть `snapshot/messages`.
- Если проблема только в browser entrypoint: `window.__MINICUT_P2P_DEBUG__.getSnapshot()` и `getRuntimeMessages()`.

### Phase 1. Удалить unused adapter methods + перевести UI на scoped dispatch

1. Удалить из adapter 27 методов без call sites:
- все `*ById` методы (14 штук): `renameClipById`, `colorClipById`, `updateClipOpacityById`, `updateClipFadeById`, `updateClipTransformById`, `updateClipAudioById`, `trimClipById`, `resizeClipById`, `addEffectToClip`, `addColorCorrectionToClip`, `deleteClipById`, `splitClipByIdAt`, `removeEffectFromClip`, `moveClipById`
- все `*Selected` методы (12 штук): `renameSelectedClip`, `colorSelectedClip`, `updateSelectedClipOpacity`, `updateSelectedClipFade`, `updateSelectedClipTransform`, `updateSelectedClipAudio`, `trimSelectedClip`, `addEffectToSelectedClip`, `addColorCorrectionToSelectedClip`, `removeEffectFromSelectedClip`, `nudgeSelectedClip`, `addTrack`
2. Удалить helper-ы, ставшие unused: `findClipScopeById`, `dispatchClipActionById`, `dispatchSelectedClipAction`, `getSelectedClipScope`, `dispatchProject`, `getActiveProjectScope`.
3. Перевести React-компоненты на scoped dispatch:
- `InspectorClipHeader.tsx`: `useActions()` + `dispatch('rename', { name })`
- `MediaBin.tsx`: `useActions()` + `dispatch('addResourceToTimeline', { sourceResourceId })`
4. Удалить helper-ы для fallback export: `buildFallbackExportPlan`, `toResolvedScalar`, `asFiniteNumber`.

Подсказки для дебага проблем на шаге:

- scoped dispatch не доходит до модели: `npm run repl:run` + `harness.inspect.messages()`.
- изменение не отражается в графе: `harness.inspect.graph()` и `harness.inspect.diff(before, after)`.
- проблема в конкретном клипе/треке: `harness.inspect.activeProject()` (включает clips/effects/text).
- UI в browser не совпадает с jsdom: `npm run repl:playwright:runtime` + `activeProject/selection/messages`.

Результат: adapter сокращается с ~775 до ~200 строк, содержит только session control dispatch + import/export placeholders.

### Phase 2. Import pipeline: DKT action + `$fx_*`

1. Удалить из adapter: `importFilesDirectly`, `isTimelineEmpty`.
2. Ввести root action `importFilesRequested`:
- формирует task payload из files
- пишет в `$fx_handleInputFiles` с `intent: 'call'`
3. Runtime task executor:
- consume runtime refs
- media probe duration
- dispatch model actions (`importResource`, `addEmbeddedAudioToTimeline`)
- registerLocalResource
4. 300ms delay убрать; заменить readiness condition/event-driven attachment (или retry policy в task executor).
5. `MediaBin.tsx`: заменить `actions.importFiles(files)` на `dispatchRoot('importFilesRequested', { files })`.

Подсказки для дебага проблем на шаге:

- проверить state diff до/после import: helper `test/repl/debugGraphDiff.testing.ts` через `harness.inspect.diff(before, after)`.
- проверить эффекты/текст на клипах после import: helper `test/repl/stateInspect.testing.ts` через `harness.inspect.activeProject()`.
- проверить синхрон page vs worker: helper `test/repl/playwright-runtime-inspect.testing.mjs` (`workerState`, `divergence`).
- если импорт dispatch прошел, но модель не изменилась: анализировать `harness.inspect.messages()` и `debug.dumpRuntimeTasks()` в browser REPL.

### Phase 3. Export pipeline: state-driven + DI message passing (без promise/callback)

**Архитектура: Per-peer marker + DI registry**
- UI dispatch → DKT action (deps build export plan) → $fx_renderExport (executor)
- Executor: render + dispatch progress → state-based update c `initiatedBy` + DI registry для blob
- State (синхронизируется): stage, progress, metadata (fileName, size), `initiatedBy` (peer ID)
- DI registry (локальный): blob URLs кешируются в `env.export.cachedResults`, не синхронизируются
- Component: читает state, проверяет `initiatedBy === myPeerId`, если да — берёт URL из DI, auto-download
- На других peers: state видна, но `downloadUrl` не существует локально → UI показывает "Export done"

**1. Модель: ExportProgress state field (✅ fully serializable)**

На Clip и SessionRoot добавить attr:
```ts
interface ExportProgress {
  stage: 'idle' | 'queued' | 'rendering' | 'done' | 'error'
  progress: number  // 0-100
  message?: string  // error message, только при error
  initiatedBy?: string  // peer ID кто запустил export (для multi-peer scenario)
  metadata?: {
    fileName: string       // для UI display и download
    frameCount: number     // metadata for UI
    size: number          // metadata for UI
  }
  // ✅ blob URL НЕ хранится в state (живет в DI registry env.export.cachedResults)
}
```

**2. DI Registry (в EditorActionEnvironment)**

Executor хранит blob URLs локально:
```ts
// В env или environment setup
env.export = {
  cachedResults: new Map<string, { downloadUrl: string; blob: Blob; timestamp: number }>(),
  
  // Cleanup на timeout (5 минут)
  scheduleCleanup(clipId: string) {
    setTimeout(() => {
      const cached = this.cachedResults.get(clipId)
      if (cached && Date.now() - cached.timestamp > 5 * 60 * 1000) {
        this.cachedResults.delete(clipId)
        env.lifecycle.revokeObjectUrl(cached.downloadUrl)
      }
    }, 5 * 60 * 1000)
  }
}
```

**3. DKT Actions на SessionRoot/Clip:**

```ts
{
  type: 'requestProjectExport',
  deps: '< @all:clipRenderData < activeProject.tracks.clips | sourceProjectId | fps | width | height | duration',
  steps: [
    {
      target: 'this',
      action: 'setExportProgress',
      input: { stage: 'queued', progress: 0, initiatedBy: $currentPeerId }
    },
    {
      target: '$fx_renderExport',
      input: { exportPlan: '$output.clipSources', fps: '$output.fps', range: 'project', ... }
    }
  ]
}

{
  type: 'requestClipExport',  // scoped на Clip
  deps: 'clipRenderData | sourceClipId',
  steps: [
    {
      target: 'this', // на Clip
      action: 'setExportProgress',
      input: { stage: 'queued', progress: 0, initiatedBy: $currentPeerId }
    },
    {
      target: '$fx_renderExport',
      input: { exportPlan: '...', range: { type: 'clip', clipId: '$output.sourceClipId' } }
    }
  ]
}

{
  type: 'setExportProgress',
  input: { stage, progress?, message?, initiatedBy?, metadata? },
  impl: (ctx, input) => {
    ctx.attrs.exportProgress = input  // ✅ fully serializable
  }
}
```

**4. Runtime task executor ($fx_renderExport):**

```ts
{
  async *execute(message) {
    const { exportPlan, range } = message.input
    const clipIdForCache = range.type === 'clip' ? range.clipId : 'project'
    
    // Step 1: initial state (queued)
    yield { 
      type: 'dispatch', 
      action: 'setExportProgress', 
      payload: { stage: 'queued', progress: 0 }
    }
    
    try {
      // Step 2: render with progress callback
      // ✅ Callback НЕ yield, dispatch напрямую (callback = regular function, not generator)
      const result = await env.export.render({ plan: exportPlan, range }, (event) => {
        // Sync callback: dispatch progress updates в реал-тайме
        env.dkt?.dispatch('setExportProgress', 
          { stage: 'rendering', progress: event.progress },
          message.scope  // На том же scope где executor запущен
        )
      })
      
      // Step 3: create blob URL and cache it (DI-only)
      const downloadUrl = env.media.createObjectUrl(result.blob)
      env.lifecycle.registerObjectUrl(downloadUrl, 'export')
      env.export.cachedResults.set(clipIdForCache, {
        downloadUrl,
        blob: result.blob,
        timestamp: Date.now()
      })
      env.export.scheduleCleanup(clipIdForCache)
      
      // Step 4: dispatch completion с METADATA only (no downloadUrl!)
      // ✅ Это yield, потому что выполняется после render
      yield {
        type: 'dispatch',
        action: 'setExportProgress',
        payload: {
          stage: 'done',
          progress: 100,
          metadata: {
            fileName: result.fileName,
            frameCount: result.frameCount,
            size: result.size
          }
          // ✅ downloadUrl ОСТАНЕТСЯ в closure/DI
        }
      }
    } catch (error) {
      // ✅ Error dispatch через yield (sequential)
      yield {
        type: 'dispatch',
        action: 'setExportProgress',
        payload: {
          stage: 'error',
          progress: 0,
          message: error.message
        }
      }
    }
  }
}
```

**Ключевое уточнение: Callback vs Executor**
- **Callback (sync)**: `(event) => env.dkt?.dispatch(...)` — выполняется синхронно во время render, НЕ может yield
- **Executor (async generator)**: `async *execute(message)` — может yield для batch dispatch операций
- **Progress обновления**: идут в реал-тайме из callback (durante render)
- **Completion**: идёт через yield (после render)

**5. UI Components: State + DI registry**

`InspectorExportTabPanel.tsx`:
```tsx
const [exportProgress] = useAttrs(['exportProgress'])
const { getRuntimeContext } = useRuntimeContext()  // DI access
const env = getRuntimeContext().env

const handleExport = () => {
  dispatch('requestClipExport')  // scoped on Clip
}

useEffect(() => {
  if (exportProgress?.stage === 'done' && exportProgress.metadata) {
    // ✅ Per-peer check: только если ТЫ запустил export
    const myPeerId = env.transfers.getPeerId()
    if (exportProgress.initiatedBy === myPeerId) {
      const cached = env.export.cachedResults.get(clipId)
      if (cached?.downloadUrl) {
        // Auto-download только для инициатора
        const link = document.createElement('a')
        link.href = cached.downloadUrl
        link.download = exportProgress.metadata.fileName
        link.click()
      }
    }
  }
}, [exportProgress?.stage, exportProgress?.initiatedBy, clipId])

return (
  <div>
    <button onClick={handleExport}>Export Clip</button>
    {exportProgress?.stage === 'rendering' && (
      <ProgressBar value={exportProgress.progress} />
    )}
    {exportProgress?.stage === 'done' && (
      <div className="success">
        Export done: {exportProgress.metadata?.fileName} ({exportProgress.metadata?.size}b)
      </div>
    )}
    {exportProgress?.stage === 'error' && (
      <div className="error">{exportProgress.message}</div>
    )}
  </div>
)
```

`Toolbar.tsx` (same pattern):
```tsx
const [exportProgress] = useAttrs(['exportProgress'])  // on SessionRoot
const env = getRuntimeContext().env

useEffect(() => {
  if (exportProgress?.stage === 'done' && exportProgress.initiatedBy === env.transfers.getPeerId()) {
    const cached = env.export.cachedResults.get('project')
    if (cached?.downloadUrl) {
      const link = document.createElement('a')
      link.href = cached.downloadUrl
      link.download = exportProgress.metadata?.fileName
      link.click()
    }
  }
}, [exportProgress?.stage])
```

**6. Multi-peer behavior (для новых state-driven export actions):**

```
Peer A:  dispatch('requestProjectExport')  [новый path]
  ↓
State syncs via P2P:
  { stage: 'done', initiatedBy: 'peer-A', metadata: {...} }
  
Peer A: exportProgress.initiatedBy === myPeerId ✅
  → env.export.cachedResults.get('project') → downloadUrl EXISTS
  → auto-download ✅
  
Peer B: exportProgress.initiatedBy === myPeerId ❌ (не равны)
  → auto-download НЕ срабатывает (правильно!)
  → UI показывает: "Export done: video.webm (42.5MB)" (может скачать вручную позже)

Старый UI (старый promise-based path):
  actions.queueExport() → result.downloadUrl  [работает как раньше]
```

**7. Параллельные пути (parallel transition, НЕ замена):**

На время Phase 3:
- ✅ **Новый state-driven path**: dispatch actions + state monitoring + DI registry
- ✅ **Старый promise-based path**: `queueExport` методы остаются как fallback для старого UI
- ❌ **НЕ удаляем**: `queueExport` helper, `queueProjectExport`, `queueClipExportById`, `queueSelectedClipExport`, `downloadUrl` из `ExportRenderResult`
- ❌ **НЕ удаляем**: `buildFallbackExportPlan`, `toResolvedScalar`, `asFiniteNumber` (старый путь их использует)

**Переходная стратегия**:
1. Phase 3: Добавить новые DKT actions + state field без удаления старого кода
2. Перевести `Toolbar.tsx` → новый state-driven dispatch
3. Перевести `InspectorExportTabPanel.tsx` → новый state-driven dispatch
4. После полного перехода всего UI → отдельная фаза для удаления старых методов

**8. Что удалить в будущей фазе (когда все UI мигрировано):**
- `queueExport` helper функцию
- `buildFallbackExportPlan`
- Methods: `queueProjectExport`, `queueClipExportById`, `queueSelectedClipExport`
- Helpers: `toResolvedScalar`, `asFiniteNumber` (если не используются больше)
- **НЕ трогаем** `downloadUrl` в `ExportRenderResult` — это может остаться для совместимости

**9. Ключевые преимущества (для нового state-driven пути):**
- ✅ State **полностью serializable** (no blob URLs, no closures)
- ✅ P2P-friendly: каждый peer синхронизирует состояние экспорта
- ✅ DI registry local: blob URLs остаются в runtime, не кроссуют peer boundary
- ✅ Per-peer marker: автоматически handle multi-peer случаев
- ✅ Hard cutover compliant: новый path чистый (нет fallback), старый path удаляется в отдельной фазе

Подсказки для дебага проблем на шаге:

- проверить, что `$fx_renderExport` действительно встал в очередь: `window.__MINICUT_P2P_DEBUG__.dumpRuntimeTasks()`.
- диагностировать queue policy (`replace-last`/`keep-first`): смотреть `active/completed/failed/dropped` в dump.
- проверить расхождение export payload vs graph: `harness.inspect.activeProject()` + `harness.inspect.diff(before, after)`.
- проверить worker/page divergence перед экспортом: `npm run repl:playwright:runtime` и блок `divergence`.
- если прогресс не обновляется в UI: проверить, что `exportProgress` field правильно обновляется в model и компонент читает его через `useAttrs`.

### Phase 4. Тестовый контур и quarantine для imperative helper

1. Вынести test-only helpers в явный testing файл:
- `src/video-editor/app/testing/runtimeWaits.testing.ts` (уже существует)
2. В production коде не оставлять polling helpers.
3. Убрать production import `.testing.ts` из `VideoEditorHarnessApp.tsx` — вынести `dispatchCreateProject` debug-метод в debug-only initialization path, не импортируя testing helpers в production bundle.
4. Тесты adapter перефокусировать:
- проверка, что adapter делает корректный dispatch
- доменная логика проверяется в DKT model tests (`src/video-editor/dkt/models/...`).

Подсказки для дебага проблем на шаге:

- утечки test-helper в production bundle: искать импорты `*.testing.ts` через `rg "\.testing" src/video-editor/app`.
- если debug API пропал: проверить инициализацию `__MINICUT_P2P_DEBUG__` в browser и cleanup на unmount.

### Phase 5. Event-driven cleanup + remove polling fallbacks

**Контекст**: Phase 3 вводит `subscribeRootAttrs(['exportRequest'], callback)` для event-driven экспорта. Polling как fallback был добавлен в commit fae0e00 (`setInterval(tryStartPendingRequest, 120)`), но позже удален в commit 7b30e8b как часть рефактора. Phase 5 — это финальная очистка всех polling fallback'ов и переход на полностью event-driven модель.

**Tasks**:

1. **Export request subscription: удалить polling fallback**
   - ✅ Уже done в commit 7b30e8b: `setInterval(tryStartPendingRequest, 120)` удален.
   - ✅ Причина: `subscribeRootAttrs(['exportRequest'], callback)` теперь надежно ловит все обновления.
   - Верифицировать: `npm run test:video-editor` + `npm run repl:playwright` — экспорт срабатывает без задержек.
   - Reference: [createVideoEditorHarness.ts](createVideoEditorHarness.ts#L505-L513) `subscribeToExportRequests()`.

2. **Resource scope subscription: вынести polling в event-driven**
   - `subscribeToResourceScopes()` в `createVideoEditorHarness.ts` использует `setInterval(syncResources, 500)` для refresh resources.
   - TODO: заменить на `subscribeRootAttrs(['activeProject'], ...)` или event-driven attachment point для resources.
   - Альтернатива: если polling необходим для retry-logic, перенести в явный runtime task executor с документацией причины.
   - Верифицировать: медиа ресурсы синхронизируются без задержек, `npm run repl:playwright` не показывает "missing resource" race conditions.

3. **Debug polling: переместить в `.testing.ts` helpers**
   - `VideoEditorHarnessApp.tsx`: debug flow `dispatchCreateProject` с `await waitForProjectReady()` polling.
   - `src/video-editor/app/runtimeTaskFacade.ts`: `debugDumpTasksTesting()` уже правильно помечен как test helper.
   - TODO: создать `src/video-editor/app/testing/debugPolling.testing.ts` и перенести `waitForProjectReady`, `waitForRuntimeReady`, `waitForPeerId` туда.
   - Верифицировать: `npm run build` не включает test файлы, production bundle не содержит polling кода.

4. **Зафиксировать правило на future**:
   - Любой новый polling (`while + setTimeout`, `setInterval` refresh) в `src/video-editor/app/**` допускается **только** в файлах `*.testing.ts` с явным комментарием о причине.
   - Production adapter должен быть 100% event-driven (subscribe callbacks, никаких busy-wait loop'ов).

**Подсказки для дебага проблем на шаге**:

- Если ресурсы не синхронизируются: проверить, что `subscribeRootAttrs` срабатывает при каждом обновлении `activeProject`.
  ```
  window.__MINICUT_P2P_DEBUG__.getResourceTransfers() // показать состояние transfer-менеджера
  ```
- Если export срабатывает с задержкой после удаления polling: проверить, что `exportRequest` attr обновляется корректно.
  ```
  harness.inspect.root().exportRequest // посмотреть текущий запрос
  harness.inspect.messages() // проверить dispatch последовательность
  ```
- Пропажа ресурсов в timeline после cleanup: 
  ```
  harness.inspect.activeProject().resources // проверить что ресурсы в графе
  harness.inspect.activeProject().tracks.clips // проверить что clips видят ресурсы
  ```

## Фаза 0.5. Подготовка debug helper-инструментов

Добавленные helper-ы (только для тестирования и отладки):

- `test/repl/stateInspect.testing.ts` — summary root/project/track/clip/effects/text.
- `test/repl/debugGraphDiff.testing.ts` — state diff по двум graph snapshot.
- `test/repl/playwright-runtime-inspect.testing.mjs` — page graph + worker dump + divergence.
- `src/video-editor/app/runtimeTaskFacade.ts` (`debugDumpTasksTesting`) — dump очереди `$fx_*` задач.

Быстрый runbook:

1. jsdom: `npm run repl:run`.
2. browser runtime inspect: `npm run repl:playwright:runtime`.
3. в devtools: `window.__MINICUT_P2P_DEBUG__.dumpRuntimeTasks()`.
4. сравнение до/после dispatch: `before = inspect.graph()`, `after = inspect.graph()`, `inspect.diff(before, after)`.

## Минимальные критерии готовности

**Общие для всех фаз (фазовый gate)**:
- `npm run tsc --noEmit` → compile-green.
- `npm run repl:run` → smoke-test jsdom baseline работает.
- `npm run repl:playwright` → smoke-test browser baseline работает.
- Нет dual-path: все старые адаптер-пути удалены в том же PR, где добавлены новые DKT action-пути.

**Специфичные для миграции**:
1. В `editorHarnessAdapter.ts` нет `readOne/readMany/readAttrs`.
2. В `editorHarnessAdapter.ts` нет `setTimeout`-polling loops.
3. Нет `dispatchClipActionById`, `findClipScopeById`, `dispatchSelectedClipAction`.
4. Нет файла `createDktActionRuntime.ts`.
5. Нет unused adapter methods (`*ById`, `*Selected` без call sites).
6. В `Project` нет `exportPlan` как eager `comp`; export plan строится только в export action/saga.
7. `InspectorClipHeader.tsx` использует scoped `useActions()` вместо `actions.renameClipById`.
8. `MediaBin.tsx` использует scoped `useActions()` для `addResourceToTimeline`.
9. В `VideoEditorHarnessApp.tsx` нет production import из `.testing.ts`.
10. **Phase 3 специально**: `requestSelectedClipExport` реализован как DKT action с собственной оркестрацией (не просто wrapper, не deleted); вызывается через scoped `dispatch()` или `dispatchRoot()` в зависимости от scope компонента.

## Приоритеты (что делать первым)

```
Phase 0 → Phase 1 → Phase 2 → Phase 3 → Phase 4 → Phase 5
```

1. **Phase 0** (zero risk): удалить `createDktActionRuntime.ts` + dead code. Не трогает ничего живого.
2. **Phase 1** (самый большой эффект): удалить 27 unused adapter methods, перевести 2 React-компонента на scoped dispatch. Adapter сокращается ~5x. Не требует новых DKT actions — только удаление и замена на уже существующий `useActions()`.
3. **Phase 2** (import): убрать imperative pipeline, перевести на DKT action + `$fx_*`. Проще чем export — `$fx_handleInputFiles` уже объявлен, `runtimeTaskFacade` уже работает. Хороший полигон для отладки fx pipeline.
4. **Phase 3** (export): on-demand action/saga, удалить `exportPlan` comp. Самая сложная фаза — делается после import, когда fx pipeline уже проверен.
5. **Phase 4-5** (cleanup): testing quarantine, polling cleanup. Phase 4 можно делать параллельно с Phase 2. Phase 5 зависит от Phase 4 (testing helpers должны быть готовы).

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

### Риски по Phase 1 (удаление методов + scoped dispatch)

1. **ScopeContext edge case**: Inspector рендерит панели внутри `<ScopeContext.Provider value={resolvedClipScope}>`, с guard `if (!activeProjectId || !selectedEntityId || !resolvedClipScope)`. После миграции scoped dispatch из `useActions()` работает только внутри guard. Если guard изменить и panels рендерятся при null scope — dispatch поведёт себя непредсказуемо.
   - **Митигация**: `useActions()` внутри guard (как сейчас). При null scope panels не рендерятся — dispatch недоступен.

2. **Type breaking change**: `VideoEditorHarnessActions` type определяет все 43 метода. Удаление 27 — breaking change для типа. TypeScript поймает это при `tsc --noEmit`, но только если все consumers типизированы.
   - **Митигация**: прогонять `tsc --noEmit` после каждого шага Phase 1.

3. **`addResourceToTimeline` scope change**: MediaBin находится внутри `<ScopeContext.Provider value={projectScope ?? sessionScope}>` (VideoEditorApp.tsx:35). При переключении на scoped dispatch — scope может быть session (если projectScope null), и `dispatch('addResourceToTimeline')` уйдёт в SessionRoot, где этого action нет.
   - **Митигация**: проверить что `projectScope` всегда доступен в MediaBin при наличии active project. Если нет — оставить dispatchRoot для этого метода.

### Риски по Phase 2 (import)

4. **300ms delay для audio track**: `importFilesDirectly` делает `setTimeout(300ms)` перед `addEmbeddedAudioToTimeline` — workaround для "resource ещё не готов". При переносе в `$fx_*`/executor нужно убедиться, что executor дожидается resource ready, а не просто убирает delay.
   - **Митигация**: в task executor добавить explicit readiness check (проверка `resource.status === 'ready'` или event от resource transfer).

### Риски по Phase 3 (export)

5. **Queue policy для `$fx_renderExport`**: Быстрый двойной клик Export → два fx task → гонка.
   - **Митигация**: в `runtimeTaskFacade` добавить `queuePolicy: 'replace-last'` для `$fx_renderExport` intent.

6. **`onProgress` не serializable**: Сейчас `queueExport` принимает `onProgress` closure. В DKT `$fx_*` payload должен быть serializable. Closure не serializable.
   - **Митигация**: `onProgress` передавать через runtime ref (`putRuntimeRef`/`consumeRuntimeRef` в runtimeTaskFacade), не через payload. В fx payload — только taskId и render params.

7. **`sourceProjectId` пустой**: Удаление fallback вскроет латентные init bugs.
   - **Митигация**: до Phase 3 прогнать `npm run repl:run` и убедиться, что `sourceProjectId` установлен у всех проектов. Если нет — чинить инициализацию ДО удаления fallback.

8. **previewClipSources ↔ export deps drift**: Dep `< @all:clipRenderData < tracks.clips` используется и в `previewClipSources`, и в export action. Если кто-то изменит один и забудет другой — preview и export разъедутся.
   - **Митигация**: вынести dep string в константу. См. Phase 3 "Синхронизация deps".

### Общие риски

9. **Semantic drift export payload**: on-demand action начнёт формировать payload иначе, чем старый `clipRenderData`.
10. **Потеря текста/эффектов**: при ручной сборке плана легко забыть `text.renderAttrs` или `effects` flatten/merge.
11. **Регрессия UX progress/result**: если runtime task executor не публикует completion/error, UI зависнет в "exporting".

### Порядок фаз: почему именно такой

```
Phase 0 → Phase 1 → Phase 2 → Phase 3 → Phase 4 → Phase 5
```

Логика:
- **Phase 0** — zero-risk, immediate win. Не трогает ничего, что используется.
- **Phase 1** — самый большой эффект (adapter -5x). Можно делать сразу после Phase 0, потому что не требует новых DKT actions — только удаление и замена на уже существующий `useActions()`.
- **Phase 2 (import)** — проще чем export, потому что `$fx_handleInputFiles` уже объявлен, `runtimeTaskFacade` уже работает. Хороший полигон для отладки fx pipeline до export.
- **Phase 3 (export)** — самая сложная фаза. Делается после import, когда fx pipeline уже проверен.
- **Phase 4 (testing)** — не блокирует Phase 2-3, но важен для чистоты. Можно делать параллельно с Phase 2.
- **Phase 5 (orchestrators)** — зависит от Phase 4 (testing helpers должны быть готовы).

## Тест-план по фазам

### Перед началом (baseline)

```bash
tsc --noEmit          # Типы чистые
npm run repl:run      # DKT runtime smoke: boot, project creation, graph summary
```

### После Phase 0 (dead code deletion)

```bash
tsc --noEmit          # Убедиться, что удаление не сломало типы
npm run repl:run      # Smoke: runtime поднимается, project создаётся
```

Риск: минимальный. Удаляемый код нигде не импортирован.

### После Phase 1 (27 методов + scoped dispatch)

**Самая опасная фаза** — меняется и adapter, и React render.

```bash
tsc --noEmit                                           # Типы
npm test -- editorHarnessAdapter.test.ts               # Оставшиеся adapter методы (createProject, togglePlayback, etc.)
npm run repl:run                                       # DKT runtime: project, track, clip creation
```

Ручная проверка:
- Inspector → переименовать clip → `dispatch('rename')` работает
- MediaBin → кликнуть resource → "Add to timeline" → clip появляется
- Timeline → кликнуть clip → Inspector показывает панели (Edit/Audio/Color через scoped dispatch)
- Timeline → ClipItem context menu (если есть) → delete/split через root actions

### После Phase 2 (import)

```bash
npm run repl:run       # scenario: import file → проверить, что resource + clip создаются
npm run repl:playwright      # Browser: import file через MediaBin → clip в timeline
```

Ручная проверка:
- Import video file → clip появляется, audio track создаётся автоматически
- Import audio-only file → clip на audio track
- Import при пустом timeline → embedded audio добавляется
- Import multiple files → все создаются, нет race condition

### После Phase 3 (export)

```bash
npm run repl:run       # scenario: export project → проверить payload в $fx_renderExport
npm run repl:playwright      # Browser: Export → progress → download
```

Ручная проверка:
- Export project → blob URL создался, download работает
- Export clip из Inspector → только один clip в output
- Повторный быстрый Export → не создаёт дубликат (queue policy)
- Export при пустом `sourceProjectId` → явная ошибка, не silent fail
- Export с text clips → text включён в output
- Export с effects → effects включены в output

### После Phase 4-5 (cleanup)

```bash
tsc --noEmit
npm run repl:playwright:runtime    # Проверить debug API работает
npm run repl:playwright:css        # Если были layout-проблемы
```

### Как используем REPL, если что-то ломается

Источник инструментов и сценариев: `docs/repl-tools-usage-ru.md`.

#### Слой 1: jsdom authoritative state (быстрый smoke)

Команда:

```bash
npm run repl:run
```

Проверяем:
- что root action dispatch-ится и не уходит в `$noop`,
- что saga формирует корректный payload (`projectId`, `range`, `clipSources`, `effects/text`),
- что deps `'< @all:clipRenderData < activeProject.tracks.clips'` возвращают данные.

#### Слой 2: browser runtime sync graph

Команда:

```bash
npm run repl:playwright:runtime
```

Проверяем:
- совпадают ли active project/tracks/clips между authoritative и page runtime,
- что debug API видит тот же clip/source ids,
- что в runtime messages есть шаги action/saga.

#### Слой 3: browser smoke + screenshot

Команда:

```bash
npm run repl:playwright
```

Проверяем:
- UI триггер (export, import, rename),
- нет визуального зависания панели,
- финальный screenshot и messages после действия.

#### Слой 4: CSS/overlay (если кажется, что не нажимается кнопка)

Команда:

```bash
npm run repl:playwright:css
```

Проверяем:
- hit-testing, `pointer-events`, `z-index` у панелей/кнопок,
- что проблема не в layout, а в action/fx pipeline.

### Мини-runbook по типовым авариям

1. **Scoped dispatch не работает (после Phase 1)**:
- проверить, что компонент рендерится внутри `<ScopeContext.Provider>`,
- `repl:playwright:runtime` -> проверить, что scope models в page graph совпадают с ожидаемыми,
- проверить, что `useActions()` вызывается внутри guard (если есть).

2. **Экспорт ничего не делает (после Phase 3)**:
- `repl:run` -> убедиться, что action не уходит в `$noop`.
- `repl:playwright:runtime` -> проверить runtime messages на `requestProjectExport`.

3. **Экспорт без text/effects**:
- `repl:run` -> сравнить `clipRenderData` vs payload, который saga отправляет в fx.
- проверить deps на `'< @all:clipRenderData < activeProject.tracks.clips'`.

4. **Import не создаёт clip (после Phase 2)**:
- `repl:run` с import scenario -> проверить, что `$fx_handleInputFiles` получает payload,
- проверить, что executor вызвал `importResource` и `addEmbeddedAudioToTimeline`,
- если audio track не создаётся: проверить readiness check в executor.

5. **Повторные клики создают гонки (export)**:
- в jsdom и browser runtime проверить queue policy (`replace-last`/`keep-first`) для `'$fx_renderExport'` intent key.

6. **`sourceProjectId` пустой (после удаления fallback)**:
- `repl:run` -> проверить `sourceProjectId` у active project,
- если пустой — чинить инициализацию, не возвращать fallback.


## Связанные файлы

- `src/video-editor/app/editorHarnessAdapter.ts`
- `src/video-editor/app/createDktActionRuntime.ts`
- `src/video-editor/models/SessionRoot/actions.ts`
- `src/video-editor/models/Project.ts`
- `src/video-editor/models/Project/effects.ts`
- `src/video-editor/app/runtimeTaskFacade.ts`
- `docs/dkt-addressing-and-spec-addr-ru.md`
