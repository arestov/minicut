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
| Отправить `BOOTSTRAP` в `setupServerProxy` после `proxyPort.start()` | | `src/video-editor/p2p/PageP2PManager.ts` | |
| Проверить что proxy-воркер отвечает `RUNTIME_READY` и начинает слать `SYNC_HANDLE` | | `src/video-editor/p2p/PageP2PManager.ts`, `src/video-editor/dkt/runtime/createMiniCutDktRuntime.ts` | |

## Фаза 2: SYNC_HANDLE в транспортном клиенте P2P

| Название шага | Коммиты | Измененные файлы | Проблемы при реализации |
|---|---|---|---|
| Добавить `syncListeners` Set и обработку `case DKT_MSG.SYNC_HANDLE` в `createTransportAuthorityClient` | | `src/video-editor/p2p/P2PAuthorityAdapter.ts` | |
| Добавить `subscribeDktSync` в return-объект `createTransportAuthorityClient` | | `src/video-editor/p2p/P2PAuthorityAdapter.ts` | |

## Фаза 3: Проброс subscribeDktSync через P2PAuthorityAdapter

| Название шага | Коммиты | Измененные файлы | Проблемы при реализации |
|---|---|---|---|
| Добавить `dktSyncListeners` Set в `createP2PAuthorityAdapter` | | `src/video-editor/p2p/P2PAuthorityAdapter.ts` | |
| Переподписывать `dktSyncListeners` на `activeClient.subscribeDktSync` при каждом `activateClient` | | `src/video-editor/p2p/P2PAuthorityAdapter.ts` | |
| Вернуть `subscribeDktSync` из `createP2PAuthorityAdapter` | | `src/video-editor/p2p/P2PAuthorityAdapter.ts` | |

## Фаза 4: Валидация и коммит

| Название шага | Коммиты | Измененные файлы | Проблемы при реализации |
|---|---|---|---|
| Запустить `npm run test:video-editor` и убедиться что все 273 теста проходят | | | |
| Запустить `npm run video-editor:build` и убедиться что DKT chunk эмитируется | | | |
| Коммит `fix(video-editor): send bootstrap to p2p server proxy` | | `src/video-editor/p2p/PageP2PManager.ts` | |
| Коммит `fix(video-editor): relay dkt sync handle through p2p transport client` | | `src/video-editor/p2p/P2PAuthorityAdapter.ts` | |
