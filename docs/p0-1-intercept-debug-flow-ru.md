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

Но этого недостаточно само по себе. Для текущей задачи нужно одновременно удерживать еще и архитектурный контракт из handover:

1. adapter должен делать thin dispatch с минимальным payload
2. traversal по state и вычисление append position должны жить внутри DKT action
3. текущий adapter-side append experiment не должен становиться направлением фикса, даже если его удастся локально дожать

Иначе можно быстро локализовать симптом, но все равно прийти к неправильному исправлению.

## Что именно входит в задачу целиком

Нужно расследовать не только `pointer intercept` как UI-симптом, но весь связанный causal chain:

1. почему новые клипы оказываются на `start=0`
2. почему это приводит к overlap
3. почему overlap приводит к pointer interception
4. где именно должен жить root fix

Для текущего P0-1 это означает, что debug flow обязан проверять сразу две плоскости:

### Плоскость A. Функциональная

- image и wav действительно добавляются в timeline
- их `start` должен быть append-relative, а не `0`
- исходный video clip должен оставаться кликабельным

### Плоскость B. Архитектурная

- fix не должен читать `tracks/clips/start/duration` из adapter для сборки write payload
- fix не должен закреплять внешний traversal через pageRuntime как источник истины
- fix должен возвращать вычисление append внутрь `Project.addResourceToTimeline`

Если найдено только место расхождения в данных, но при этом proposed fix нарушает плоскость B, задача не считается решенной полностью.

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

Для текущего кейса нужно добавить еще одну специальную ветку в flow, потому что уже доказана отдельная DKT-специфичная ловушка:

```text
Project.addResourceToTimeline (multi-step action)
-> step 1 runs
-> если step 1 не записал $output, next payload не переносится автоматически
-> current_payload для step 2 может стать null
-> step 2 теряет sourceResourceId
-> audio path может не выполниться или выполниться не так, как ожидается
```

То есть для `addResourceToTimeline` нельзя рассматривать только generic state/render pipeline. Нужно отдельно проверять inline saga payload propagation.

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

Но для конкретно этого P0-1 есть еще одна, более узкая, уже подтвержденная гипотеза:

4. orchestration bug в DKT action
   шаги action syntactically объявлены верно, но payload propagation между ними устроена не так, как предполагалось

В текущем кейсе именно это уже было найдено для WAV path.

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

Дополнительно в этой фазе надо проверять не только конечный state, но и правильность orchestration assumptions:

5. какой именно action dispatch-ится из adapter
6. есть ли промежуточный шаг, завязанный на `$output`
7. не теряется ли payload между шагами inline saga

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

Если уже здесь WAV не появляется или payload между шагами рвется, проблема может быть не в append-start computation, а раньше: в multi-step action orchestration и `$output` semantics.

Если здесь state правильный, дальше в Playwright бессмысленно чинить action layer.

## Этап 2. Сужение внутри authoritative flow

Если pure state уже неправильный, делаем локальный binary split.

### Split A: вход в action

Проверить минимальный payload на входе:

- что adapter dispatch-ит только `sourceResourceId`
- что target scope правильный

Никакого внешнего traversal в adapter здесь быть не должно.

Это не просто рекомендация, а hard constraint для текущей задачи. Если для диагностики выясняется, что adapter уже начал читать `tracks/clips/start/duration`, расследование должно явно помечать этот путь как anti-pattern, а не продолжать развивать его.

### Split B: deps внутри `Project.addResourceToTimeline`

Временные логи или REPL-specific debug patch нужны только на следующих точках:

1. какие deps values вошли в `fn`
2. какой resource нашли
3. какой track выбран
4. какой append start рассчитан
5. какой payload ушел в `Track.addClip`

И еще один обязательный пункт для этого кейса:

6. был ли использован `$output`, если следующий step зависит от результата текущего

Надо явно различать два вопроса:

- append start рассчитался неверно
- следующий step вообще не получил нужный payload

Это разные классы дефекта.

### Split C: внутри `Track.addClip`

Проверить:

- дошел ли `start` до `normalizeClipCreationAttrs`
- не заменился ли там на `0`
- не теряется ли `sourceClipId`

### Что считать победой этапа

Authoritative graph после mutation должен уже содержать правильный `start`.

Но этого еще мало. Для текущего P0-1 победа этапа 2 означает сразу два условия:

1. authoritative graph содержит правильный `start`
2. этот результат получен без adapter-side traversal и без выноса append logic наружу из DKT action

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

Если authoritative state неверный, нельзя перескакивать сюда в надежде, что `ReactSyncReceiver` что-то объяснит. Это будет ложное расширение области поиска.

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

Для текущего P0-1 это наиболее вероятный сценарий, пока не доказано обратное, потому что handover уже фиксирует факт: новые клипы визуально оказываются в `0.0s`.

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

### Правило 4

Нельзя превращать диагностический обход state в целевой production fix.

Допустимо:

- читать state из REPL/debug tooling
- временно логировать action boundaries
- сравнивать authoritative и page-side graph

Недопустимо:

- переносить append computation в adapter
- использовать pageRuntime traversal как постоянный источник данных для write payload

### Правило 5

Для multi-step action каждый раз отдельно проверять: payload между шагами идет через `$output` или автор по ошибке рассчитывает на неявное сохранение `current_payload`.

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
8. отдельно снять признаки orchestration:
   - какой payload вошел в step 1
   - что ушло в `$output`
   - что получил step 2

Цель:

- доказать, где впервые появляется `start=0`
- доказать, где при необходимости теряется payload между шагами

### Фаза A1. Архитектурный gate

Перед тем как что-либо чинить после Фазы A, нужно ответить на отдельный бинарный вопрос:

```text
можно ли исправить найденный дефект, оставаясь в thin-dispatch contract?
```

Если ответ нет, это почти наверняка признак ложного направления.

Для текущего кейса ожидаемый правильный ответ:

- да, fix должен жить в `Project.ts`
- нет, fix не должен жить в `editorHarnessAdapter.ts`

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

### 5. Документация по DKT address/spec-addr

Позволяет не гадать, как устроены deps, `$noop`, `$output`, `$input*` и почему multi-step action может терять payload между шагами.

Для этого кейса это важно напрямую, потому что один из уже найденных дефектов был именно в неверном предположении о semantics inline saga.

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

Но для полного закрытия именно этой задачи нужно добавить еще один финальный критерий:

4. proposed fix не нарушает архитектурный контракт из handover и не закрепляет adapter-side traversal как production solution

Итоговая формулировка завершения для этого P0-1 должна выглядеть так:

- найден первый слой, на котором появляется неверное состояние
- найден root cause, включая DKT-specific orchestration semantics, если они участвуют
- выбран fix, который возвращает вычисление append внутрь DKT action
- pointer intercept исчезает как downstream consequence