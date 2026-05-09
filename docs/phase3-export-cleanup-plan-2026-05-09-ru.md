# Phase 3 Export Cleanup: финальный дизайн и план исправлений

Дата: 2026-05-09
Статус: draft

## Диагноз: текущие проблемы

### 1. Dual-path: trigger + $fx_ одновременно

SessionRoot out-effect `requestExport` объявлен с `trigger: ['exportRequestIntent']` и `require: ['exportRequestIntent']`.
Одновременно три multi-step action'а на шаге 2 отправляют `$fx_requestExport` с `intent: 'call'`.

Оба пути вызывают одну и ту же `fn` в `requestExport` effect. DKT framework поддерживает `intent: 'call'` для produce-эффектов (через `runFxTask → executeOutputTask`), но trigger-based путь **конкурирует** с $fx_ путём.

**Риск**: double execution — `exportRequestIntent` записывается в step 1, trigger срабатывает немедленно; затем step 2 ставит fx task, который на transaction end вызывает ту же fn.

### 2. Мёртвый код в Clip

Clip содержит:
- `exportRequestIntent` attr (line 53)
- `requestClipExport` out-effect (lines 137-151)
- `requestClipExport` action (lines 523-558)
- `setExportProgress` action (lines 507-521)
- `exportProgress` attr (line 64)
- `exportRuntime` api declaration (line 134)

Ни один из этих компонентов не используется: adapter вызывает root-level actions, не scoped clip actions.

### 3. `exportRequestIntent` на SessionRoot — избыточный trigger

После удаления trigger из out-effect, `exportRequestIntent` attr становится неиспользуемым. Step 2 `$fx_requestExport` получает payload через `$output` (переданный через `exportFxPayload: ['$output']`), не через чтение attr.

## Целевой дизайн

### Принципы

1. `$fx_` intent `call` — единственный способ запуска out-effect'ов. Никаких trigger-attr.
2. Один путь: action step 1 пишет state → action step 2 вызывает $fx_ → fx task queue → transaction end → `executeOutputTask` → effect fn → runtime publish.
3. Clip не участвует в экспорте. Все export actions — root-level на SessionRoot.
4. Тесты знают когда вычисления завершены через explicit completion helpers, не через polling.

### Flow E2E: export проекта

```
[UI: Toolbar]
  actions.requestProjectExport()
    │
    ▼
[Adapter]
  dispatchRoot('requestProjectExport', { id, initiatedBy })
    │
    ▼  (pageRuntime.dispatchAction → DKT_MSG.DISPATCH_ACTION)
    │
═══════════════════════════════════════════════════════════════
  WORKER (createMiniCutDktRuntime)
═══════════════════════════════════════════════════════════════
    │
    ▼  dispatchScopedAction('requestProjectExport', payload)
    │
    ▼  SessionRoot action: sessionRequestProjectExportAction
    │
    │  Step 1 (fn):
    │    deps: sourceProjectId, fps, width, height, duration,
    │          < @all:clipRenderData < activeProject.tracks.clips, _node_id
    │    → buildExportPlan(...)
    │    → write:
    │        exportRequest ← { id, range, format, plan, requestedAt, initiatedBy }
    │        exportProgress ← { stage: 'queued', progress: 0, ... }
    │        $output ← request object (payload для step 2)
    │
    │  Step 2 ($fx_requestExport, intent: 'call'):
    │    → enqueueFxTask({ effect_name: '$fx_requestExport', intent: 'call', payload })
    │
    │  Transaction end:
    │    → handleFxTransactionEnd
    │    → runFxTask: case 'call'
    │    → executeOutputTask(sessionRoot, 'requestExport', { payload })
    │
    ▼  Effect fn: requestExport
    │    api: ['exportRuntime']  →  resolved from interfaces
    │    fn: runtime.requestExport(intent)
    │
    ▼  exportRuntime interface (registered at runtime.start)
    │    requestExport(payload) → publishExportRequest(payload)
    │
    ▼  publishExportRequest
    │    → transport.send({ type: DKT_MSG.EXPORT_REQUEST, payload })
    │
═══════════════════════════════════════════════════════════════
  PAGE (createMiniCutPageSyncRuntime)
═══════════════════════════════════════════════════════════════
    │
    ▼  handleMessage: DKT_MSG.EXPORT_REQUEST
    │    → exportRequestListeners.forEach(fn → fn(payload))
    │
    ▼  subscribeToExportRequests (createVideoEditorHarness.ts)
    │
    │  startRequest(request):
    │    → resolveExportPlanClipSources(plan, resourceResolver)
    │    → env.export.renderer.render(...)
    │    → progress callback:
    │        dktPort.dispatch('setExportProgress', { id, range, stage, progress })
    │    → on complete:
    │        env.export.cachedResults.set(request.id, { downloadUrl, blob })
    │        dktPort.dispatch('setExportProgress', { stage: 'done', ... })
    │        dktPort.dispatch('consumeExportRequest', { id })
    │
    ▼  Progress dispatch летит обратно в worker:
    │    pageRuntime → DKT_MSG.DISPATCH_ACTION('setExportProgress', ...)
    │    → SessionRoot.setExportProgress → exportProgress attr updated
    │
═══════════════════════════════════════════════════════════════
  UI (React)
═══════════════════════════════════════════════════════════════
    │
    ▼  useRootAttrs(['exportProgress']) → React re-render
    │    → Toolbar.tsx: progress bar / download link / error
    │    → InspectorExportTabPanel.tsx: same
    │
    ▼  actions.getCachedExportUrl(exportId) → DI registry lookup
```

### Изоляция контекста worker-page

```
┌─────────────────────────────────────────────┐
│ WORKER (authoritative DKT runtime)          │
│                                             │
│  SessionRoot model                          │
│    attrs:                                   │
│      exportRequest: ExportRequestState|null │  ← persisted state (synced to page)
│      exportProgress: ExportProgressState|null│  ← progress (synced to page)
│    effects.out:                             │
│      requestExport: { api, fn }             │  ← callable через $fx_, БЕЗ trigger
│    actions:                                 │
│      requestProjectExport  (2-step)         │
│      requestClipExport     (2-step)         │
│      requestSelectedClipExport (2-step)     │
│      setExportProgress                      │
│      consumeExportRequest                   │
│                                             │
│  no: exportRequestIntent                    │  ← УДАЛИТЬ
└─────────────┬───────────────────────────────┘
              │ DKT transport (postMessage/MemoryTransport)
              │
              │ Messages:
              │   DISPATCH_ACTION  → (dispatch, setExportProgress, etc.)
              │   SYNC_HANDLE      → (state sync updates)
              │   EXPORT_REQUEST   → (out-effect publishes to page)
              │
┌─────────────▼───────────────────────────────┐
│ PAGE (sync runtime + harness)               │
│                                             │
│  PageSyncRuntime                            │
│    subscribeExportRequests(listener)        │  ← channel-based, получает EXPORT_REQUEST
│    subscribeRootAttrs(['exportRequest'], cb)│  ← attr-based fallback (УДАЛИТЬ)
│                                             │
│  createVideoEditorHarness                   │
│    subscribeToExportRequests()              │  ← единственный subscriber
│      → channel: subscribeExportRequests     │
│      → startRequest → render → dispatch    │
│                                             │
│  env.export.cachedResults                  │  ← DI-only, не в state
└─────────────────────────────────────────────┘
```

## Файлы для изменения

### 1. `src/video-editor/models/SessionRoot.ts`

**Удалить**: `exportRequestIntent` attr (line 35)
**Изменить**: out-effect `requestExport` — убрать `trigger` и `require` (lines 102-103)

Было:
```ts
exportRequestIntent: ['input', null as ExportRequestState | null],

// ...

out: {
    requestExport: {
        api: ['exportRuntime'],
        trigger: ['exportRequestIntent'],       // ← УДАЛИТЬ
        require: ['exportRequestIntent'],       // ← УДАЛИТЬ
        create_when: { api_inits: true },
        fn: (api: unknown, state: unknown) => {
            // ...
            const intentFromState = (state as { exportRequestIntent?: unknown } | null)?.exportRequestIntent
            const intent = intentFromTask || intentFromState  // ← упростить
            // ...
            runtime.requestExport(intent)
        },
    },
},
```

Станет:
```ts
// exportRequestIntent: УДАЛЁН

out: {
    requestExport: {
        api: ['exportRuntime'],
        create_when: { api_inits: true },
        fn: (api: unknown, state: unknown) => {
            const runtime = api as { requestExport?: (payload: unknown) => void } | null
            const taskPayload = (state as { payload?: unknown } | null)?.payload
            if (!runtime || typeof runtime.requestExport !== 'function' || !taskPayload || typeof taskPayload !== 'object') {
                debugExport('skip requestExport effect', {
                    hasRuntime: Boolean(runtime && typeof runtime.requestExport === 'function'),
                    hasPayload: Boolean(taskPayload),
                })
                return
            }
            debugExport('requestExport effect -> runtime', {
                id: (taskPayload as { id?: unknown }).id,
                range: (taskPayload as { range?: unknown }).range,
            })
            runtime.requestExport(taskPayload)
        },
    },
},
```

Ключевое изменение: `state` для callable out-effect теперь содержит `{ payload }` от `$fx_` task, не attr-based trigger. Effect fn читает `state.payload`.

### 2. `src/video-editor/models/SessionRoot/actions.ts`

**Изменить**: три export action'а — убрать `exportRequestIntent` из targets и return values.

#### `sessionRequestProjectExportAction` (lines 589-642)

Было:
```ts
to: {
    exportRequest: ['exportRequest'],
    exportRequestIntent: ['exportRequestIntent'],   // ← УДАЛИТЬ
    exportProgress: ['exportProgress'],
    exportFxPayload: ['$output'],
},
// return:
{
    exportRequest: request,
    exportRequestIntent: request,    // ← УДАЛИТЬ
    exportProgress: ...,
    exportFxPayload: request,
},
```

Станет:
```ts
to: {
    exportRequest: ['exportRequest'],
    exportProgress: ['exportProgress'],
    exportFxPayload: ['$output'],
},
// return:
{
    exportRequest: request,
    exportProgress: createQueuedProgressState(id, range, initiatedBy),
    exportFxPayload: request,
},
```

Аналогично для `sessionRequestClipExportAction` и `sessionRequestSelectedClipExportAction`.

**Изменить**: `SessionStateFields` type — убрать `exportRequestIntent`.

### 3. `src/video-editor/models/Clip.ts`

**Удалить**:
- `exportRequestIntent` attr (line 53)
- `exportProgress` attr (line 64)
- `exportRuntime` api (line 134)
- `requestClipExport` out-effect (lines 137-151)
- `requestClipExport` action (lines 523-558)
- `setExportProgress` action (lines 507-521)
- Import `ExportProgressState` type

### 4. `src/video-editor/app/createVideoEditorHarness.ts`

**Изменить**: `subscribeToExportRequests()` — убрать root-attr fallback.

Было (lines 497-513):
```ts
const unlistenExportRequest = pageRuntime.subscribeExportRequests?.((payload) => {
    const request = parseExportRequest(payload)
    if (!request) { return }
    startRequest(request)
}) ?? EMPTY_CLEANUP
const unlistenRootExportRequest = pageRuntime.subscribeRootAttrs(['exportRequest'], tryStartFromRootAttr)
tryStartFromRootAttr()
```

Станет:
```ts
const unlistenExportRequest = pageRuntime.subscribeExportRequests?.((payload) => {
    const request = parseExportRequest(payload)
    if (!request) { return }
    startRequest(request)
}) ?? EMPTY_CLEANUP
```

Удалить: `tryStartFromRootAttr` функцию, `subscribeRootAttrs` fallback, initial `tryStartFromRootAttr()`.

### 5. `src/video-editor/ui/dkt/shapes.ts`

**Проверить**: `attrs` array содержит `'exportRequest'` (line 43). После удаления `subscribeRootAttrs(['exportRequest'], ...)` fallback — `exportRequest` больше не читается на page side через shapes. Но он всё ещё синхронизируется через SYNC_HANDLE. **Оставить** — может понадобиться для debug/inspector.

### 6. Тестовые файлы

- `createMiniCutDktRuntime.exportRequest.test.ts` — обновить если нужно
- Новый helper: `test/repl/exportCompletion.testing.ts` (см. отдельный документ)

## Пошаговый план

### Step 1: Удалить `exportRequestIntent` из SessionRoot model

**Файл**: `src/video-editor/models/SessionRoot.ts`

1. Удалить attr declaration: `exportRequestIntent: ['input', null as ExportRequestState | null]`
2. В out-effect `requestExport`:
   - Удалить `trigger: ['exportRequestIntent']`
   - Удалить `require: ['exportRequestIntent']`
   - Упростить fn: читать payload из `state.payload` (от `$fx_` callable), убрать `intentFromState` ветку
3. Удалить import `ExportRequestState` из model file если не используется в type position

**Verify**: `npm run tsc --noEmit`

### Step 2: Обновить три export action'а

**Файл**: `src/video-editor/models/SessionRoot/actions.ts`

1. Убрать `exportRequestIntent: ExportRequestState | null` из `SessionStateFields`
2. В `sessionRequestProjectExportAction`: убрать `exportRequestIntent` из `to` и return
3. В `sessionRequestClipExportAction`: то же
4. В `sessionRequestSelectedClipExportAction`: то же
5. Убрать `exportRequestIntent` из `DktSessionActionPatch` если есть

**Verify**: `npm run tsc --noEmit`

### Step 3: Удалить мёртвый код из Clip

**Файл**: `src/video-editor/models/Clip.ts`

1. Удалить attr `exportRequestIntent` (line 53)
2. Удалить attr `exportProgress` (line 64)
3. Удалить `effects.api.exportRuntime` (line 134)
4. Удалить `effects.out.requestClipExport` (lines 137-151)
5. Удалить action `requestClipExport` (lines 523-558)
6. Удалить action `setExportProgress` (lines 507-521)
7. Удалить unused imports (`ExportProgressState`)

**Verify**: `npm run tsc --noEmit`

### Step 4: Убрать root-attr fallback из harness

**Файл**: `src/video-editor/app/createVideoEditorHarness.ts`

1. Удалить `tryStartFromRootAttr` функцию (lines 389-401)
2. Удалить `subscribeRootAttrs(['exportRequest'], tryStartFromRootAttr)` (line 506)
3. Удалить `tryStartFromRootAttr()` initial call (line 508)
4. Удалить `unlistenRootExportRequest` cleanup

**Verify**: `npm run repl:run` — export pipeline работает

### Step 5: Обновить тесты

1. Обновить `createMiniCutDktRuntime.exportRequest.test.ts` если ломается
2. Добавить `test/repl/exportCompletion.testing.ts` (см. план test helpers)
3. Проверить `editorHarnessAdapter.test.ts`

**Verify**: `npm run tsc --noEmit && npm run repl:run && npm run repl:playwright`

### Step 6: Обновить documentation

1. Обновить `PHASE-3-EXPORT-INTEGRATION-PLAN.md` — отметить completed
2. Обновить `dkt-editorHarnessAdapter-pure-migration-plan-2026-05-08-ru.md` — отметить Phase 3 status

## Контрольные ворота

1. **compile-green**: `npm run tsc --noEmit`
2. **smoke-green**: `npm run repl:run` — project creation + export trigger работает
3. **no dual-path**: grep подтверждает:
   - Нет `trigger: ['exportRequestIntent']` в `SessionRoot.ts`
   - Нет `exportRequestIntent` в attrs declarations
   - Нет `subscribeRootAttrs(['exportRequest']` в `createVideoEditorHarness.ts`
4. **no dead code**: grep подтверждает:
   - Нет `exportRequestIntent` в `Clip.ts`
   - Нет `requestClipExport` в `Clip.ts`
   - Нет `exportProgress` в `Clip.ts`

## Риски

| Риск | Митигация |
|---|---|
| `$fx_` callable не резолвит API вовремя | `create_when: { api_inits: true }` + waiting queue; `drop_when_api_not_ready: false` |
| effect fn payload shape изменился (был attr-based, стал task-based) | `$fx_` intent `call` передаёт `task.payload` → effect fn читает `state.payload`; проверить shape совпадает |
| `subscribeExportRequests` channel может потерять сообщение при reconnect | `exportRequest` attr сохраняется в state; при reconnect page sync подхватит его через SYNC_HANDLE; но subscribeRootAttrs fallback убран — нужно убедиться что channel-based path надёжен |
| `consumeExportRequest` dispatch из page может гонять с state sync | Harness вызывает consumeExportRequest в finally — после done/error; это корректно |
