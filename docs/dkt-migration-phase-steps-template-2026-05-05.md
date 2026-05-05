# Заполненная таблица фаз и шагов миграции DKT

Каждая строка таблицы соответствует шагу внутри фазы. Фазы вынесены в заголовки разделов. Таблица заполнена по фактическим conventional commits ветки `dkt-render` и используется как критерий завершенности этого прохода.

## Фаза 1: Удаление истории и очистка authority

| Название шага | Коммиты | Измененные файлы | Проблемы при реализации |
|---|---|---|---|
| Удаление surface history / undo | `ceaa87e` | `src/video-editor/app/VideoEditorHarnessApp.tsx`, `src/video-editor/components/styles.css`, `src/video-editor/models/*` | Скрытые ссылки на history в UI/стиле или middleware |
| Удаление истории из доменной модели | `ceaa87e` | `src/video-editor/domain/*CommandHandlers.ts`, `src/video-editor/models/*`, `src/video-editor/dkt/*` | Остаточные команды/патчи, которые всё ещё ожидали history |
| Проверка тестов и сборки после удаления | `ceaa87e` | `tests/**/*`, `src/video-editor/**/*` | Тесты, завязанные на undo/history, требовали переписывания или удаления |

## Фаза 2: Разделение и локализация DKT actions

| Название шага | Коммиты | Измененные файлы | Проблемы при реализации |
|---|---|---|---|
| Разделение text/effect actions на конкретные наборы | `f041266` | `src/video-editor/dkt/textActions.ts`, `src/video-editor/dkt/effectActions.ts`, `src/video-editor/models/Text.ts`, `src/video-editor/models/Effect.ts` | Слишком общие action-creators и reducer-слои требовали тонкой декомпозиции |
| Создание конкретных action wrappers в UI | `f041266` | `src/video-editor/app/sessionRootActions.ts`, `src/video-editor/app/mediaImportActions.ts`, `src/video-editor/app/exportActions.ts` | UI-обёртки продолжали транслировать старые абстракции, что мешало чистоте DKT |
| Обновление связей моделей и действий | `f041266` | `src/video-editor/models/Clip.ts`, `src/video-editor/models/Project.ts`, `src/video-editor/models/Resource.ts` | Неоднозначные зависимости между моделями и action-прокси |

## Фаза 3: Переименование runtime и синхронизация

| Название шага | Коммиты | Измененные файлы | Проблемы при реализации |
|---|---|---|---|
| Переименование `createLegend*` -> `createDkt*` | `e77f062` | `src/video-editor/dkt/runtime/createMiniCutDktRuntime.ts`, `src/video-editor/render-sync/createDktEditorRenderRuntime.ts`, `src/video-editor/app/createDktActionRuntime.ts` | Разбросанные импорты и тесты с устаревшими именами |
| Обновление runtime-теста и утилит | `e77f062` | `src/video-editor/dkt/runtime/createMiniCutDktRuntime.test.ts`, `src/video-editor/render-sync/*`, `src/video-editor/worker/*` | Файлы runtime могли остаться функционально прежними, но с разными API ожиданиями |
| Проверка рабочего процесса SharedWorker / DKT transport | `e77f062` | `src/video-editor/worker/dktSharedWorker.ts`, `src/video-editor/dkt/shared/messageTypes.ts` | Сообщения в transport могли требовать уточнения после переименования runtime |

## Фаза 4: Структурные DKT proxy-модели

| Название шага | Коммиты | Измененные файлы | Проблемы при реализации |
|---|---|---|---|
| Введение AppRoot/Project/Track/Resource proxy-моделей | `d9dafd4` | `src/video-editor/models/AppRoot.ts`, `src/video-editor/models/Project.ts`, `src/video-editor/models/Track.ts`, `src/video-editor/models/Resource.ts` | Необходимость поддерживать точное дерево моделей и корректные DKT-пути |
| Обновление runtime bridge для структурных proxy | `d9dafd4` | `src/video-editor/dkt/runtime/createMiniCutDktRuntime.ts`, `src/video-editor/dkt/shared/*` | Сложность привязать новые proxy-модели к существующей синхронизации и state-потоку |
| Приведение DKT action targets к новым моделям | `d9dafd4` | `src/video-editor/dkt/clipActions.ts`, `src/video-editor/dkt/timelineActions.ts`, `src/video-editor/dkt/sessionActions.ts` | Рефакторинг action-целей без нарушения функциональности UI |

## Фаза 5: Аудит, документация и сравнение

| Название шага | Коммиты | Измененные файлы | Проблемы при реализации |
|---|---|---|---|
| Подготовка итогового аудита и ревью | `151786c` | `docs/dkt-idiomatic-migration-audit-2026-05-05.md`, `docs/dkt-idiomatic-migration-completion-2026-05-05.md` | Нельзя допустить утечку устаревших архитектурных заметок в итоговый обзор |
| Создание плана организации DKT-центральных моделей | `d253aa6` | `docs/dkt-model-centered-organization-plan-2026-05-05.md` | Необходимо точное отражение реального кода и выявленных проблем; документ вынесен в отдельный docs-commit, чтобы таблица ссылалась на реальный хеш |
| Проверка git-истории и финальное выравнивание | `ff34c51`, `331cbda`, текущий docs-commit таблицы | `docs/dkt-shared-p2p-react-completion-2026-05-05.md`, `docs/dkt-migration-phase-steps-template-2026-05-05.md`, `git status`, `git log` | Отдельные изменения могли остаться вне реестра документации; финальная таблица зафиксирована отдельным conventional commit после проверки рабочей копии |
