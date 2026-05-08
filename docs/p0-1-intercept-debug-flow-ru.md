# План отладки P0-1: pointer intercept, один render bug блокирует 4 теста

## Проблема

Есть общий баг класса:

- `pointer events intercept`
- один и тот же дефект layout/render/state synchronization блокирует несколько integration tests
- каждый test сгорает по 2 минуты таймаута, поэтому прямой brute-force через полный Playwright cycle слишком дорогой

Нужен пошаговый бинарный поиск по data flow.

## Цель плана

Снизить стоимость поиска дефекта за счет последовательного narrowing:

1. pure DKT state
2. page sync state
3. DOM projection
4. geometry / stacking / pointer hit-testing

Нельзя сразу начинать с Playwright screenshots.
Сначала надо понять, на каком слое возникает divergence.

## Что у нас теперь есть из инструментов

### 1. jsdom REPL

- `test/repl/run.mjs`
- `test/repl/bootstrap.tsx`
- `test/repl/stateInspect.ts`

Дает быстрый in-memory runtime без браузерной стоимости.

### 2. Browser runtime inspect

- `test/repl/playwright-run.mjs`
- `test/repl/playwright-runtime-inspect.mjs`

Дают state/runtime picture уже на page side.

### 3. CSS inspect

- `test/repl/playwright-css-inspect.mjs`

Дает computed style и stacking clues.

### 4. App debug API

В `window.__MINICUT_P2P_DEBUG__` теперь есть:

- snapshot
- graph summary
- active project details
- tracks/clips/resources
- selection state
- dispatchRootAction / dispatchProjectAction

## Полный flow данных для бага

Ниже цепочка от пользовательского клика до pointer intercept.

```text
UI click: "Add to timeline"
-> MediaBin / UI handler
-> harness.actions.addResourceToTimeline(resourceId)
-> adapter dispatch на project/root scope
-> DKT action Project.addResourceToTimeline
-> deps reads: resource + track/clip state
-> append start calculation
-> redirect/sub_flow в Track.addClip
-> normalizeClipCreationAttrs
-> authoritative DKT graph mutation
-> sync update transport
-> pageRuntime / ReactSyncReceiver receives update
-> React components read synced attrs/rels
-> timeline clip geometry is derived
-> DOM styles/position/z-index are applied
-> browser hit-testing chooses top-most clickable element
-> existing clip stops receiving pointer events
```

Бинарный поиск должен отвечать на вопрос:

На каком из этих переходов впервые появляется неправильное состояние?

## Ключевая гипотеза класса багов

Для `pointer intercept` почти всегда есть только три корневых семейства причин:

1. authoritative state неправильный
   клип создался с неверным `start`, `duration`, `track`, `sourceClipId`

2. page-side synced state неправильный
   worker state уже верный, но на page пришло не то или не пришло вовсе

3. render/layout неправильный
   state правильный, но clip geometry / stacking в DOM неверны

Отсюда и вся стратегия.

## Этап 1. Pure state, без браузера

### Задача

Проверить authoritative DKT state без всякого DOM/layout шума.

### Инструмент

`npm run repl:run`

### Что делать

1. Написать маленький scenario module для jsdom REPL.
2. В сценарии воспроизвести только state transitions:
   - createProject
   - importResource
   - addResourceToTimeline
   - addEmbeddedAudioToTimeline
3. После каждого шага делать `await harness.flush(...)`.
4. Печатать `harness.inspect.activeProject()`.

### Что нужно увидеть

Для каждого track:

- список clip
- `sourceClipId`
- `sourceResourceId`
- `mediaKind`
- `start`
- `duration`

### Бинарное правило

Если уже здесь `start=0` там, где должен быть append, проблема полностью внутри authoritative flow:

- adapter payload
- Project action deps
- Track.addClip payload
- normalizeClipCreationAttrs

Если здесь state правильный, дальше в Playwright бессмысленно чинить action layer.

## Этап 2. Сужение внутри authoritative flow

Если pure state уже неправильный, делаем локальный binary split.

### Split A: вход в action

Проверить минимальный payload на входе:

- что adapter dispatch-ит только `sourceResourceId`
- что target scope правильный

Никакого внешнего traversal в adapter здесь быть не должно.

### Split B: deps внутри `Project.addResourceToTimeline`

Временные логи или REPL-specific debug patch нужны только на следующих точках:

1. какие deps values вошли в `fn`
2. какой resource нашли
3. какой track выбран
4. какой append start рассчитан
5. какой payload ушел в `Track.addClip`

### Split C: внутри `Track.addClip`

Проверить:

- дошел ли `start` до `normalizeClipCreationAttrs`
- не заменился ли там на `0`
- не теряется ли `sourceClipId`

### Что считать победой этапа

Authoritative graph после mutation должен уже содержать правильный `start`.

## Этап 3. Page sync state

### Задача

Понять, совпадает ли authoritative graph с pageRuntime graph.

### Инструмент

- `npm run repl:playwright`
- `npm run repl:playwright:runtime`

### Что сравнивать

Сравнение делать не по screenshot, а по structured dump:

1. active project attrs
2. tracks
3. clips
4. `start`, `duration`, `sourceClipId`

### Бинарное правило

Если authoritative state верный, а pageRuntime уже неверный:

- проблема в sync transport
- shape mounting
- ReactSyncReceiver update handling
- root/track/clip shape coverage

Если pageRuntime тоже верный, проблема уже ниже.

## Этап 4. DOM projection

### Задача

Проверить, как верный page state превращается в DOM nodes и geometry.

### Инструмент

- `npm run repl:playwright`
- `npm run repl:playwright:css`
- targeted Playwright assertions

### Что проверять

Для проблемных clip-button/clip-node:

- left
- width
- transform
- z-index
- pointer-events
- parent overflow
- stacking context ancestors

### Минимальный диагностический набор

1. clip A и clip B в timeline
2. их computed style
3. их bounding box
4. DOM order
5. кто сверху в hit-test

### Практический test

В Playwright выполнить `document.elementFromPoint(x, y)` по точке, где ожидается старый clip.

Если elementFromPoint возвращает новый overlapped clip, а state при этом верный, баг уже чисто render/layout.

## Этап 5. Pointer-hit testing

Когда state и DOM geometry уже собраны, делаем финальный split:

### Сценарий A

State неправильный.

Тогда pointer intercept — просто downstream symptom.
Чинить нужно append/start/track selection в action layer.

### Сценарий B

State правильный, DOM geometry неправильная.

Чинить нужно:

- timeline pixel projection
- left/width calculations
- absolute positioning
- clipping/stacking

### Сценарий C

State и geometry правильные, но hit-testing неправильный.

Чинить нужно:

- z-index
- stacking context
- overlay layer
- transparent overlays
- pointer-events on wrappers

## Как делать бинарный поиск на практике

### Правило 1

Не включать сразу весь flow.
На каждом шаге проверять только один boundary.

### Правило 2

Если баг виден в Playwright, но не виден в jsdom runtime dump, не возвращаться к action logic без новых фактов.

### Правило 3

Логи ставить только на boundaries:

- вход в action
- выход из action
- вход в sub_flow target action
- authoritative graph after mutation
- page graph after sync
- DOM style/hit-test

Не надо размазывать `console.log` по всему коду.

## Рекомендуемый flow расследования для текущего P0-1

### Фаза A. jsdom / pure state

Сделать сценарий:

1. создать проект
2. импортировать video resource
3. проверить V1/A1 после auto-add
4. импортировать image и wav resources
5. вызвать `addResourceToTimeline(image)`
6. вызвать `addResourceToTimeline(wav)`
7. снять structured summary after each step

Цель:

- доказать, где впервые появляется `start=0`

### Фаза B. Browser runtime

Если pure state уже верный:

1. поднять dev server
2. запустить `repl:playwright:runtime`
3. сравнить active project dump с jsdom dump

Цель:

- доказать, теряется ли `start` при sync/mounting

### Фаза C. CSS / hit-test

Если runtime dumps совпадают и правильные:

1. запустить `repl:playwright:css`
2. добавить локальный Playwright snippet с `elementFromPoint`
3. сравнить bounding boxes клипов

Цель:

- доказать, что pointer intercept вызван именно stacking/layout bug, а не неверным state

## Как новые изменения помогают

### 1. Unified DI-noop в `Project.ts`

Это убирает двусмысленность между строковым sentinel и настоящим noop token.
Теперь при расследовании action flow меньше ложных интерпретаций.

### 2. jsdom REPL

Позволяет быстро крутить action sequence и смотреть authoritative state без 2-минутных Playwright timeouts.

### 3. Browser debug endpoints

Позволяют читать structured runtime state прямо из браузера, а не угадывать по UI.

### 4. CSS inspect script

Позволяет быстро понять, действительно ли это `z-index/pointer-events` баг, а не просто downstream symptom неверного `start`.

## Чего нельзя делать

### 1. Сразу дебажить через полный export test

Слишком дорогой feedback loop.

### 2. Смешивать state bug и render bug в одной сессии логов

Сначала доказать слой расхождения, потом чинить именно его.

### 3. Выносить бизнес-traversal наружу в adapter ради удобства диагностики

Диагностировать можно снаружи.
Чинить authoritative logic надо внутри DKT action.

## Критерий завершения расследования

Расследование завершено, когда есть точное доказательство одной из формулировок:

1. authoritative graph уже создает clip с неверным `start`
2. authoritative graph корректен, но page sync graph теряет/искажает данные
3. оба graph корректны, но DOM geometry или hit-testing неправильны

Пока эта формулировка не получена, любая правка будет гаданием.