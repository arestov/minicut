# $fx_ — варианты использования в MiniCut

Дата: 2026-05-09
Аудитория: разработчик MiniCut

## Обзор

`$fx_` — это механизм DKT для декларативного запуска side-effect'ов из actions. Effect вызывается не императивно, а через постановку task'а в транзакционную очередь. Выполнение откладывается до конца транзакции (batching).

DKT framework индексирует **все** типы эффектов в единый `__fx_by_name` index:
- `effects.in` → `state_request`, `nest_request`
- `effects.in` → `runtimeRef`
- `effects.out` → `produce`

Любой из них доступен как `$fx_<effectName>` target в action declarations.

## Архитектура вызова

```
Action declaration:
  to: ['$fx_<name>', { intent: '<intent>', ...options }]
       │
       ▼
multiPath parse → result_type: 'effect' → path_type: 'fx_task'
       │
       ▼
save.js → enqueueExecItemFxTask()
  → lookup __fx_by_name['$fx_<name>']
  → enqueueFxTask({ effect_name, intent, fx_entry, payload })
       │
       ▼
Transaction agenda (batched):
  highway.__fx_task_schedule[agenda_key][task_key] = task
       │
       ▼
scheduleFxTransactionEnd → FlowStep в конце транзакции
       │
       ▼
handleFxTransactionEnd:
  ├── API ready? → runFxTask()
  ├── drop_when_api_not_ready? → drop
  └── иначе → waiting queue → flush при useInterface()
```

## Вариант 1: state_request — загрузка данных

**Intent**: `request`, `refresh`, `reset`, `reload`

**Когда использовать**: модель нуждается в данных из внешнего источника (API, cache).

```ts
// Объявление effect'а
effects: {
    in: {
        bio: {
            api: '#profileApi',
            fn: [['userId'], (userId) => ({ url: `/users/${userId}` })],
            states: ['bio'],
        },
    },
},

// Action — trigger загрузки
actions: {
    loadBio: {
        to: ['$fx_bio', { intent: 'request' }],
        fn: () => ({}),
    },
    refreshBio: {
        to: ['$fx_bio', { intent: 'refresh' }],
        fn: () => ({}),
    },
},
```

**Intents**:

| Intent | Поведение |
|---|---|
| `request` | Идемпотентен. Не стартует если данные есть или запрос в полёте |
| `refresh` | Перезапускает даже если данные есть (stale-while-revalidate) |
| `reset` | Очищает данные, meta attrs, отменяет in-flight |
| `reload` | `reset` + `request` (чистый старт) |
| `append` | Только для `nest_request`. Следующая страница (pagination) |

## Вариант 2: nest_request — загрузка коллекций

**Intent**: `request`, `refresh`, `reset`, `reload`, `append`

**Когда использовать**: модель управляет вложенной коллекцией (список, feed, pagination).

```ts
effects: {
    in: {
        posts: {
            api: 'feedApi',
            fn: [['userId'], (userId) => ({ url: `/feed/${userId}` })],
            parse: [(items) => items.map(parsePost)],
        },
    },
},

actions: {
    openFeed: {
        to: ['$fx_posts', { intent: 'request' }],
        fn: () => ({}),
    },
    loadMore: {
        to: ['$fx_posts', { intent: 'append' }],
        fn: () => ({}),
    },
},
```

## Вариант 3: produce (out-effect) — вызов runtime side-effect

**Intent**: `call`

**Когда использовать**: нужно вызвать runtime-side функцию (publish message, trigger render, call external API) с payload из action.

Это **единственный intent** для produce-эффектов. Framework автоматически нормализует intent в `'call'` для `produce` и `runtimeRef` типов.

```ts
// Объявление produce effect'а
effects: {
    api: {
        exportRuntime: [
            ['_node_id'] as const,
            ['#exportRuntime'] as const,
            (api: unknown) => api,
        ],
    },
    out: {
        requestExport: {
            api: ['exportRuntime'],
            create_when: { api_inits: true },
            fn: (api, state) => {
                const runtime = api as { requestExport?: (p: unknown) => void }
                const payload = (state as { payload?: unknown }).payload
                runtime.requestExport?.(payload)
            },
        },
    },
},

// Action — вызывает effect через $fx_
actions: {
    requestProjectExport: [
        {
            to: {
                exportRequest: ['exportRequest'],
                exportProgress: ['exportProgress'],
                exportFxPayload: ['$output'],
            },
            fn: [deps, (/* ... */) => {
                const request = { id, range, plan, ... }
                return {
                    exportRequest: request,
                    exportProgress: { stage: 'queued', ... },
                    exportFxPayload: request,
                }
            }],
        },
        {
            // Step 2: вызвать $fx_ с payload из step 1 ($output)
            to: ['$fx_requestExport', { intent: 'call', drop_when_api_not_ready: false }],
            fn: (payload) => {
                if (!payload || typeof payload !== 'object') return '$noop'
                return payload
            },
        },
    ],
},
```

### Как передаётся payload в produce effect

1. Step 1 action возвращает `{ ..., exportFxPayload: request }` — это `$output`
2. Step 2 получает `$output` как аргумент `fn`, возвращает его как payload
3. `enqueueFxTask` сохраняет payload в task record
4. `runFxTask` → `case 'call'` → `executeOutputTask(model, effectName, { payload: task.payload })`
5. Effect fn получает `state` = `{ payload: task.payload, created_by_custom_call: true }`

### Важно: `state` в callable out-effect

Когда effect вызывается через `$fx_` с `intent: 'call'`, `state` содержит:
```ts
{
    payload: <payload из action result>,
    created_by_custom_call: true,
}
```

Это **отличается** от trigger-based вызова, где `state` содержит attrs модели. После миграции на `$fx_`-only, effect fn должен читать `state.payload`, не attrs.

## Вариант 4: runtimeRef — передача runtime объектов

**Intent**: `call` (автоматически)

**Когда использовать**: action получает runtime объект (FileList, MessagePort, OffscreenCanvas) из UI и передаёт его в effect.

```ts
effects: {
    in: {
        handleInputFiles: {
            type: 'runtimeRef',
            api: '#fileInputApi',
            fn: async (api, payload, ctx) => {
                const files = Array.from(payload.runtimeRef as FileList)
                return api.importFiles(files, payload.data, ctx)
            },
            action: 'saveImportedFiles',
            parse: (result) => result,
        },
    },
},
```

Запуск через `dispatchTask` (imperative boundary):
```ts
projectView.dispatchTask('$fx_handleInputFiles', {
    runtimeRef: event.currentTarget.files,
    data: { source: 'file-input', addToTimeline: true },
})
```

Или через action:
```ts
actions: {
    importFilesRequested: {
        to: ['$fx_handleInputFiles', { intent: 'call' }],
        fn: (payload) => payload,
    },
},
```

## Опции target

| Опция | Тип | Default | Описание |
|---|---|---|---|
| `intent` | `string` | обязательный | `'request'`, `'refresh'`, `'reset'`, `'reload'`, `'append'`, `'call'` |
| `drop_when_api_not_ready` | `boolean` | `false` | `true` — task отбрасывается если API не готов |
| `queue_policy` | `string` | `'replace-last'` | Политика для дублирующихся task'ов |

## Batching и replace-last

Все `$fx_` tasks в одной транзакции группируются в agenda. Два task'а с одинаковым `effect_name:intent` — второй перезаписывает первый (replace-last).

Разные intents выполняются последовательно:
```ts
to: [
    ['$fx_bio', { intent: 'reset' }],    // выполнится
    ['$fx_bio', { intent: 'request' }],  // выполнится (другой intent)
],
```

Одинаковые intents — последний побеждает:
```ts
to: [
    ['$fx_bio', { intent: 'request' }],  // перезаписан
    ['$fx_bio', { intent: 'request' }],  // выполнится только этот
],
```

## Cross-model: вызов эффекта на дочерней модели

Через nesting path в multiPath addr:

```ts
// Эффект объявлен на дочерней модели WeatherLocation
// Родитель вызывает через rel
actions: {
    loadWeather: {
        to: ['< $fx_loadWeather < weatherLocation', { intent: 'request' }],
    },
},
```

Синтаксис: `'< $fx_<effectKey> < <nestingPath>'`

## API readiness и waiting queue

Если API не готов:
1. Task помещается в `highway.__fx_tasks_waiting`
2. Когда вызывается `useInterface(api_name, instance)`, срабатывает `flushWaitingFxTasks`
3. Каждый waiting task проверяется индивидуально
4. Если API готов — выполняется, если нет — остаётся в очереди

Для app-level API (prefix `#`): резолвится через `target_md.app` вместо `target_md`.

Opt-out: `drop_when_api_not_ready: true` — task тихо отбрасывается.

## Чеклист: какой вариант использовать

| Сценарий | Вариант | Intent |
|---|---|---|
| Загрузить данные с сервера | state_request | `request` |
| Обновить stale данные | state_request | `refresh` |
| Очистить кеш + загрузить заново | state_request | `reload` |
| Загрузить следующую страницу | nest_request | `append` |
| Вызвать runtime функцию (publish, render) | produce | `call` |
| Передать File/Port/Blob в effect | runtimeRef | `call` (auto) |
| Fire-and-forget аналитика | produce | `call` + `drop_when_api_not_ready: true` |

## Антипаттерны

1. **Не** использовать `$fx_` для синхронной доменной логики — это инструмент для side-effects.
2. **Не** хранить runtimeRef ID в attrs/rels как долговременный id.
3. **Не** комбинировать trigger-based out-effect с `$fx_` callable для одного и того же эффекта — выбрать один путь.
4. **Не** объявлять `trigger` на out-effect если используете `$fx_` intent `call`.
