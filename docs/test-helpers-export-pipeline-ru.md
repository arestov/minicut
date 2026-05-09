# Test Helpers: отслеживание завершения вычислений в экспортном pipeline

Дата: 2026-05-09
Аудитория: разработчик тестов MiniCut

## Принцип

Тесты не должны использовать polling (`setTimeout` loop, `setInterval`) для ожидания завершения асинхронных вычислений. Вместо этого — event-driven подписки на state changes.

DKT runtime предоставляет несколько механизмов для отслеживания завершения:

| Механизм | Где | Что отслеживает |
|---|---|---|
| `_calls_flow.whenReady(cb)` | DKT framework | Flow queue drains — все pending шаги выполнены |
| `runtime.whenAllReady(cb)` | DKT framework | Все модели в runtime idle |
| `subscribeRootAttrs(attrs, cb)` | PageSyncRuntime | Root attrs обновились (page-side) |
| `subscribeExportRequests(cb)` | PageSyncRuntime | Export request прошёл через worker |
| `debugDumpTasksTesting()` | runtimeTaskFacade | Очередь $fx_ tasks — active/completed/dropped |

## Event-driven: `createExportCompletionTracker`

**Файл**: `test/repl/exportCompletion.testing.ts`

Единственный recommended способ ждать завершения экспорта в тестах. Подписывается на `subscribeRootAttrs(['exportProgress'])` и `subscribeExportRequests`, не использует polling.

### API

```ts
interface ExportCompletionTracker {
    waitForExportStage(stage, options?): Promise<ExportCompletionResult>
    waitForExportDone(exportId?, options?): Promise<ExportCompletionResult>
    waitForExportRequest(options?): Promise<ExportRequestResult>
    waitForExportProgress(minProgress, options?): Promise<ExportCompletionResult>
    destroy(): void
}
```

### Примеры использования

#### Ожидание завершения project export

```ts
import { createExportCompletionTracker } from './exportCompletion.testing'

test('project export completes', async () => {
    const tracker = createExportCompletionTracker(pageRuntime)

    // Trigger export
    actions.requestProjectExport()

    // Wait for done or error (event-driven, no polling)
    const result = await tracker.waitForExportDone()

    expect(result.stage).toBe('done')
    expect(result.fileName).toBeTruthy()

    tracker.destroy()
})
```

#### Ожидание конкретного export ID

```ts
const result = await tracker.waitForExportDone('export:xyz123', { timeoutMs: 5000 })
```

#### Ожидание промежуточной стадии

```ts
// Wait for rendering to start
await tracker.waitForExportStage('rendering')

// Wait for at least 50% progress
await tracker.waitForExportProgress(50)

// Wait for completion
const final = await tracker.waitForExportDone()
```

#### Проверка что export request прошёл через worker

```ts
actions.requestProjectExport()
const request = await tracker.waitForExportRequest()
expect(request.range.type).toBe('project')
```

#### Таймауты

Все методы принимают `timeoutMs` (default: 10000ms). При таймауте — reject с информативным сообщением включая текущее состояние.

```ts
const result = await tracker.waitForExportDone(undefined, { timeoutMs: 30000 })
```

### Важно: lifecycle

Вызывай `tracker.destroy()` после использования — отписывает все listeners. Без destroy — memory leak.

## Существующие helpers

### `test/repl/stateInspect.testing.ts`

Инспекция графа после завершения вычислений:

```ts
import { waitForRuntimeReady, summarizeActiveProject, summarizeRootState } from './stateInspect.testing'

await waitForRuntimeReady(pageRuntime)
const project = summarizeActiveProject(pageRuntime)
const root = summarizeRootState(pageRuntime)
```

Методы:
- `waitForRuntimeReady(runtime)` — event-driven wait (subscribeRootScope + tick)
- `flushRuntime(ticks)` — yield N macrotasks
- `summarizeActiveProject(runtime)` — summary проекта: tracks, clips, effects, text, resources
- `summarizeRootState(runtime)` — root attrs: selectedEntityId, selectedClipSummary, etc.
- `getRootScope(runtime)` / `getActiveProjectScope(runtime)` — direct scope accessors

### `test/repl/debugGraphDiff.testing.ts`

Сравнение графа до/после action:

```ts
import { diffGraph } from './debugGraphDiff.testing'

const before = pageRuntime.debugDumpGraph()
await dispatchSomething()
const after = pageRuntime.debugDumpGraph()
const diff = diffGraph(before, after)
console.log(diff.summary) // { addedCount, removedCount, changedCount }
```

### `test/repl/debugTaskQueue.testing.ts`

Инспекция runtime task facade (для $fx_ tasks на page side):

```ts
import { createDebugRuntimeTaskFacade } from './debugTaskQueue.testing'

const { facade, debugDumpTasks } = createDebugRuntimeTaskFacade()
facade.dispatchTask('$fx_renderExport', { data: { projectId: 'p1' } })
console.log(debugDumpTasks()) // { active: [...], completed: 0, dropped: 0 }
```

### `src/video-editor/app/testing/runtimeWaits.testing.ts`

Polling helpers для случаев где event-driven недоступен (например bootstrap initialization):

```ts
import { waitForRuntimeReadyOrThrowTesting, waitForActiveProjectScopeTesting } from './testing/runtimeWaits.testing'
```

**Эти helpers — polling-based. Используй только для bootstrap/initialization. Для pipeline completion — `createExportCompletionTracker`.**

## Паттерны из DKT framework

### waitFlow

Базовый DKT helper — ждёт когда flow queue пустеет:

```js
function waitFlow(app_model) {
    return new Promise((resolve) => {
        app_model.input(() => {
            app_model._calls_flow.whenReady(() => resolve(app_model))
        })
    })
}
```

Используется в DKT тестах для ожидания завершения всех flow steps после dispatch.

### tick + waitFlow pattern

Стандартный паттерн в DKT тестах:

```js
await waitFlow(app)
dispatch('someAction')
await tick()        // setTimeout(resolve, 0)
await waitFlow(app)
await tick()
await waitFlow(app)
// now check state
```

### computed() / flush()

Для runtime-level idle:

```js
const inited = await testingInit(AppRoot)
const { computed } = inited
await computed()    // runtime.whenAllReady
```

### settle() — multi-round convergence

Для integration тестов с worker-page boundary:

```js
for (let i = 0; i < 20; i++) {
    await boundary.waitForIdle()
    await waitForFlowReady(flow)
    await waitForViewRuntimeIdle(viewRuntime)
    if (boundary.isIdle() && allQueuesEmpty) return
}
```

## Чеклист для новых тестов

1. Используй `createExportCompletionTracker` для ожидания экспорта
2. Используй `waitForRuntimeReady` для bootstrap
3. Используй `diffGraph` для проверки structural changes
4. Используй `summarizeActiveProject` для проверки domain state
5. **Не** использай `setTimeout` loops для ожидания state changes
6. **Не** забывай `tracker.destroy()` после использования
7. **Все** `.testing.ts` файлы — только для тестов и REPL
