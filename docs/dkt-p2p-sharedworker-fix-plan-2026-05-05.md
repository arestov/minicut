# План исправления P2P и SharedWorker по результатам ревью

Ревью показало три критических бага в текущей реализации DKT P2P и SharedWorker относительно эталона Weather.
Все три бага делают DKT sync stream нерабочим в P2P-режиме: клиент не получает `SYNC_HANDLE` сообщения,
что означает, что DKT-рендер на P2P-клиенте не работает — используется только legacy `PATCHES`.

---

## Критические отличия от Weather (итог ревью)

| Аспект | Weather | MiniCut сейчас | Требуемое состояние |
|---|---|---|---|
| Server proxy bootstrap | N/A (virtual transport) | `proxyPort.start()` без BOOTSTRAP — stream никогда не создаётся | `BOOTSTRAP` отправляется сразу после `start()` |
| P2P client SYNC_HANDLE | `onRemoteMessage → deliverToAllPages` → страница | `createTransportAuthorityClient` не обрабатывает `DKT_MSG.SYNC_HANDLE` | listener набор + `case SYNC_HANDLE` |
| subscribeDktSync через P2P | Весь DKT поток сквозной | `createP2PAuthorityAdapter` не возвращает `subscribeDktSync` | делегирование `activeClient.subscribeDktSync` с re-subscription при смене роли |
| Sync stream target | `session.sessionRoot` | `app.appModel` | `app.appModel` (допустимо для MiniCut, не требует фикса сейчас) |

---

## Фаза 1: Исправление server proxy bootstrap

| Название шага | Коммиты | Измененные файлы | Проблемы при реализации |
|---|---|---|---|
| Отправить `BOOTSTRAP` в `setupServerProxy` после `proxyPort.start()` | `f4f4003` | `src/video-editor/p2p/PageP2PManager.ts` | Нет |
| Проверить что proxy-воркер отвечает `RUNTIME_READY` и начинает слать `SYNC_HANDLE` | `f4f4003`, `9767170` | `src/video-editor/p2p/PageP2PManager.ts`, `src/video-editor/p2p/P2PAuthorityAdapter.ts` | Проверено на уровне wire-обработки и unit/runtime тестов; в интеграции P2P file transfer остаётся отдельный failure (см. Фаза 4) |

## Фаза 2: SYNC_HANDLE в транспортном клиенте P2P

| Название шага | Коммиты | Измененные файлы | Проблемы при реализации |
|---|---|---|---|
| Добавить `syncListeners` Set и обработку `case DKT_MSG.SYNC_HANDLE` в `createTransportAuthorityClient` | `9767170` | `src/video-editor/p2p/P2PAuthorityAdapter.ts` | Нет |
| Добавить `subscribeDktSync` в return-объект `createTransportAuthorityClient` | `9767170` | `src/video-editor/p2p/P2PAuthorityAdapter.ts` | Нет |

## Фаза 3: Проброс subscribeDktSync через P2PAuthorityAdapter

| Название шага | Коммиты | Измененные файлы | Проблемы при реализации |
|---|---|---|---|
| Добавить `dktSyncListeners` Set в `createP2PAuthorityAdapter` | `9767170` | `src/video-editor/p2p/P2PAuthorityAdapter.ts` | Нет |
| Переподписывать `dktSyncListeners` на `activeClient.subscribeDktSync` при каждом `activateClient` | `9767170` | `src/video-editor/p2p/P2PAuthorityAdapter.ts` | Нет |
| Вернуть `subscribeDktSync` из `createP2PAuthorityAdapter` | `9767170` | `src/video-editor/p2p/P2PAuthorityAdapter.ts` | Нет |

## Фаза 4: Валидация и коммит

| Название шага | Коммиты | Измененные файлы | Проблемы при реализации |
|---|---|---|---|
| Запустить `npm run test:video-editor` и убедиться что все тесты проходят | `9767170` (после коммитов, валидационный прогон) | | Пройдено: 56 test files, 288 tests passed |
| Запустить `npm run video-editor:build` и убедиться что DKT chunk эмитируется | | | Не запускался в этом проходе; требуется отдельный запуск для полного чеклиста |
| Убедиться что передача файлов работает в P2P (`tests/integration/p2p-media-transfer.spec.ts`, `tests/integration/p2p-media-large-chunk-transfer.spec.ts`) | | | Не пройдено: оба теста стабильно падают по timeout ожидания progress (`Expected true, Received false`) |
| Коммит `fix(video-editor): bootstrap dkt server proxy stream` | `f4f4003` | `src/video-editor/p2p/PageP2PManager.ts` | Нет |
| Коммит `fix(video-editor): relay dkt sync through p2p authority adapter` | `9767170` | `src/video-editor/p2p/P2PAuthorityAdapter.ts` | Нет |
