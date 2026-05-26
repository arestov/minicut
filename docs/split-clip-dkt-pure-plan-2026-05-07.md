# Split Clip — DKT-pure оркестрация: план, проблемы, reference

## Что сломано сейчас

`sessionSplitSelectedClipAction` → `inline_subwalker → selectedClip.splitSelfAt` →
шаг 2 `splitSelfAt`: `to: ['<< track', { action: 'splitClipAt', sub_flow: true }]`

Шаг 2 молча пропускается, потому что у Clip не установлен `track`-rel. Важно:
`linking: '<< track << #'` на `input`-rel не делает авто-присваивание, это только
валиддация значения при set.

**Root cause:** Ни одно из Track-действий (`addClip`, `addTextClip`, `splitClipAt`)
не передаёт `rels: { track: self }` при создании Clip. Поэтому `track`-rel всегда `null`.

**Последствия:**
- `Clip.splitSelfAt` шаг 2 → `<< track` → null → silent skip → нет правого clip
- `Clip.removeSelf` → `<< track` → null → silent skip → clip не удаляется
- Любое будущее действие Clip, делегирующее Track через `<< track`, не сработает

## Что было ошибкой

Внешняя оркестрация в runtime-адаптере (`dispatch A → чтение state → dispatch B`) —
антипаттерн. Такая логика ломает DKT-транзакционность и создаёт гонки.

---

## Reference: хорошие паттерны оркестрации (из Linkcraft)

Ниже референсные паттерны по Linkcraft `D:\code\linkcraft\src`.

### 1) Self через специальный адрес `<<<<` внутри action

Паттерн: текущая модель берётся как dep и используется как payload для rel/action,
без внешнего адаптера.

Примеры:
- `src/models/Routers/MainNavigation/MainNavigation.js`:
  `handleInit.fn: [['<<<<'], (_, self) => self]`
- `src/models/LiveDocument.js`:
  `removeLiveDocumentFromMentions.fn: [['<<<<'], (_, self) => ({ ...self refs... })]`

Смысл: модель сама управляет собой и связями; orchestrator снаружи не нужен.

### 2) Внутренняя многошаговая сага (inline/sub_flow), а не внешняя склейка dispatch

Паттерн: все шаги (create/reuse/route) делаются внутри одного action-массива.

Пример:
- `src/models/Routers/MainNavigation/MainNavigation.js` action `runQuery`:
  шаг 1 создаёт/переиспользует step, использует `hold_ref_id/use_ref_id` и `$output`,
  шаг 2 делает навигацию через `to: ['<<<<', { action: 'ensureSearchStepIsNavigated', inline_subwalker: true }]`.

Смысл: доменная оркестрация живёт внутри DKT action graph и тестируется как целое.

### 3) Создание child и запись owner/self-связи в той же транзакции

Паттерн: при создании новой модели сразу записывается rel на текущую модель (`self`),
а не отдельным внешним пост-процессом.

Пример:
- `src/models/SearchingStep.js` action `useQueryAsUrlToSpawnStep`:
  `fn: [['<<<<', 'textQuery'], (_, self, textQuery) => ({ navigationSteps: { rels: { spawningSource: self } ... }})`

Смысл: owner/source связь должна фиксироваться в момент создания сущности.

### 4) `input` + `linking` = контроль типа/графа, не авто-link

Паттерн: rel остаётся пустым, пока его явно не set-нуть через action payload.

Примеры:
- `src/models/LiveDocument.js`: `currentStep: ['input', { linking: '<< navigationSteps << ^' }]`
- `src/models/SearchingStep.js`: `step: ['input', { linking: '<< navigationSteps << #' }]`

Смысл: `linking` задаёт допустимый адрес, но связь создаётся только явным set.

### 5) `creation_shape` + `rels` — разрешённые rel при создании

Паттерн: `creation_shape` поддерживает `rels` — декларацию допустимых rel-полей
в creation payload. Без `rels` в `creation_shape` передача `rels: { ... }`
выбросит runtime error.

Пример (из `dkt/test/__tests__/pass/creation_shape.js:91`):
```js
creation_shape: {
    attrs: ['title'],
    rels: {
        items: { attrs: ['title'] },   // разрешает вложенные items с attrs
    },
},
fn: () => ({
    attrs: { title: 'page' },
    rels: { items: [{ attrs: { title: 'item' } }] },  // OK
}),
```

Для простых model-ref rel (без вложенного создания) — пустая форма `{}`:
```js
creation_shape: {
    attrs: ['title'],
    rels: {
        parent: {},   // принимает runtime model напрямую
    },
},
fn: [['<<<<'], (_, self) => ({
    attrs: { title: 'child' },
    rels: { parent: self },   // OK — передаётся runtime model
})],
```

Валидация (из `dkt/js/libs/provoda/dcl/passes/act/creationShape.js:122`):
runtime model (`_node_id` + `queryRel`/`getStrucRoot`) пропускается без рекурсивной
валидации, но ключ `rels` в `creation_shape` обязателен — иначе error:
`"creation input.rels is not allowed by creation_shape"`.

---

## Reference: плохая оркестрация

Плохие паттерны, которых избегаем:

1. Runtime/UI orchestrates actor state:
   `await dispatch('A') → прочитать snapshot → решить, вызывать ли dispatch('B')`.

2. Внешний обход графа после доменного action:
   «после addClip пробежать все clips и долинковать track».

3. Дублирование доменной логики в адаптере:
   когда правила принадлежности сущностей живут не в model actions, а в runtime glue.

---

## Обновлённый план (с учётом Linkcraft-паттернов + review)

Ключевой вывод: `_node_id` не нужен как основная стратегия. Базовый путь — передавать
текущую модель как `self` через `<<<<` и устанавливать rel при создании.

### Подтверждённый блокер: `CLIP_CREATION_SHAPE`

**Текущее состояние** (`Clip.ts:485`):
```ts
export const CLIP_CREATION_SHAPE = {
    attrs: ['sourceClipId', 'sourceResourceId', ...],
    // НЕТ rels!
} as const
```

DKT валидатор (`creationShape.js:155-156`) выбросит при передаче `rels: { track: self }`:
```
creation input.rels is not allowed by creation_shape
```

**Решение:** Добавить `rels: { track: {} }` в `CLIP_CREATION_SHAPE`.
Пустой объект `{}` = «принимает runtime model без вложенного создания».
Это стандартный паттерн Linkcraft.

### План A (основной): self-rel при создании Clip

1. **Обновить `CLIP_CREATION_SHAPE`** — добавить `rels: { track: {} }`.
2. В `Track.addClip`/`addTextClip`/`splitClipAt` добавить dep `['<<<<']`.
3. В payload создания clip передавать `rels: { track: self }` в том же шаге, где создаётся clip.
4. Оставить `Clip.splitSelfAt` шаг 2 как `to: ['<< track', { action: 'splitClipAt', sub_flow: true }]`.
5. Проверить, что split-цепочка закрыта одной session dispatch без внешнего runtime sync.

**Конкретные изменения по файлам:**

**`Clip.ts:485` — CLIP_CREATION_SHAPE:**
```ts
export const CLIP_CREATION_SHAPE = {
    attrs: ['sourceClipId', 'sourceResourceId', 'sourceResourceName', 'sourceTextId',
            'name', 'color', 'mediaKind', 'start', 'in', 'duration',
            'fadeIn', 'fadeOut', 'audio', 'opacity', 'transform'],
    rels: {
        track: {},    // <-- ДОБАВИТЬ: разрешает rels: { track: <Track model> }
    },
} as const
```

**`Track.ts:66-91` — addClip:**
```ts
addClip: {
    when: [
        [] as const,
        (payload: unknown) => typeof (payload as { sourceClipId?: unknown } | null)?.sourceClipId === 'string',
    ],
    to: {
        clip: ['<< clip << #', {
            method: 'at_end',
            can_create: true,
            can_hold_refs: true,
            creation_shape: CLIP_CREATION_SHAPE,   // теперь включает rels.track
        }],
        clips: ['<< clips', {
            method: 'at_end',
            can_use_refs: true,
        }],
    },
    fn: [['<<<<'], (payload: unknown, self: unknown) => {    // <-- ДОБАВИТЬ ['<<<<']
        const attrs = normalizeClipCreationAttrs(payload)
        return attrs
            ? {
                clip: { attrs, rels: { track: self }, hold_ref_id: 'newClip' },  // <-- ДОБАВИТЬ rels
                clips: { use_ref_id: 'newClip' },
            }
            : '$noop'
    }],
},
```

**`Track.ts:93-123` — addTextClip:**
```ts
addTextClip: {
    to: { /* ... без изменений ... */ },
    fn: [['<<<<'], (payload: unknown, self: unknown) => {    // <-- ДОБАВИТЬ ['<<<<']
        const value = payload as { text?: unknown } | null
        const clipAttrs = normalizeClipCreationAttrs(payload)
        const textAttrs = normalizeTextCreationAttrs(value?.text)
        return clipAttrs && textAttrs
            ? {
                clip: { attrs: clipAttrs, rels: { track: self }, hold_ref_id: 'newTextClip' },  // <-- ДОБАВИТЬ rels
                text: { attrs: textAttrs, hold_ref_id: 'newTextNode' },
                clips: { use_ref_id: 'newTextClip' },
            }
            : '$noop'
    }],
},
```

**`Track.ts:125-147` — splitClipAt:**
```ts
splitClipAt: {
    to: { /* ... без изменений ... */ },
    fn: [['<<<<'], (payload: unknown, self: unknown) => {    // <-- ДОБАВИТЬ ['<<<<']
        const attrs = normalizeRightSplitClipAttrs(payload)
        return attrs
            ? {
                clip: { attrs, rels: { track: self }, hold_ref_id: 'rightSplitClip' },  // <-- ДОБАВИТЬ rels
                clips: { use_ref_id: 'rightSplitClip' },
            }
            : '$noop'
    }],
},
```

### План B (fallback, если Plan A не сработает)

Если `rels` в creation payload по какой-то причине не работает:

1. В `Track` action оставить create + `forwarded: { use_ref_id: ... }`.
2. Вторым внутренним шагом (не из адаптера) вызвать `setTrack` на созданном clip,
   используя `self` (`<<<<`) как источник track.

Идея fallback: даже если придётся второй шаг, он остаётся внутри DKT action graph,
а не в runtime-обвязке.

---

## Таблица рисков (обновлённая после review)

| # | Риск | Уровень | Митигация | Статус |
|---|------|---------|-----------|--------|
| 1 | `rels` в create payload требует явного разрешения в `creation_shape` | **Подтверждённый блокер** | Обновить `CLIP_CREATION_SHAPE`: добавить `rels: { track: {} }`. Стандартный паттерн Linkcraft | Решено — известен конкретный фикс |
| 2 | `<<<<` может вести себя по-разному в разных контекстах action | Низкий | Unit-test на `Track.addClip` проверит, что `track` rel реально заполнен | Покрыто тестом 1 |
| 3 | Исторические клипы уже без `track` rel | Средний (отложен) | Не блокирует текущий фикс. Для миграции: repair-action внутри модели (не runtime traversal). Отложить до Task #7 (bootstrap рефакторинг) | Отложен |
| 4 | Шаг 3 в `splitSelfAt` очищает `splitOriginalDuration` даже если шаг 2 не прошёл | Низкий | После фикса track rel шаг 2 больше не пропускается. Если нужен guard — добавить `when: [['splitOriginalDuration'], (v) => v != null]` на шаг 3. Сначала фиксим track, потом проверяем воспроизводимость | Будет перепроверен после шага 3 |
| 5 | `Project.addClip`/`addResourceToTimeline` делегируют через `<< primaryVideoTrack → addClip` — но track model может не существовать | Низкий | `primaryVideoTrack` — computed rel, должен резолвить через `tracks` rel Project'а. Если tracks созданы при handleInit — всё работает. Если нет — отдельный баг, не связанный с данным планом | Известен |
| 6 | `AppRoot.createClipModel` (seed action) не устанавливает `track` rel | Средний | Seed-action для bootstrapping существующих данных. При seed-создании track может ещё не существовать. Решение: либо передавать track в seed payload, либо добавить post-seed repair. Не блокирует основной фикс | Отложен |

---

## Подробный порядок реализации

### Инфраструктура для тестов на чистый стейт

Для тестирования DKT-моделей напрямую (без runtime adapter, без JSDOM) нужен
тестовый helper, аналогичный Linkcraft `testingInit` (`dkt/test/testingInit.js`).

**Сравнение подходов:**

| Подход | Где используется | Окружение | Как читается state |
|--------|-----------------|-----------|-------------------|
| `testingInit` + `computed()` | Linkcraft `dkt/test/` | Node | Прямой доступ к модели: `model.states`, `queryRel()` |
| Runtime harness + `debugDumpAppState()` | Weather `test/`, Minicut текущие тесты | jsdom | Сериализация: `appState.runtimeModels`, JSON snapshot |
| `createWeatherModelRuntime()` + transport bridge | Weather `auto-geo-app-state.test.ts` | jsdom | `debugDumpAppState()` через transport |

Для чистых DKT-модельных тестов берём подход Linkcraft `testingInit` — прямой доступ
к моделям, без serialization/transport overhead.

**Новый файл:** `src/video-editor/dkt/testingInit.ts`

Концепция (по аналогии с Linkcraft `dkt/test/testingInit.js`):

```ts
import { prepare as prepareAppRuntime } from 'dkt/runtime/app/prepare.js'
import { MiniCutAppRoot } from '../models/AppRoot'

// --- Error catching (по паттерну Linkcraft testingInit catchFlowErrors) ---

const catchFlowErrors = () => {
    let reject_error_prom: ((err: unknown) => void) | null = null
    const prepare = () => {
        last_error_prom = new Promise<never>((_resolve, reject) => {
            reject_error_prom = (err: unknown) => {
                reject(err)
                prepare()
            }
        })
    }
    let last_error_prom: Promise<never>
    prepare()
    return {
        last_error_prom,
        reject: (err: unknown) => reject_error_prom?.(err),
    }
}

// --- computed(): дождаться settle DKT graph ---

const computed = (runtime: any, errors: ReturnType<typeof catchFlowErrors>) =>
    Promise.race([
        runtime.last_error,
        errors.last_error_prom,
        new Promise<void>((resolve) => runtime.whenAllReady(() => resolve())),
    ])

// --- Основной helper ---

export const bootDktModels = async () => {
    const errors = catchFlowErrors()

    const runtime = prepareAppRuntime({
        sync_sender: false,
        proxies: false,
        warnUnexpectedAttrs: true,
        onError: (err: unknown) => { errors.reject(err) },
    })

    const inited = await Promise.race([
        runtime.last_error,
        errors.last_error_prom,
        runtime.start({
            App: MiniCutAppRoot,
            interfaces: {},
            unload_models: false,
        }),
    ])

    const waitSettled = () => computed(runtime, errors)

    // lockToRead: dispatch + дождаться settle (по паттерну Linkcraft)
    const lockToRead = async (fn: () => void) => {
        await Promise.race([
            runtime.last_error,
            errors.last_error_prom,
            new Promise<void>((resolve, reject) => {
                runtime.input(async () => {
                    try {
                        fn()
                        await computed(runtime, errors)
                        resolve()
                    } catch (err) {
                        reject(err)
                    }
                })
            }),
        ])
    }

    return {
        app_model: inited.app_model,
        runtime,
        waitSettled,
        lockToRead,
        ...inited,
    }
}
```

**Почему `Promise.race` с `last_error`:** Если DKT-экшен выбрасывает (например,
`creationShape` validation error), `whenAllReady` не resolved — тест зависнет.
Race с error promise гарантирует быстрый fail. Это ключевая фича Linkcraft `testingInit`.

**Почему `lockToRead`:** В Linkcraft все dispatch делаются внутри `runtime.input()`
для гарантии ordering. Minicut может работать и без этого (dispatch сам планирует
в flow), но `lockToRead` даёт доп. гарантию: action выполнен → graph settled → можно читать.

Helper utilities для чтения модели:
```ts
export const queryRel = async (model: any, relName: string): Promise<any[]> => {
    const result = await model.queryRel(relName)
    return Array.isArray(result) ? result : result ? [result] : []
}

export const getAttr = (model: any, attrName: string): unknown =>
    model.states?.[attrName]

export const findBySourceId = async (appModel: any, modelName: string, attrName: string, sourceId: string) => {
    const models = await queryRel(appModel, modelName)
    return models.find((m: any) => m.states?.[attrName] === sourceId) ?? null
}
```

**Vitest config:** добавить pattern для чистых DKT-тестов в
`vitest.video-editor.node.config.js`:
```js
include: [
    // ... existing patterns ...
    'src/video-editor/dkt/models/**/*.test.ts',   // <-- pure DKT model tests (node env)
],
resolve: {
    alias: {
        dkt: 'tmp/dkt/js/libs/provoda/provoda',      // <-- НУЖНО: DKT module resolution
        'dkt-all': 'tmp/dkt/js',
    },
},
```

Тестовые файлы размещать в `src/video-editor/dkt/models/` — они будут запускаться
в node environment (без JSDOM).

**Важно:** node config нужен `resolve.alias` для `dkt`/`dkt-all` — сейчас он есть
только в jsdom config (`vitest.video-editor.config.js`). Без алиасов импорты
`from 'dkt/model.js'` не резолвятся.

---

### Интеграционные тесты на чистый стейт

Все тесты ниже работают напрямую с DKT-модельным графом.
Никакого runtime adapter, никакого `syncSessionSelectionRels`, никакого JSDOM.
Один `dispatch` → `computed()` → проверить attrs/rels.

#### Тест 1: `Track.addClip — clip получает track rel`

**Файл:** `src/video-editor/dkt/models/track-clip-rel.test.ts`

**Цель:** Проверить, что `Track.addClip` создаёт Clip с установленным `track` rel.
Это базовый тест — если он падает, весь план не работает.

**Setup:**
1. `bootDktModels()` → получить `app_model`
2. `app_model.dispatch('createProjectModel', { sourceProjectId: 'p1', title: 'Test' })`
3. `await computed(runtime)` — дождаться settle
4. Найти video Track: `findBySourceId(app_model, 'track', 'sourceTrackId', 'p1:track:video')`

**Action:**
```ts
trackModel.dispatch('addClip', {
    sourceClipId: 'clip:test-1',
    name: 'test.webm',
    mediaKind: 'video',
    start: 0,
    in: 0,
    duration: 5,
})
await computed(runtime)
```

**Assertions:**
```ts
// 1. Clip создан в графе
const clips = await queryRel(trackModel, 'clips')
expect(clips.length).toBe(1)

// 2. Clip attrs корректны
const clip = clips[0]
expect(getAttr(clip, 'sourceClipId')).toBe('clip:test-1')
expect(getAttr(clip, 'start')).toBe(0)
expect(getAttr(clip, 'duration')).toBe(5)

// 3. КЛЮЧЕВОЕ: clip имеет track rel === исходный Track
const clipTrackRels = await queryRel(clip, 'track')
expect(clipTrackRels.length).toBe(1)
expect(clipTrackRels[0]).toBe(trackModel)    // строго тот же объект
```

**Что проверяем:**
- `['<<<<']` в fn deps даёт Track model
- `rels: { track: self }` в creation payload принимается DKT
- `CLIP_CREATION_SHAPE` с `rels: { track: {} }` не блокирует создание
- Clip.track linking `'<< track << #'` резолвит обратно к Track

---

#### Тест 2: `Track.splitClipAt — split-right clip получает track rel`

**Файл:** `src/video-editor/dkt/models/track-clip-rel.test.ts` (в том же файле)

**Цель:** Проверить, что `Track.splitClipAt` (вызывается из `Clip.splitSelfAt` шаг 2)
создаёт правый clip с установленным `track` rel.

**Setup:**
1. `bootDktModels()` → `app_model`
2. Создать Project + Track
3. Добавить clip через `trackModel.dispatch('addClip', { sourceClipId: 'clip:orig', ... start: 0, duration: 10 })`
4. `await computed(runtime)`

**Action:**
```ts
trackModel.dispatch('splitClipAt', {
    sourceClipId: 'clip:split-right:1',
    name: 'test.webm',
    mediaKind: 'video',
    splitTime: 4,
    sourceClip: { start: 0, in: 0, duration: 10 },
})
await computed(runtime)
```

**Assertions:**
```ts
// 1. Теперь 2 clip'а на track
const clips = await queryRel(trackModel, 'clips')
expect(clips.length).toBe(2)

// 2. Правый clip создан с правильными attrs
const rightClip = clips.find((c: any) => getAttr(c, 'sourceClipId') === 'clip:split-right:1')
expect(rightClip).toBeTruthy()
expect(getAttr(rightClip, 'start')).toBe(4)
expect(getAttr(rightClip, 'duration')).toBe(6)   // 10 - 4 = 6
expect(getAttr(rightClip, 'in')).toBe(4)

// 3. КЛЮЧЕВОЕ: правый clip имеет track rel
const rightTrackRels = await queryRel(rightClip, 'track')
expect(rightTrackRels.length).toBe(1)
expect(rightTrackRels[0]).toBe(trackModel)
```

**Что проверяем:**
- `splitClipAt` (вызывается из саги splitSelfAt) корректно передаёт `self` (Track)
- Правый clip — полноценная модель с `track` rel

---

#### Тест 3: `Clip.splitSelfAt — полная 3-шаговая сага создаёт оба clip'а`

**Файл:** `src/video-editor/dkt/models/split-clip-saga.test.ts`

**Цель:** Проверить полную цепочку splitSelfAt:
шаг 1 (укоротить left) → шаг 2 (delegate track.splitClipAt) → шаг 3 (cleanup).
Без этого теста мы не знаем, что sub_flow от Clip к Track работает после фикса.

**Setup:**
1. `bootDktModels()` → `app_model`
2. Создать Project, получить Track
3. `trackModel.dispatch('addClip', { sourceClipId: 'clip:split-me', ..., start: 0, in: 0, duration: 10 })`
4. `await computed(runtime)`
5. Найти clip: `clips.find(c => getAttr(c, 'sourceClipId') === 'clip:split-me')`

**Action:**
```ts
clipModel.dispatch('splitSelfAt', { time: 4 })
await computed(runtime)
```

**Assertions:**
```ts
// 1. На track теперь 2 clip'а
const clips = await queryRel(trackModel, 'clips')
expect(clips.length).toBe(2)

// 2. Left clip укорочен
const leftClip = clips.find((c: any) => getAttr(c, 'sourceClipId') === 'clip:split-me')
expect(leftClip).toBeTruthy()
expect(getAttr(leftClip, 'duration')).toBe(4)    // 0..4
expect(getAttr(leftClip, 'start')).toBe(0)
expect(getAttr(leftClip, 'splitOriginalDuration')).toBeNull()  // шаг 3 очистил

// 3. Right clip создан
const rightClip = clips.find((c: any) => getAttr(c, 'sourceClipId') !== 'clip:split-me')
expect(rightClip).toBeTruthy()
expect(getAttr(rightClip, 'start')).toBe(4)
expect(getAttr(rightClip, 'duration')).toBe(6)   // 4..10
expect(getAttr(rightClip, 'in')).toBe(4)         // 0 + 4

// 4. Оба clip'а имеют track rel
const leftTrack = await queryRel(leftClip, 'track')
const rightTrack = await queryRel(rightClip, 'track')
expect(leftTrack[0]).toBe(trackModel)
expect(rightTrack[0]).toBe(trackModel)
```

**Что проверяем:**
- Полная 3-шаговая inline saga `splitSelfAt`
- `<< track` резолвит (шаг 2 не молча пропускается)
- `sub_flow: true` от Clip к Track корректно создаёт дочерний action
- Шаг 3 (cleanup `splitOriginalDuration`) выполняется корректно

---

#### Тест 4: `SessionRoot.splitSelectedClip — end-to-end через session dispatch`

**Файл:** `src/video-editor/dkt/models/split-clip-saga.test.ts` (в том же файле)

**Цель:** Проверить полную цепочку от session root до split:
`SessionRoot.splitSelectedClip` → `selectedClip.splitSelfAt` → `track.splitClipAt`.
Это интеграционный тест всей цепочки inline_subwalker → sub_flow.

**Setup:**
1. `bootDktModels()` → `app_model`
2. Найти session root: `await queryRel(app_model, '$session_root')` → `sessionRoot`
3. `sessionRoot.dispatch('createProject', { sourceProjectId: 'p1', title: 'E2E' })`
4. `await computed(runtime)`
5. Найти track, добавить clip через track action
6. `sessionRoot.dispatch('selectEntity', 'clip:e2e')`
7. `sessionRoot.dispatch('setCursor', 3)`
8. `await computed(runtime)`

**Action:**
```ts
sessionRoot.dispatch('splitSelectedClip')
await computed(runtime)
```

**Assertions:**
```ts
// 1. На track 2 clip'а
const clips = await queryRel(trackModel, 'clips')
expect(clips.length).toBe(2)

// 2. Left clip укорочен
const leftClip = clips.find((c: any) => getAttr(c, 'sourceClipId') === 'clip:e2e')
expect(leftClip).toBeTruthy()
expect(getAttr(leftClip, 'duration')).toBe(3)     // 0..3
expect(getAttr(leftClip, 'start')).toBe(0)

// 3. Right clip создан
const rightClip = clips.find((c: any) => getAttr(c, 'sourceClipId') !== 'clip:e2e')
expect(rightClip).toBeTruthy()
expect(getAttr(rightClip, 'start')).toBe(3)
expect(getAttr(rightClip, 'duration')).toBe(7)    // 3..10

// 4. Оба clip'а имеют track rel
const leftTrack = await queryRel(leftClip, 'track')
const rightTrack = await queryRel(rightClip, 'track')
expect(leftTrack[0]).toBe(trackModel)
expect(rightTrack[0]).toBe(trackModel)

// 5. selectedEntityId очищен (шаг 2 sessionSplitSelectedClipAction)
expect(getAttr(sessionRoot, 'selectedEntityId')).toBeNull()
```

**Что проверяем:**
- Вся цепочка: session → clip → track → создание
- `inline_subwalker` (session → clip) + `sub_flow` (clip → track) в одной транзакции
- Session cleanup (deselection) выполняется после split

---

#### Тест 5: `Clip.removeSelf — удаляет clip через track delegation`

**Файл:** `src/video-editor/dkt/models/track-clip-rel.test.ts` (в том же файле)

**Цель:** Проверить, что `removeSelf` на Clip делегирует удаление через `<< track`.
Этот тест подтверждает, что `removeSelf` (как и `splitSelfAt`) зависит от `track` rel.

**Setup:**
1. `bootDktModels()` → `app_model`
2. Создать Project, Track
3. Добавить 2 clip'а: `clip:a` и `clip:b`
4. `await computed(runtime)`

**Action:**
```ts
const clipA = (await queryRel(trackModel, 'clips')).find((c: any) => getAttr(c, 'sourceClipId') === 'clip:a')
clipA.dispatch('removeSelf')
await computed(runtime)
```

**Assertions:**
```ts
// 1. На track остался 1 clip
const clips = await queryRel(trackModel, 'clips')
expect(clips.length).toBe(1)

// 2. Оставшийся — clip:b
expect(getAttr(clips[0], 'sourceClipId')).toBe('clip:b')

// 3. clip:a удалён из track.clips
const removedClip = clips.find((c: any) => getAttr(c, 'sourceClipId') === 'clip:a')
expect(removedClip).toBeUndefined()
```

**Что проверяем:**
- `removeSelf` работает после фикса track rel
- `<< track` + `sub_flow` для remove-цепочки
- `Track.removeClipBySourceId` корректно фильтрует clips

---

#### Тест 6: `Track.addTextClip — clip получает track rel, text создаётся`

**Файл:** `src/video-editor/dkt/models/track-clip-rel.test.ts` (в том же файле)

**Цель:** Проверить, что `addTextClip` корректно создаёт Clip + Text
и Clip получает `track` rel.

**Setup:**
1. `bootDktModels()` → `app_model`
2. Создать Project, Track

**Action:**
```ts
trackModel.dispatch('addTextClip', {
    sourceClipId: 'clip:text-1',
    name: 'Title',
    mediaKind: 'text',
    start: 1,
    in: 0,
    duration: 3,
    text: {
        sourceTextId: 'text:title-1',
        content: 'Hello World',
    },
})
await computed(runtime)
```

**Assertions:**
```ts
// 1. Clip создан
const clips = await queryRel(trackModel, 'clips')
expect(clips.length).toBe(1)
expect(getAttr(clips[0], 'sourceClipId')).toBe('clip:text-1')

// 2. Clip имеет track rel
const clipTrack = await queryRel(clips[0], 'track')
expect(clipTrack[0]).toBe(trackModel)

// 3. Text node создан
const textModels = await queryRel(app_model, 'text')
const textNode = textModels.find((t: any) => getAttr(t, 'sourceTextId') === 'text:title-1')
expect(textNode).toBeTruthy()
expect(getAttr(textNode, 'content')).toBe('Hello World')
```

---

## Таблица реализации (заполняется по мере выполнения)

Каждая строка — один атомарный шаг. Столбец «Commit» заполняется при комите.

| # | Шаг | Файлы | Зависит от | Commit |
|---|-----|-------|------------|--------|
| 1 | Создать `bootDktModels` + helpers в `dkt/testingInit.ts` | `src/video-editor/dkt/testingInit.ts` | — | |
| 2 | Обновить `vitest.video-editor.node.config.js`: добавить include pattern `src/video-editor/dkt/models/**/*.test.ts` | `vitest.video-editor.node.config.js` | — | |
| 3 | Обновить `CLIP_CREATION_SHAPE`: добавить `rels: { track: {} }` | `src/video-editor/models/Clip.ts` | — | |
| 4 | Обновить `Track.addClip`: добавить `['<<<<']` dep + `rels: { track: self }` | `src/video-editor/models/Track.ts` | 3 | |
| 5 | Обновить `Track.addTextClip`: добавить `['<<<<']` dep + `rels: { track: self }` | `src/video-editor/models/Track.ts` | 3 | |
| 6 | Обновить `Track.splitClipAt`: добавить `['<<<<']` dep + `rels: { track: self }` | `src/video-editor/models/Track.ts` | 3 | |
| 7 | Тест 1: `Track.addClip — clip получает track rel` | `src/video-editor/dkt/models/track-clip-rel.test.ts` | 1, 2, 4 | |
| 8 | Тест 6: `Track.addTextClip — clip+text созданы, track rel установлен` | `src/video-editor/dkt/models/track-clip-rel.test.ts` | 1, 2, 5 | |
| 9 | Тест 2: `Track.splitClipAt — split-right clip получает track rel` | `src/video-editor/dkt/models/track-clip-rel.test.ts` | 1, 2, 6 | |
| 10 | Тест 3: `Clip.splitSelfAt — полная 3-шаговая сага` | `src/video-editor/dkt/models/split-clip-saga.test.ts` | 1, 2, 6 | |
| 11 | Тест 4: `SessionRoot.splitSelectedClip — end-to-end через session dispatch` | `src/video-editor/dkt/models/split-clip-saga.test.ts` | 1, 2, 10 | |
| 12 | Тест 5: `Clip.removeSelf — удаляет clip через track delegation` | `src/video-editor/dkt/models/track-clip-rel.test.ts` | 1, 2, 4 | |
| 13 | Проверить: Risk #4 (шаг 3 cleanup). Воспроизводится ли после фикса track? | — | 10 | |
| 14 | Если Risk #4 воспроизвёлся: добавить `when` guard на шаг 3 `splitSelfAt` | `src/video-editor/models/Clip.ts` | 13 | |
| 15 | Удалить/закомментировать `syncSessionSelectionRels` вызовы для `track` sync из runtime (если были) | `src/video-editor/dkt/runtime/createMiniCutDktRuntime.ts` | 10 | |
| 16 | Прогнать существующий runtime-тест `createMiniCutDktRuntime.splitSelfAt.test.ts` — должен пройти без изменений | `src/video-editor/dkt/runtime/createMiniCutDktRuntime.splitSelfAt.test.ts` | 10 | |
| 17 | Финальный commit: `fix(dkt): set clip.track in Track actions via self rel orchestration` | Все изменённые файлы | 7–16 | |

---

## Статус задач

| # | Priority | Task | Status |
|---|----------|------|--------|
| 1 | Critical | Инфраструктура: `bootDktModels` helper + vitest node config | Not started |
| 2 | Critical | Обновить `CLIP_CREATION_SHAPE` с `rels: { track: {} }` | Not started |
| 3 | Critical | Обновить Track actions: `addClip`, `addTextClip`, `splitClipAt` — self-rel паттерн | Not started |
| 4 | Critical | Тесты 1–3: track rel установлен, split saga работает | Not started |
| 5 | Critical | Тесты 4–5: end-to-end session dispatch, removeSelf | Not started |
| 6 | Critical | Существующий runtime-тест проходит | Not started |
| 7 | High | Move selection derivation to SessionRoot model comps | Not started |
| 8 | High | Remove syncSessionSelectionRels runtime traversal | Not started |
| 9 | High | Move export graph to DKT model comp/action output | Not started |
| 10 | Medium-High | Consolidate two runtime adapter files | Not started |
| 11 | Medium | Replace bootstrap polling with declarative DKT trigger | Not started |
| 12 | Medium | Replace linear sourceId scan with DKT-side index | Not started |
| 13 | Medium | Migration: repair-action для исторических clip'ов без track rel (Risk #3) | Not started |
