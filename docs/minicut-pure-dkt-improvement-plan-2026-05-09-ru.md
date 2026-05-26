# MiniCut -> Pure DKT: план улучшений

Дата: 2026-05-09  
Статус: implemented, кроме намеренно отложенного replay pending export после reconnect  
Контекст: ревью `minicut` относительно стиля `D:\code\linkcraft\src` и `D:\code\linkcraft\weather`

Смежные документы:
- `docs/dkt-addressing-and-spec-addr-ru.md`
- `docs/fx-usage-patterns-ru.md`
- `docs/dkt-editorHarnessAdapter-pure-migration-plan-2026-05-08-ru.md`
- `docs/phase3-export-cleanup-plan-2026-05-09-ru.md`

## Коротко

`minicut` уже сделал большой шаг в сторону Pure DKT: основные модели (`SessionRoot`, `Project`, `Track`, `Clip`, `Resource`, `Text`, `Effect`) описывают state, rels, derived projections и значимую часть действий декларативно. Export больше не содержит старый dual-path через `exportRequestIntent`, а `Clip` больше не владеет мертвым export state.

Изначально найденные крупные отклонения и текущий статус:

1. **Import flow был в React/UI boundary. Статус: реализовано.**  
   `MediaBin.tsx` больше не создает object URL, не читает duration, не регистрирует local resource и не решает embedded audio. UI вызывает `actions.requestImportFiles(files)`, adapter кладет `File[]` в page-side handle, `SessionRoot.requestImportFiles` вызывает `$fx_handleInputFiles`, а page executor делает browser-side подготовку и возвращает plain resource data в DKT.

2. **Export render запускался ad-hoc subscriber'ом. Статус: реализовано с осознанным page-side исполнением.**  
   `SessionRoot` строит `ExportRequestState` и вызывает `$fx_renderExport`; page boundary получает task request через generic `$fx_*` subscription, ставит задачу в `runtimeTaskFacade`, запускает `executeRenderExportTask`, пишет progress actions и completion обратно в DKT. Само кодирование остается page-side из-за browser/video API ограничений.

3. **`runtimeTaskFacade` и `$fx_*` effects выглядели как заготовка. Статус: реализовано для import/export.**  
   `$fx_handleInputFiles` и `$fx_renderExport` теперь используются production flow. Runtime task payload использует generic `runtimeHandleId` terminology; публичный import payload использует `inputBatchHandleId`, не DKT internal `runtimeRefId`.

4. **Production app содержал debug graph traversal. Статус: реализовано.**  
   Debug bridge вынесен в `src/video-editor/app/testing/installMiniCutDebugBridge.testing.ts` и подключается только под dev flag или явный `window.__MINICUT_ENABLE_DEBUG_BRIDGE__`.

5. **Мелкие несоответствия. Статус: реализовано.**  
   Page scope handle использует `_nodeId`, UI labels соответствуют WebM export, import/export task names и payload fields разведены по смыслу. Playback buffer refill больше не делает ручной `readAttrs/readOne` в React loop: решение перенесено в DKT `tickPlayback`.

Целевое направление: React инициирует intent и показывает уже синхронизированное state; DKT actions решают доменную логику и graph traversal; page/worker runtime исполняет side effects через явные interfaces/effects; non-serializable объекты остаются в runtime refs и не попадают в persisted state.

## Целевые принципы

### 1. Pure state внутри DKT

Все доменные решения должны быть внутри моделей:

- какой project активный;
- пустой ли timeline;
- добавлять ли imported video на video track;
- добавлять ли embedded audio;
- какой export range нужен;
- какие clips/resources/effects/text входят в render plan;
- какой progress/status показывать UI.

React и harness не должны обходить graph, чтобы принять доменное решение.

### 2. Side effects только на границе

Side effects допустимы в page/runtime boundary:

- `File`/`Blob`/object URL;
- metadata probing через `<video>/<audio>`;
- resource transfer registration;
- render/export;
- download auto-click;
- P2P/WebRTC/SharedWorker transport.

Но DKT должен видеть эти операции как declarative intent:

```ts
to: ['$fx_handleInputFiles', { intent: 'call', drop_when_api_not_ready: false }]
```

или как state request/runtimeRef effect, где payload сериализуем, а runtime object передан через ref.

### 3. React как тонкий UI слой

Хороший стиль, как в `weather`:

- `useAttrs`, `useRootAttrs`, `useOne`, `useMany` для отображения;
- `useActions`/`useRootDispatch` для intent;
- локальный `useState` только для UI interaction state: open menu, drag state, debounce, selected tab view, resize;
- no graph traversal для бизнес-решений.

Допустимые исключения:

- hooks/runtime layer (`dkt-react-sync`);
- explicit debug/testing utilities;
- platform bridges, которые не делают доменных решений.

## Архитектура контекстов

### Worker context

Worker содержит authoritative DKT runtime:

```text
Worker
  createMiniCutDktRuntime
    AppRoot
    SessionRoot
    Project/Track/Clip/Resource/Text/Effect graph
    DKT actions, comps, rels
    effects.api -> app/page interfaces
    effects.out / effects.in -> side-effect intents
```

Worker отвечает за:

- authoritative state;
- derived attrs/rels;
- action transaction;
- `$fx_` scheduling;
- публикацию sync diff в page;
- прием `DISPATCH_ACTION` от page.

Worker не должен владеть browser-only object URLs или DOM APIs.

### Page context

Page содержит:

```text
Page
  React UI
  PageSyncRuntime / ReactSyncReceiver
  harness platform
  resource transfer manager
  export renderer
  runtime task executor
  object URL registry
```

Page отвечает за:

- UI rendering;
- передачу user intent в DKT;
- выполнение browser APIs;
- хранение runtime refs для `File`, `Blob`, callbacks;
- dispatch progress/results обратно в DKT.

Page не должен вручную вычислять доменные projections через `readMany/readAttrs`, если это можно описать DKT attr/rel/action.

## Flow данных: import files

### Текущий flow

```text
React MediaBin
  input.files
  getFileKind(file)
  createObjectUrl(file)
  getImportedResourceDuration(objectUrl, kind)
  dispatch('importResource', resource attrs)
  readAttrs(projectScope, ['timelineDuration'])
  if empty video -> dispatch('addEmbeddedAudioToTimeline')
  resourceTransferManager.registerLocalResource(...)
```

Проблема: UI layer решает доменную часть (`timelineDuration`, embedded audio) и исполняет side effects в одном callback.

### Целевой flow

```text
React MediaBin
  onChange(files)
    -> actions.requestImportFiles(files)

Page adapter/runtime boundary
  putRuntimeRef(files)
  dispatch root/project action:
    requestImportFiles({ inputBatchHandleId, source: 'file-input' })

Worker DKT
  SessionRoot.requestImportFiles
    -> delegates to activeProject OR writes command state
  Project.requestImportFiles
    -> to ['$fx_handleInputFiles', { intent: 'call' }]
    -> payload: { projectId, inputBatchHandleId, addToTimelineWhenEmpty: true }

Page runtime task executor
  consumeInputBatchHandle(inputBatchHandleId) -> File[]
  for each file:
    getFileKind
    createObjectUrl
    getImportedResourceDuration
    registerLocalResource
    dispatch Project.importResourcePrepared(...)

Worker DKT
  Project.importResourcePrepared
    step 1 creates Resource
    step 2 conditionally adds video/image clip
    step 3 conditionally adds embedded audio clip
    step 4 updates import progress/status

React
  reads resources/clips/importProgress through sync state
```

### Вариант деклараций

Файл: `src/video-editor/models/Project.ts`

```ts
import {
  PROJECT_IMPORT_FILES_FX,
  createProjectImportFilesEffectPayload,
} from './Project/effects'

requestImportFiles: {
  to: ['$fx_handleInputFiles', { intent: 'call', drop_when_api_not_ready: false }],
  fn: [
    ['sourceProjectId'] as const,
    (payload: unknown, sourceProjectId: unknown) => {
      const value = payload as { inputBatchHandleId?: unknown } | null
      if (typeof sourceProjectId !== 'string' || !sourceProjectId) return '$noop'
      if (typeof value?.inputBatchHandleId !== 'string') return '$noop'

      return {
        projectId: sourceProjectId,
        inputBatchHandleId: value.inputBatchHandleId,
        addToTimelineWhenEmpty: true,
      }
    },
  ],
}
```

Если runtimeRef передается через существующий `runtimeTaskFacade`, лучше не класть сам `File[]` в action payload. Payload должен быть сериализуемым:

```ts
{
  inputBatchHandleId: 'ib_1',
  data: {
    projectId: 'project:abc',
    addToTimelineWhenEmpty: true,
  },
}
```

### Подготовленный import result

Executor должен вернуть в DKT только plain data:

```ts
type PreparedImportedResource = {
  sourceResourceId: string
  name: string
  kind: 'video' | 'audio' | 'image'
  url: string
  mime: string
  duration: number
  size: number
  source: {
    kind: 'local'
    ownerPeerId: string | null
  }
  status: 'ready'
  data: {
    status: 'ready'
    chunkSize: number
    chunks: {}
    ranges: { loaded: Array<[number, number]>; requested: [] }
    loadedBytes: number
  }
}
```

`Project.importResource` уже близок к нужному стилю. Его можно переиспользовать или переименовать в более точное `importResourcePrepared`.

### Как решать embedded audio без UI reads

Сейчас `MediaBin.tsx` читает `timelineDuration`. Это нужно перенести в DKT:

```ts
importResourcePrepared: [
  {
    to: {
      resource: ['<< resource << #', { method: 'at_end', can_create: true, can_hold_refs: true }],
      resources: ['<< resources', { method: 'at_end', can_use_refs: true }],
      prepared: ['$output'],
    },
    fn: [
      ['< @all:sourceClipId < tracks.clips', 'sourceProjectId'] as const,
      reduceImportResourceCreate,
    ],
  },
  {
    when: [
      ['timelineDuration'] as const,
      (payload, timelineDuration) => {
        const resource = (payload as { resource?: { kind?: unknown } } | null)?.resource
        return resource?.kind === 'video' && Number(timelineDuration) <= 0
      },
    ],
    to: ['<< primaryAudioTrack', { action: 'addClip', inline_subwalker: true }],
    fn: [
      ['$noop', '< @all:timelineClipSource < resources', '< @one:appendStart < primaryAudioTrack'] as const,
      reduceAddEmbeddedAudio,
    ],
  },
]
```

Важная деталь: если step 1 создает resource, а step 2 читает `resources`, нужно убедиться, что `$output`/transaction order дает step 2 доступ к актуальному graph state. Если нет, step 2 должен использовать payload из `$output`, а не повторно искать resource через rel.

## Flow данных: export

### Было до миграции

```text
Toolbar / Inspector
  actions.requestProjectExport()
  actions.requestSelectedClipExport()

Adapter
  dispatchRoot('requestProjectExport' | 'requestSelectedClipExport')

Worker DKT
  SessionRoot action builds ExportRequestState
  sets exportRequest/exportProgress
  calls $fx_requestExport

Worker out-effect
  exportRuntime.requestExport(payload)
  publishes DKT_MSG.EXPORT_REQUEST

Page harness
  subscribeExportRequests(payload)
  render(request.plan)
  setExportProgress
  cache Blob URL in env.export.cachedResults
  consumeExportRequest
```

Это было чище старого dual-path, но render execution жил вне общей `$fx_` task architecture.

### Реализованный flow

```text
React
  useRootDispatch('requestProjectExport')

Worker DKT
  SessionRoot.requestProjectExport
    step 1: build plan from activeProject graph
    step 2: set exportRequest/exportProgress
    step 3: to ['$fx_renderExport', { intent: 'call', queue_policy: 'replace-last' }]

Page effect executor
  receives $fx_renderExport task request through generic page runtime task subscription
  runtimeTaskFacade.dispatchTask(PROJECT_RENDER_EXPORT_FX, ..., queuePolicy: 'replace-last')
  executeRenderExportTask(...)
  resolve resource URLs via ResourceTransferManager
  env.export.renderer.render(...)
  dispatch setExportProgress(rendering/finalizing/done/error)
  create object URL
  cache export URL page-side by exportId
  dispatch setExportProgress(done + fileName)
  dispatch consumeExportRequest

React
  useRootAttrs(['exportProgress'])
  gets download URL through page-side export cache by exportId
```

### Почему это лучше

- Один execution path: DKT action -> `$fx_renderExport`.
- Queue policy можно выразить явно (`replace-last` для повторных export clicks).
- Progress/error/completion становятся частью DKT action contract.
- Channel loss/reconnect replay для pending export намеренно не исправлялся в этой итерации: `exportRequest` остается в DKT state, но автоматический re-run executor после reconnect не добавлялся.

### Пример декларации export action

Файл: `src/video-editor/models/SessionRoot/actions.ts`

```ts
export const sessionRequestProjectExportAction = [
  {
    to: {
      exportRequest: ['exportRequest'],
      exportProgress: ['exportProgress'],
      exportFxPayload: ['$output'],
    },
    fn: [
      [
        '< @one:sourceProjectId < activeProject',
        '< @one:fps < activeProject',
        '< @one:width < activeProject',
        '< @one:height < activeProject',
        '< @one:duration < activeProject',
        '< @all:clipRenderData < activeProject.tracks.clips',
        '_node_id',
      ] as const,
      (payload, sourceProjectId, fps, width, height, duration, clipSources, sessionRootNodeId) => {
        const plan = buildExportPlan(sourceProjectId, fps, width, height, duration, clipSources)
        if (!plan) return '$noop'

        const id = readExportId(payload) ?? createExportRequestId()
        const range = { type: 'project' as const }
        const request = {
          id,
          range,
          format: 'video-webm' as const,
          plan,
          requestedAt: Date.now(),
          initiatedBy: readInitiator(payload) ?? sessionRootNodeId,
        }

        return {
          exportRequest: request,
          exportProgress: createQueuedProgressState(id, range, request.initiatedBy),
          exportFxPayload: {
            request,
            queueKey: 'project',
          },
        }
      },
    ],
  },
  {
    to: ['$fx_renderExport', {
      intent: 'call',
      drop_when_api_not_ready: false,
      queue_policy: 'replace-last',
    }],
    fn: (payload) => payload && typeof payload === 'object' ? payload : '$noop',
  },
] as const
```

Если текущий DKT core не поддерживает `queue_policy` в `$fx_` target options, policy остается в page-side `runtimeTaskFacade.dispatchTask(..., { queuePolicy: 'replace-last', intentKey })`, но action payload должен содержать `queueKey`.

## Flow данных: resource transfer projection

Сейчас `createVideoEditorHarness.ts` подписывается на active project/resources и вручную читает resource attrs:

```text
pageRuntime.readOne(root, 'activeProject')
pageRuntime.readMany(project, 'resources')
pageRuntime.readAttrs(resource, [...])
resourceTransferManager.syncResources(...)
```

Это boundary-код, но он все равно делает graph traversal. Более Pure DKT вариант:

1. На `Resource` сделать comp attr `transferSnapshot`.
2. На `Project` сделать comp attr `resourceTransferManifest`.
3. Harness подписывается только на один attr active project manifest.

Пример:

```ts
// Resource.ts
transferSnapshot: ['comp', [
  'sourceResourceId',
  'name',
  'kind',
  'url',
  'mime',
  'duration',
  'width',
  'height',
  'size',
  'source',
  'status',
  'data',
] as const, reduceResourceTransferSnapshot]
```

```ts
// Project.ts
resourceTransferManifest: [
  'comp',
  ['< @all:transferSnapshot < resources'] as const,
  (items: unknown[]) => Array.isArray(items) ? items.filter(Boolean) : [],
]
```

Тогда page boundary:

```ts
const unsubscribe = pageRuntime.subscribeAttrs(projectScope, ['resourceTransferManifest'], () => {
  const { resourceTransferManifest } = pageRuntime.readAttrs(projectScope, ['resourceTransferManifest'])
  resourceTransferManager.syncResources(normalizeManifest(resourceTransferManifest))
})
```

Да, это все еще readAttrs на boundary, но без ручного обхода graph и без знания структуры `Resource`.

## React и DI/API boundary

### Целевой public API для React

`VideoEditorHarnessActions` должен быть тонким:

```ts
export interface VideoEditorHarnessActions {
  createProject(title?: string): void
  setActiveProject(projectId: string): void
  addTextClip(content?: string): void
  requestImportFiles(files: FileList | File[]): void
  requestProjectExport(): void
  requestSelectedClipExport(): void
  getCachedExportUrl(exportId: string): string | null
  setCursor(value: number): void
}
```

React не должен получать `env.media`, `env.transfers`, `platform` напрямую для import business flow.

### Adapter responsibilities

Файл: `src/video-editor/app/editorHarnessAdapter.ts`

Разрешено:

- генерировать boundary IDs;
- класть runtime objects в runtime ref registry;
- dispatch root/project action;
- читать root scope id для dispatch target;
- читать page-local cache (`getCachedExportUrl`).

Нежелательно:

- `readOne/readMany/readAttrs` для доменных решений;
- object URL/duration probing;
- conditional add embedded audio;
- export plan fallback;
- hidden fallback на selected clip.

### DI preparation for importResource

Нужен явный page-side executor:

```ts
type ImportFilesRuntimeApi = {
  getFileKind(file: File): ResourceKind | null
  createObjectUrl(file: File): string | null
  getImportedResourceDuration(url: string, kind: ResourceKind): Promise<number>
  registerLocalResource(resourceId: string, file: File, snapshot: ResourceSnapshot): void
  getOwnerPeerId(): string | null
}
```

В `createVideoEditorHarness.ts` собрать api из существующих частей:

- `platform.createObjectUrl`
- `platform.getImportedResourceDuration`
- `resourceTransferManager.registerLocalResource`
- `authorityClient.peerId`
- `resourceChunkSize`

Executor должен принимать только task descriptor и dispatch port:

```ts
executeImportFilesTask({
  task,
  runtimeTasks,
  importApi,
  dktPort,
})
```

Это позволит тестировать import executor отдельно без React.

## Адреса и декларации: практические правила

### Читать через graph traversal только в deps

Хорошо:

```ts
fn: [
  ['< @all:clipRenderData < activeProject.tracks.clips'] as const,
  (_payload, clipRenderData) => buildSomething(clipRenderData),
]
```

Плохо:

```ts
const tracks = pageRuntime.readMany(projectScope, 'tracks')
const clips = tracks.flatMap((track) => pageRuntime.readMany(track, 'clips'))
```

Исключение: debug/testing/runtime sync internals.

### В `to` использовать nesting target

```ts
to: ['<< activeProject', { action: 'handleInit', inline_subwalker: true }]
```

Для deps голый `<< activeProject` без zip не использовать. В deps нужен `<< @one:activeProject` или state traversal:

```ts
'< @one:sourceProjectId < activeProject'
```

### `$output` для передачи между шагами

Если step 2 должен получить результат step 1:

```ts
[
  {
    to: {
      payloadForNextStep: ['$output'],
    },
    fn: () => ({ payloadForNextStep: { id: 'x' } }),
  },
  {
    to: ['$fx_someEffect', { intent: 'call' }],
    fn: (payload) => payload,
  },
]
```

Не рассчитывать, что payload автоматически перейдет между steps.

### `$noop` как token, а не строка

Если нужен настоящий noop:

```ts
fn: [
  ['$noop', 'duration'] as const,
  (_payload, noop, duration) => {
    if (Number(duration) <= 0) return noop
    return { duration }
  },
]
```

В простых `fn: (payload) => '$noop'` текущий код уже использует строку. Это работает только если DKT pass нормализует строковый sentinel в этой позиции. Для новых сложных actions безопаснее использовать dep token.

### `$fx_` callable out-effect

Для produce/out-effect читать `state.payload`, не attrs:

```ts
out: {
  $fx_requestExport: {
    api: ['exportRuntime'],
    create_when: { api_inits: true },
    fn: (api: unknown, state: unknown) => {
      const payload = (state as { payload?: unknown } | null)?.payload
      if (!payload) return
      ;(api as ExportRuntime).requestExport(payload)
    },
  },
}
```

Не смешивать `trigger`/`require` с `$fx_` call для того же эффекта.

## Конкретные изменения по файлам

### Phase 1: мелкие fixes — сделано

Файлы:

- `src/video-editor/app/editorHarnessAdapter.ts`
- `src/video-editor/components/inspector/InspectorExportTabPanel.tsx`
- тесты рядом с затронутыми файлами

Изменения:

1. `_node_id` заменить на `_nodeId` в `getRootNodeId`.
2. В inspector заменить `Format MP4` на `WebM` или вывести из `ExportRequestState.format`.
3. Проверить все user-facing labels на `MP4` vs `video-webm`.

Быстрые проверки:

```bash
npm run test:video-editor -- src/video-editor/app/runtimeTaskFacade.test.ts
npm run test:video-editor -- src/video-editor/dkt/runtime/createMiniCutDktRuntime.exportRequest.test.ts
```

### Phase 2: import boundary API — сделано

Файлы:

- `src/video-editor/app/actionRuntimeTypes.ts`
- `src/video-editor/app/editorHarnessAdapter.ts`
- `src/video-editor/app/editorActionEnvironment.ts`
- `src/video-editor/app/createVideoEditorHarness.ts`
- `src/video-editor/components/MediaBin.tsx`
- `src/video-editor/models/Project/effects.ts`
- новый файл: `src/video-editor/app/importFilesTaskExecutor.ts`

Изменения:

1. Добавить `actions.requestImportFiles(files)`.
2. В adapter класть `files` в runtime ref и dispatch-ить DKT action.
3. Убрать из `MediaBin.tsx` object URL/duration/registerLocalResource logic.
4. Сделать executor, который потребляет runtime ref и dispatch-ит prepared resource data.
5. Сохранить текущие UI props только для отображения transfer state.

Быстрые проверки:

```bash
npm run test:video-editor -- src/video-editor/dkt/importTasks.test.ts
npm run test:video-editor -- src/video-editor/models/Project/effects.test.ts
npm run test:video-editor -- src/video-editor/models/Project/actions.test.ts
npm run test:video-editor -- src/video-editor/dkt/models/addResourceToTimeline-appendStart.test.ts
```

### Phase 3: DKT import action — сделано

Файлы:

- `src/video-editor/models/Project.ts`
- `src/video-editor/models/Project/actions.ts`
- `src/video-editor/models/Resource/effects.ts`
- `src/video-editor/models/Resource/actions.ts`

Изменения:

1. Добавить/уточнить action `requestImportFiles`.
2. Уточнить `importResource` как action для prepared plain data.
3. Embedded audio решение перенести полностью в DKT deps/when.
4. Добавить import progress attrs, если нужен UI feedback:
   - `importProgress`
   - `lastImportError`
   - `activeImportTaskId`

Быстрые проверки:

```bash
npm run test:video-editor -- src/video-editor/models/Project/actions.test.ts
npm run test:video-editor -- src/video-editor/dkt/models/addResourceToTimeline-appendStart.test.ts
npm run test:video-editor -- test/harness/harness.testing.ts
```

### Phase 4: export executor через `$fx_renderExport` — сделано

Файлы:

- `src/video-editor/models/SessionRoot.ts`
- `src/video-editor/models/SessionRoot/actions.ts`
- `src/video-editor/models/Project/effects.ts`
- `src/video-editor/app/createVideoEditorHarness.ts`
- новый файл: `src/video-editor/app/renderExportTaskExecutor.ts`
- `src/video-editor/app/runtimeTaskFacade.ts`

Изменения:

1. Оставить `SessionRoot` владельцем export state.
2. Заменить page `subscribeExportRequests` render path на task executor. Реализовано через generic `subscribeRuntimeTaskRequests(PROJECT_RENDER_EXPORT_FX, ...)`.
3. Оставить `DKT_MSG.EXPORT_REQUEST` только как compatibility/debug channel или удалить после миграции. Сейчас message остается transport-level совместимостью, но page runtime наружу отдает generic `$fx_*` task subscription.
4. Ввести queue policy:
   - project export: `replace-last`;
   - clip export: `replace-last` по `clipId`;
   - возможно `keep-first`, если UX должен игнорировать повторные клики.
5. Progress dispatch оставить через `setExportProgress`.
6. Completion dispatch:
   - `setExportProgress(done)`
   - `consumeExportRequest`
   - cache URL page-side по `exportId`.

Быстрые проверки:

```bash
npm run test:video-editor -- src/video-editor/dkt/runtime/createMiniCutDktRuntime.exportRequest.test.ts
npm run test:video-editor -- src/video-editor/app/runtimeTaskFacade.test.ts
npm run test:video-editor -- test/helpers/completion.testing.ts
npm run repl:run
```

### Phase 5: resource transfer projection — сделано

Файлы:

- `src/video-editor/models/Resource.ts`
- `src/video-editor/models/Resource/actions.ts`
- `src/video-editor/models/Project.ts`
- `src/video-editor/app/createVideoEditorHarness.ts`
- `src/video-editor/media/resourceTransferManager.ts`

Изменения:

1. Добавить `Resource.transferSnapshot`.
2. Добавить `Project.resourceTransferManifest`.
3. Harness подписывается на manifest, а не обходит `resources`.
4. Удалить `readResourceAttrs` из `createVideoEditorHarness.ts`.

Быстрые проверки:

```bash
npm run test:video-editor -- src/video-editor/media/resourceTransferManager.test.ts
npm run test:video-editor -- src/video-editor/media/resourceTransferScheduler.test.ts
npm run test:integration:p2p -- tests/integration/p2p-media-transfer.spec.ts
```

Если `npm run test:integration:p2p -- <file>` не прокидывает file arg через script, запускать напрямую:

```bash
npx playwright test -c playwright.p2p.config.js tests/integration/p2p-media-transfer.spec.ts
```

### Phase 6: debug bridge cleanup — сделано

Файлы:

- `src/video-editor/app/VideoEditorHarnessApp.tsx`
- новый файл: `src/video-editor/app/testing/installMiniCutDebugBridge.testing.ts`
- `test/repl/*`
- `tests/integration/*`

Изменения:

1. Вынести `window.__MINICUT_P2P_DEBUG__` builder из production component.
2. Оставить в production только условный install:

```ts
if (import.meta.env.DEV || globalThis.__MINICUT_ENABLE_DEBUG_BRIDGE__ === true) {
  installMiniCutDebugBridge(ownedHarness)
}
```

3. Все helper methods с graph traversal маркировать `testing/debug`.
4. Production UI не должен импортировать debug-only graph summarizers.

Быстрые проверки:

```bash
npm run repl:playwright:runtime
npm run test:integration:fast -- tests/integration/video-editor.spec.ts
```

## Быстрый grep-контроль

После фаз полезно проверять:

```bash
rg -n "exportRequestIntent|buildFallbackExportPlan|dispatchClipActionById" src test tests
```

Ожидаемо: нет production hits.

```bash
rg -n "readOne\\(|readMany\\(|readAttrs\\(" src/video-editor src/dkt-react-sync
```

Ожидаемо:

- разрешено в `src/dkt-react-sync/**`;
- разрешено в `*.test.*`, `*.testing.*`, `test/**`;
- ограниченно разрешено в page runtime boundary;
- нежелательно в React feature components и adapter business flow.

```bash
rg -n "MP4|video-webm|webm" src/video-editor/components src/video-editor/app src/video-editor/models
```

Ожидаемо: UI labels соответствуют реальному формату.

```bash
rg -n "_node_id|_nodeId" src/video-editor/app src/dkt-react-sync
```

Ожидаемо: page `ReactSyncScopeHandle` использует `_nodeId`; DKT/worker model internals могут использовать `_node_id`.

## Рекомендуемый порядок работ

1. Сделано: мелкие fixes (`_nodeId`, `WebM` label).
2. Сделано: введен `requestImportFiles` API и `$fx_handleInputFiles` executor.
3. Сделано: `MediaBin` переключен на новый API.
4. Сделано: embedded audio решение перенесено из UI в DKT; UI больше не читает `timelineDuration` для import decision.
5. Сделано: export render запускается через `$fx_renderExport` task executor; page-side video encoding сохранен как browser boundary.
6. Сделано: resource transfer projection добавлен через `Resource.transferSnapshot` и `Project.resourceTransferManifest`.
7. Сделано: debug bridge вынесен в testing/debug module и ставится условно.
8. Сделано: playback buffer refill decision перенесен из React loop в DKT `tickPlayback`.
9. Намеренно не сделано: automatic replay pending export task после channel/page reconnect.

Такой порядок минимизировал риск: сначала были исправлены явные мелочи, затем import как более локальный side-effect pipeline, затем export как более сложный pipeline, потом cleanup traversal/debug и оставшиеся UI graph reads.

## Итог реализации

План можно считать реализованным в рамках оговоренной границы: React больше не исполняет import file side effects, import/export идут через DKT actions и `$fx_*` executors, resource transfer получает DKT manifest, debug traversal вынесен из production component, а мелкие naming/UI label несоответствия закрыты.

Оставшееся осознанное ограничение: pending `exportRequest` в DKT state сам по себе не replay-ит `$fx_renderExport` executor после потери channel/page reconnect. Это не исправлялось по решению ревью, чтобы не усложнять queue/retry semantics в этой итерации.

## Что вышло неудачно при реализации

Промежуточная попытка переноса import flow получилась архитектурно неудачной: `editorHarnessAdapter.requestImportFiles` после `dispatchRoot('requestImportFiles', ...)` дополнительно сам создавал runtime task и запускал `executeImportFilesTask`. Формально тяжелая файловая логика уже жила в executor, но orchestration снова оказался в page/UI adapter boundary. Это противоречило цели плана: React/page action layer должен только положить `File[]` в page-side handle и отправить DKT intent.

Причина ошибки была не в необходимости fallback, а в неправильном DKT walker flow. В `SessionRoot.requestImportFiles` первый шаг отправлял payload в `Project.requestImportFiles`, но не forward-ил его через `$output`; следующий шаг `$fx_handleInputFiles` получал `null` вместо `{ inputBatchHandleId }`, поэтому `IMPORT_FILES_REQUEST` не публиковался. Правильный fix: первый step пишет одновременно в inline project action и в `$output`, а второй step уже строит `$fx_handleInputFiles` payload из forwarded input.

Также выяснилась отдельная DKT-деталь по `Project.importResource`: inline-subwalker `addClip` может менять payload следующего шага. Поэтому шаги, которым нужно сохранить исходное import decision payload, должны явно forward-ить его через `$output` object slot. Это лучше, чем полагаться на порядок шагов или скрытое mutable состояние.

Итоговое правило для дальнейших миграций: если после DKT action нужен `$fx_*` executor, нельзя добавлять page-side fallback в adapter. Сначала нужно проверить, что предыдущий saga step действительно пишет `$output`, и добавить regression test на соответствующий transport message (`IMPORT_FILES_REQUEST`, `EXPORT_REQUEST` и т.п.).

## Критерии готовности

Pure DKT improvement можно считать выполненным, когда:

- React import UI не вызывает `createObjectUrl`, `getImportedResourceDuration`, `registerLocalResource`.
- Domain decisions import/export описаны DKT actions/deps/when.
- Export render запускается через `$fx_renderExport` или эквивалентный task executor, а не через ad-hoc subscriber.
- `runtimeTaskFacade` используется production flow, а не только тестами.
- `createVideoEditorHarness.ts` не содержит ручной сборки domain projections из graph, кроме narrow boundary projections.
- Debug graph traversal вынесен из production app path.
- UI labels соответствуют фактическим formats.
- `_nodeId`/`_node_id` используются строго по контекстам: page scope handle vs worker model internals.
