# План миграции MiniCut на DKT model tree render и scoped dispatch

Дата: 2026-05-05

Цель: убрать registry snapshot / patch envelopes / command routing из основного render/write path и перейти на DKT-native схему:

```text
DKT model tree
  -> sync_sender
  -> React state replica
  -> current component scope = DKT node_id
  -> useAttrs / One / Many / Path render attrs and rels
  -> useActions dispatches to current scope
  -> worker resolves scope_node_id via getModelById
  -> targetModel.dispatch(action, payload)
```

Главное архитектурное правило: `src/dkt-react-sync` должен быть абстрактным DKT + React слоем. В нем не должно быть ни weather, ни MiniCut логики. MiniCut-специфичные transport messages, worker/session bootstrap, model action names, resource/export/P2P эффекты и video-editor UI adapters должны жить вне `src/dkt-react-sync`.

---

## 1. Эталонная идея из weather

Weather уже реализует нужную ось:

```text
React component
  -> ReactSyncScopeHandle { kind: 'scope', _nodeId }
  -> receiver.readAttrs/readOne/readMany
  -> component rerender through useSyncExternalStore
  -> runtime.getDispatch(scope)
  -> CONTROL_DISPATCH_APP_ACTION { action_name, payload, scope_node_id }
  -> worker getModelById(sessionRoot, scope_node_id)
  -> model.dispatch(action_name, payload)
```

Ключевые файлы weather:

- `D:\code\linkcraft\weather\src\dkt-react-sync\receiver\ReactSyncReceiver.ts`
- `D:\code\linkcraft\weather\src\dkt-react-sync\runtime\ReactScopeRuntime.ts`
- `D:\code\linkcraft\weather\src\dkt-react-sync\runtime\PageSyncRuntime.ts`
- `D:\code\linkcraft\weather\src\dkt-react-sync\runtime\createSyncStore.ts`
- `D:\code\linkcraft\weather\src\dkt-react-sync\scope\ScopeHandle.ts`
- `D:\code\linkcraft\weather\src\dkt-react-sync\scope\RootScope.tsx`
- `D:\code\linkcraft\weather\src\dkt-react-sync\components\One.tsx`
- `D:\code\linkcraft\weather\src\dkt-react-sync\components\Many.tsx`
- `D:\code\linkcraft\weather\src\dkt-react-sync\components\Path.tsx`
- `D:\code\linkcraft\weather\src\dkt-react-sync\hooks\useAttrs.ts`
- `D:\code\linkcraft\weather\src\dkt-react-sync\hooks\useActions.ts`
- `D:\code\linkcraft\weather\src\dkt-react-sync\hooks\useScope.ts`
- `D:\code\linkcraft\weather\src\dkt-react-sync\hooks\useShape.ts`
- `D:\code\linkcraft\weather\src\dkt-react-sync\shape\ShapeRegistry.ts`
- `D:\code\linkcraft\weather\src\dkt-react-sync\shape\defineShape.ts`
- `D:\code\linkcraft\weather\src\page\createPageSyncReceiverRuntime.ts`
- `D:\code\linkcraft\weather\src\worker\model-runtime.ts`

В MiniCut нужно переносить именно `src/dkt-react-sync` как generic слой. Weather-specific `page/createPageSyncReceiverRuntime.ts` надо использовать как образец для MiniCut adapter, но не класть его в generic folder в MiniCut.

---

## 2. Что должно быть в абстрактном `src/dkt-react-sync`

Будущая структура:

```text
src/
  dkt-react-sync/
    components/
      Many.tsx
      One.tsx
      Path.tsx
    context/
      ReactScopeRuntimeContext.tsx
      ScopeContext.tsx
    hooks/
      useActions.ts
      useAttrs.ts
      useReactScopeRuntime.ts
      useScope.ts
      useShape.ts
      useSyncRoot.ts
    receiver/
      ReactSyncReceiver.ts
    runtime/
      PageSyncRuntime.ts
      ReactScopeRuntime.ts
      createSyncStore.ts
    scope/
      RootScope.tsx
      ScopeHandle.ts
    shape/
      MountedShape.tsx
      ShapeRegistry.ts
      autoShapes.ts
      defineShape.ts
```

Допустимое содержимое:

- DKT sync protocol parsing: `SYNCR_TYPES`, compact update chunks, attrs/rels/tree root handling.
- React scope model: `{ kind: 'scope', _nodeId }`.
- Read API: `readAttrs`, `readOne`, `readMany`.
- Subscribe API: attr/one/many subscriptions.
- React bindings: `RootScope`, `One`, `Many`, `Path`, hooks.
- Shape/structure usage API: `defineShape`, `shapeOf`, `ShapeRegistry`.
- Generic runtime interfaces.
- Generic bridge callbacks: `RPCLegacy`, `updateStructureUsage`, `requireShapeForModel`.

Недопустимое содержимое:

- MiniCut action names: `addClip`, `trim`, `setEffectAmount`, `renderExport`.
- Weather action names: `retryWeatherLoad`.
- MiniCut transport enums: `DKT_MSG`, `RUNTIME_LOG_SCOPE`, P2P messages.
- Weather transport enums: `APP_MSG`.
- MiniCut model names: `Project`, `Track`, `Clip`, `Resource`.
- MiniCut registry types: `ProjectRegistry`, `PatchEnvelope`, `Command`, `DispatchResult`.
- Any app bootstrap policy: session id, P2P role, active project creation.

Если нужен app-specific runtime, он должен импортировать `src/dkt-react-sync` и жить в `src/video-editor/...`.

---

## 3. Как использовать `Path` вместо вложенных `One`

Для цепочек rels не нужно писать:

```tsx
<One rel="session">
  <One rel="activeProject">
    <Many rel="tracks" item={TrackLane} />
  </One>
</One>
```

В generic layer уже должен быть `Path.tsx`, как в weather:

```tsx
<Path rels={['session', 'activeProject']}>
  <Many rel="tracks" item={TrackLane} />
</Path>
```

`Path` рекурсивно заворачивает children в `One` по каждому rel. Это важно для MiniCut, потому что редактор будет часто переходить от root/session к active project, selected clip, selected effect, current resource и другим nested scopes.

Примеры целевого UI:

```tsx
<RootScope runtime={runtime}>
  <Path rels={['session', 'activeProject']} fallback={<EmptyProjectState />}>
    <Timeline />
  </Path>
</RootScope>
```

```tsx
const Timeline = () => (
  <Many rel="tracks" item={TrackLane} empty={<EmptyTimeline />} />
)
```

```tsx
const TrackLane = () => {
  const attrs = useAttrs(['name', 'kind', 'height'])

  return (
    <section data-track-kind={String(attrs.kind ?? '')}>
      <Many rel="clips" item={ClipItem} />
    </section>
  )
}
```

---

## 4. React оптимизации, которые нужно перенести из weather

### `useSyncExternalStore`

Weather использует `useSyncExternalStore` в `useAttrs`, `One`, `Many`, `useSyncRoot`. Это правильный React 18 API для внешнего store. MiniCut должен использовать его для подписок на DKT replica, а не дергать глобальный observable registry.

Требование: каждый component подписывается только на нужные attrs/rels текущего scope.

### `useMemo` для нормализации attr fields

`useAttrs` нормализует fields:

```ts
const normalizeFields = (fields: readonly string[]) => Array.from(new Set(fields)).sort()
const normalizedFields = useMemo(() => normalizeFields(fields), fields)
```

Это дает стабильный cache key для attrs read cache и shape cache. В MiniCut компонентах нужно передавать стабильные arrays, где возможно, но generic hook должен защищаться нормализацией.

### `useCallback` для subscribe/getSnapshot

`useAttrs` оборачивает subscribe и getSnapshot в `useCallback`, чтобы `useSyncExternalStore` не видел новые функции на каждый render без причины.

Требование: при переносе не удалять эти callbacks.

### Stable scope handles

`ReactSyncReceiver.getScope(nodeId)` кеширует `Object.freeze({ kind: 'scope', _nodeId })` в `scopesByNodeId`.

Польза:

- `WeakMap` dispatch cache работает корректно.
- React context получает стабильный object для того же node.
- `Many` key использует `_nodeId`, а не synthetic entity id.

### Stable empty values

Weather использует frozen constants:

- `EMPTY_OBJECT = Object.freeze({})`
- `EMPTY_ITEMS = Object.freeze([])`

Требование: не возвращать новый `{}` или `[]` из read APIs при каждом render.

### Attr read cache

`ReactSyncReceiver.readAttrs(nodeId, attrNames)` собирает `nextValues`, сравнивает каждое поле через `Object.is`, и если значения не изменились, возвращает прежний object reference.

Польза: component, читающий attrs, не получает новый object при unrelated updates.

### Many read cache

`readManyScopes(scope, relName)` кеширует array of scopes по `nodeId + relName` и возвращает прежний frozen array, если rel value не изменился.

Польза: списки tracks/clips/effects не получают новый array при unrelated attr updates.

### Dirty-by-name batching

Receiver собирает dirty attrs/rels/lists в maps:

```text
dirtyAttrsByNodeId: Map<nodeId, Set<attrName>>
dirtyRelsByNodeId: Map<nodeId, Set<relName>>
dirtyListsByNodeId: Map<nodeId, Set<relName>>
```

После batch update он вызывает только listeners, подписанные на конкретные измененные names. Это критично для timeline: изменение одного clip attr не должно перерисовывать весь project tree.

### Rel equality check

`sameRelValue` сравнивает one/many rel values и пропускает notify, если rel фактически не изменился.

Польза: stable rel subscriptions для больших списков.

### `scopeDispatchCache` WeakMap

Page runtime кеширует dispatch function per scope:

```ts
const scopeDispatchCache = new WeakMap<ReactSyncScopeHandle, DispatchFn>()
```

`useActions()` возвращает стабильную функцию для текущего scope. Это снижает лишние rerenders downstream, если dispatch передается в callbacks/components.

### ShapeRegistry compile/publish/request caches

`ShapeRegistry` оптимизирует structure usage:

- `compiledByShapeId`: compiled shape cache.
- `compilingShapeIds`: cycle detection.
- `publishedShapeIds`: publish only fresh shape graph chunks.
- `activeShapeRefsByNodeId`: ref counting per node/shape.
- `requestedShapeSetsByNodeId`: do not repeat `requireShapeForModel` for same node + shapeIds signature.

Это нужно перенести без MiniCut-специфики.

### Cleanup discipline

Weather использует cleanup wrappers (`once`, `EMPTY_CLEANUP`) и reverse cleanup order in shape registry. Для MiniCut это важно из-за mount/unmount активных panels, inspectors, timeline virtualized chunks.

---

## 5. Linkcraft DKT view/html render: какую идею повторить

Linkcraft HTML-DKT view устроен концептуально так же:

- `dk-rel` меняет current model scope для вложенной template subtree.
- `dk-events` отправляет event в view/model target.
- Remote form `click::dispatch:action` означает model dispatch, а не app-level registry update.
- Direct model RPC хранит `node_id` target model и args.

Ключевой перенос идеи в MiniCut React:

| Linkcraft HTML-DKT | Weather React sync | MiniCut target |
|---|---|---|
| `dk-rel="tracks"` | `<Many rel="tracks" item={TrackLane} />` | Track components render from Track model scopes |
| `dk-rel="activeProject"` | `<One rel="activeProject">` or `<Path rels={[...]}>` | Timeline under active Project scope |
| `dk-events="click::dispatch:rename"` | `useActions()('rename', payload)` | Button/input dispatches to current Clip/Text/Effect model |
| direct RPC `node_id + args` | `scope_node_id + payload` | Worker resolves DKT model by `_nodeId` |

Миникату не нужно копировать DOM owner runtime. Нужно повторить принцип: render subtree всегда имеет model scope, а event из subtree идет в эту model или явно выбранный parent/root scope.

---

## 6. Что нужно удалить из основной архитектуры MiniCut

Текущее состояние MiniCut смешивает две authority:

- legacy registry: `Command -> DispatchResult -> PatchEnvelope -> ProjectRegistry`;
- DKT model tree: attrs/rels/actions/effects.

В production render/write path должны исчезнуть:

- `registrySnapshot` как root attr для UI;
- `DktRegistryRenderStore` как источник UI state;
- `PATCHES` как page update protocol;
- `SNAPSHOT` / `GET_SNAPSHOT` / `REPLACE_SNAPSHOT` как runtime protocol;
- `DISPATCH_COMMAND` / `DISPATCH_RESULT` как app editing protocol;
- big `getDispatch` switch по `scope.type` в `createDktEditorRenderRuntime`;
- `VideoEditorHarnessActions` как route для production UI writes;
- shadow DKT dispatch после legacy command execution.

Legacy code можно временно оставить под `legacy`/tests/adapters, но он не должен быть imported by app runtime/render path.

### Ревью прогресса после сравнения с weather и Linkkraft

Проверка против `D:\code\linkcraft\weather` и `D:\code\linkcraft\src` показала, что правильная ось синхронизации не `app root -> page`, а `session root -> pioneer -> app root`. Weather вызывает `hookSessionRoot(app_model, app_model.start_page, ...)`, затем `sync_sender.addSyncStream(session.sessionRoot, stream, [['pioneer']])`; React UI читает приложение через `<One rel="pioneer">`. Linkkraft делает то же концептуально через `initBrowsing(appModel)`, `common_session_root`, `selectRoot` и `syncSender.addSyncStream(root, stream, IMPORTANT_REL_PATHS)`.

Ошибки, найденные в промежуточной MiniCut-реализации:

- stream был переведен на `appModel`, из-за чего session attrs и `pioneer` перестали быть first-class root contract;
- shape mount пытался компенсировать это через `setTimeout`/retry и debug graph lookup;
- harness получил local session fallback и debug methods, что смешивало Legend state и DKT replica;
- worker ждал internal `sync_sender.sockets`, то есть зависел от private shape/syncsender state;
- proxy lookup опирался на `getLinedStructure`/runtime debug dump и polling, хотя DKT rels нужно читать внутри `model.input(...)` consistency window.

Исправление в commit `dbfead2`: transport снова bootstraps session root, important rel path теперь `[['pioneer']]`, page scoped dispatch resolves through `getModelById(sessionRoot, scope_node_id)`, proxy materialization reads DKT rels inside `appModel.input(...)`, and the hybrid debug/local-session render adapter was removed from production wiring.

---

## 7. Целевая структура файлов MiniCut

### Generic DKT React layer

```text
src/dkt-react-sync/
  components/
    Many.tsx
    One.tsx
    Path.tsx
  context/
    ReactScopeRuntimeContext.tsx
    ScopeContext.tsx
  hooks/
    useActions.ts
    useAttrs.ts
    useReactScopeRuntime.ts
    useScope.ts
    useShape.ts
    useSyncRoot.ts
  receiver/
    ReactSyncReceiver.ts
  runtime/
    PageSyncRuntime.ts
    ReactScopeRuntime.ts
    createSyncStore.ts
  scope/
    RootScope.tsx
    ScopeHandle.ts
  shape/
    MountedShape.tsx
    ShapeRegistry.ts
    autoShapes.ts
    defineShape.ts
```

### MiniCut-specific DKT runtime adapters

```text
src/video-editor/dkt/runtime/
  createMiniCutDktRuntime.ts
  createMiniCutPageSyncRuntime.ts
  workerModelRuntime.ts
  scopedActionTransport.ts
  pageRuntimeStore.ts
```

Target responsibilities:

- `createMiniCutPageSyncRuntime.ts`: app-specific transport adapter around generic `ReactSyncReceiver`, `ShapeRegistry`, `createSyncStore`.
- `workerModelRuntime.ts`: session bootstrap, sync stream, scoped dispatch via `getModelById`.
- `scopedActionTransport.ts`: message creation/validation for `DISPATCH_ACTION`, `SYNC_HANDLE`, `SYNC_UPDATE_STRUCTURE_USAGE`, `SYNC_REQUIRE_SHAPE`.
- `pageRuntimeStore.ts`: boot/ready/session metadata only, not registry snapshot.

### MiniCut UI bindings

```text
src/video-editor/ui/dkt/
  DktEditorRoot.tsx
  shapes.ts
  rels.ts
  actionNames.ts
  hooks/
    useEditorSessionAttrs.ts
    useActiveProjectScope.ts
    useSelectedEntityScope.ts
```

Target responsibilities:

- Import generic `RootScope`, `Path`, `One`, `Many`, `useAttrs`, `useActions`.
- Define MiniCut shapes outside generic layer.
- Keep UI convenience wrappers outside generic layer.

### MiniCut model ownership

```text
src/video-editor/models/
  SessionRoot/
    actions.ts
    effects.ts
    shape.ts
  Project/
    actions.ts
    effects.ts
    shape.ts
  Track/
    actions.ts
    shape.ts
  Clip/
    actions.ts
    effects.ts
    shape.ts
  Text/
    actions.ts
    shape.ts
  Effect/
    actions.ts
    shape.ts
  Resource/
    actions.ts
    effects.ts
    shape.ts
```

Model folders own action semantics. UI dispatches action names to current scope; it does not build command objects.

---

## 8. Комплексный план миграции

### Фаза 1: Перенос абстрактного `src/dkt-react-sync` 1:1 из weather

Цель: добавить generic DKT + React sync layer без MiniCut логики и без подключения production UI.

Будущая структура файлов:

```text
src/dkt-react-sync/components/Many.tsx
src/dkt-react-sync/components/One.tsx
src/dkt-react-sync/components/Path.tsx
src/dkt-react-sync/context/ReactScopeRuntimeContext.tsx
src/dkt-react-sync/context/ScopeContext.tsx
src/dkt-react-sync/hooks/useActions.ts
src/dkt-react-sync/hooks/useAttrs.ts
src/dkt-react-sync/hooks/useReactScopeRuntime.ts
src/dkt-react-sync/hooks/useScope.ts
src/dkt-react-sync/hooks/useShape.ts
src/dkt-react-sync/hooks/useSyncRoot.ts
src/dkt-react-sync/receiver/ReactSyncReceiver.ts
src/dkt-react-sync/runtime/PageSyncRuntime.ts
src/dkt-react-sync/runtime/ReactScopeRuntime.ts
src/dkt-react-sync/runtime/createSyncStore.ts
src/dkt-react-sync/scope/RootScope.tsx
src/dkt-react-sync/scope/ScopeHandle.ts
src/dkt-react-sync/shape/MountedShape.tsx
src/dkt-react-sync/shape/ShapeRegistry.ts
src/dkt-react-sync/shape/autoShapes.ts
src/dkt-react-sync/shape/defineShape.ts
```

Изменения в файлах:

- Add files above from weather with mechanical import path adjustment.
- Rename weather-specific shape symbol from `weather.react_sync.shape` to generic `dkt.react_sync.shape`.
- Keep public API generic.
- Do not import from `src/video-editor`.
- Do not import MiniCut `DKT_MSG`.

Релевантные тесты:

- `npm run test:video-editor -- src/dkt-react-sync/receiver/ReactSyncReceiver.test.ts`
- `npm run test:video-editor -- src/dkt-react-sync/shape/ShapeRegistry.test.ts`
- `npm run test:video-editor -- src/dkt-react-sync/hooks/useAttrs.test.tsx`
- `npm run test:video-editor -- src/dkt-react-sync/components/Path.test.tsx`

| Название шага | Коммиты | Измененные файлы | Проблемы при реализации |
|---|---|---|---|
| Создать `src/dkt-react-sync` и перенести generic files из weather | До текущего ревью, commit не создавался в этом шаге текущего прохода | `src/dkt-react-sync/**` | Слой уже был добавлен до ревью; проверка показала, что проблема не в generic layer, а в MiniCut bootstrap/session wiring. |
| Убрать weather naming из generic shape metadata и imports | До текущего ревью, commit не создавался в этом шаге текущего прохода | `src/dkt-react-sync/shape/**`, `src/dkt-react-sync/runtime/**` | В текущем проходе изменений не потребовалось; generic layer не импортирует MiniCut runtime. |
| Добавить receiver tests для attrs/rels/root sync chunks | До текущего ревью, commit не создавался в этом шаге текущего прохода | `src/dkt-react-sync/receiver/**` | Текущий фокус был session-root MiniCut adapter; receiver-level тесты не расширялись. |
| Добавить React tests для `One`, `Many`, `Path`, `useAttrs`, `useActions` | До текущего ревью, commit не создавался в этом шаге текущего прохода | `src/dkt-react-sync/components/**`, `src/dkt-react-sync/hooks/**` | Текущий regression был в worker/page transport, поэтому React component tests не менялись. |

### Фаза 2: MiniCut page runtime adapter поверх generic layer

Цель: сделать MiniCut аналог weather `createPageSyncReceiverRuntime`, но вне `src/dkt-react-sync`.

Будущая структура файлов:

```text
src/video-editor/dkt/runtime/createMiniCutPageSyncRuntime.ts
src/video-editor/dkt/runtime/createMiniCutPageSyncRuntime.test.ts
src/video-editor/dkt/runtime/pageRuntimeStore.ts
src/video-editor/dkt/runtime/scopedActionTransport.ts
src/video-editor/dkt/shared/messageTypes.ts
```

Изменения в файлах:

- `createMiniCutPageSyncRuntime.ts` creates generic `ReactSyncReceiver`, `ShapeRegistry`, `createSyncStore`.
- `createMiniCutPageSyncRuntime.ts` handles only boot/ready/root metadata and DKT sync stream.
- `scopedActionTransport.ts` validates and creates messages:
  - `BOOTSTRAP_SESSION`
  - `CLOSE_SESSION`
  - `DISPATCH_ACTION`
  - `SYNC_HANDLE`
  - `SYNC_UPDATE_STRUCTURE_USAGE`
  - `SYNC_REQUIRE_SHAPE`
  - `RUNTIME_READY`
  - `RUNTIME_ERROR`
- `messageTypes.ts` marks legacy messages as deprecated and separates production protocol from legacy compatibility.
- Existing `pageSyncReceiver.ts` becomes compatibility wrapper or is replaced after call sites move.

Релевантные тесты:

- `npm run test:video-editor -- src/video-editor/dkt/runtime/createMiniCutPageSyncRuntime.test.ts`
- `npm run test:video-editor -- src/video-editor/dkt/shared/messageTypes.test.ts`
- `npm run test:video-editor -- src/video-editor/dkt/runtime/pageSyncReceiver.test.ts`

| Название шага | Коммиты | Измененные файлы | Проблемы при реализации |
|---|---|---|---|
| Создать MiniCut page runtime adapter поверх generic receiver/store/shape registry | До текущего ревью, commit не создавался в этом шаге текущего прохода | `src/video-editor/dkt/runtime/createMiniCutPageSyncRuntime.ts`, `src/video-editor/dkt/runtime/pageRuntimeStore.ts` | Adapter уже существовал; ревью подтвердило, что он должен оставаться вне harness hybrid render adapter. |
| Добавить scoped `DISPATCH_ACTION` transport message with `scope_node_id` | До текущего ревью, commit не создавался в этом шаге текущего прохода | `src/video-editor/dkt/runtime/scopedActionTransport.ts`, `src/video-editor/dkt/shared/messageTypes.ts` | Message contract был готов; неправильным был worker resolver target. |
| Пробросить `SYNC_UPDATE_STRUCTURE_USAGE` и `SYNC_REQUIRE_SHAPE` из shape registry | До текущего ревью, commit не создавался в этом шаге текущего прохода | `src/video-editor/dkt/runtime/createMiniCutPageSyncRuntime.ts` | После исправления worker больше не требует socket polling перед shape forwarding. |
| Разделить production protocol и legacy registry messages в `messageTypes.ts` | До текущего ревью, commit не создавался в этом шаге текущего прохода | `src/video-editor/dkt/shared/messageTypes.ts` | Legacy messages еще остаются для compatibility; полное удаление перенесено в фазу 9. |
| Покрыть bootstrap, sync handle, root readiness, scoped dispatch tests | `dbfead2` | `src/video-editor/worker/memoryWorker.test.ts`, `src/video-editor/dkt/runtime/createMiniCutDktRuntime.test.ts` | Тест переписан на DKT subscriptions (`root`, `pioneer`, `project`, attrs), без `setTimeout` и debug graph assertions. |

### Фаза 3: Worker runtime dispatch by DKT scope

Цель: worker должен принимать scoped action и вызывать `model.dispatch` на DKT model, найденной по `scope_node_id`.

Будущая структура файлов:

```text
src/video-editor/dkt/runtime/workerModelRuntime.ts
src/video-editor/dkt/runtime/workerModelRuntime.test.ts
src/video-editor/dkt/runtime/createMiniCutDktRuntime.ts
src/video-editor/worker/dktSharedWorker.ts
```

Изменения в файлах:

- `workerModelRuntime.ts` owns session/app entries.
- On bootstrap: create or reuse session root and call `sync_sender.addSyncStream(sessionRoot, stream, importantRelPaths)`.
- On `DISPATCH_ACTION`: resolve target using `getModelById(sessionRoot, scope_node_id)`.
- Dispatch target action directly: `target.dispatch(action_name, payload)`.
- Handle null `scope_node_id` as session/app root dispatch only for root-level actions.
- Keep `DISPATCH_COMMAND` only in legacy adapter tests until removed.
- `createMiniCutDktRuntime.ts` stops being registry authority and becomes thin DKT runtime host.

Релевантные тесты:

- `npm run test:video-editor -- src/video-editor/dkt/runtime/workerModelRuntime.test.ts`
- `npm run test:video-editor -- src/video-editor/dkt/runtime/createMiniCutDktRuntime.test.ts`
- `npm run test:video-editor -- src/video-editor/worker/dktSharedWorker.test.ts`

| Название шага | Коммиты | Измененные файлы | Проблемы при реализации |
|---|---|---|---|
| Реализовать worker scoped dispatch through `getModelById` | `dbfead2` | `src/video-editor/dkt/runtime/createMiniCutDktRuntime.ts` | Dispatch теперь ищет scope через `getModelById(sessionRoot, scope_node_id)` и явно падает, если scope не найден. |
| Перевести sync stream target на session root model tree | `dbfead2` | `src/video-editor/dkt/runtime/createMiniCutDktRuntime.ts`, `src/video-editor/dkt/runtime/createMiniCutDktRuntime.test.ts` | Root исправлен с `appModel` на session root; important rel path задан как `[['pioneer']]`, как в weather. |
| Поддержать null scope только для root/session actions | `dbfead2` | `src/video-editor/dkt/runtime/createMiniCutDktRuntime.ts` | Null scope в page action теперь dispatch-ится в session root; app-root internal actions оставлены только во внутреннем materialization path. |
| Убрать production dependency on `dispatchCommand` from worker switch | `dbfead2` частично | `src/video-editor/dkt/runtime/createMiniCutDktRuntime.ts` | Legacy `DISPATCH_COMMAND` еще остается в switch для compatibility tests; production DKT action path больше не проходит через command dispatch. |
| Добавить worker tests на scoped Clip/Track/Project dispatch | `dbfead2` | `src/video-editor/dkt/runtime/createMiniCutDktRuntime.test.ts` | Existing focused tests подтверждают session-root bootstrap и scoped session action; Clip/Track/Project model action tests остаются через runtime proxy helpers. |

### Фаза 4: SessionRoot и Project navigation через DKT rels

Цель: заменить session/active project render source на DKT rels and attrs.

Будущая структура файлов:

```text
src/video-editor/models/SessionRoot/actions.ts
src/video-editor/models/SessionRoot/effects.ts
src/video-editor/models/SessionRoot/shape.ts
src/video-editor/models/Project/shape.ts
src/video-editor/ui/dkt/DktEditorRoot.tsx
src/video-editor/ui/dkt/hooks/useEditorSessionAttrs.ts
src/video-editor/ui/dkt/hooks/useActiveProjectScope.ts
```

Изменения в файлах:

- SessionRoot exposes attrs/rels needed by UI:
  - `activeProject`
  - `selectedEntity`
  - `cursor`
  - `timelineZoom`
  - `isPlaying`
  - `activeInspectorTab`
- UI root renders through generic `RootScope`.
- Active project UI uses `Path rels={['session', 'activeProject']}` or equivalent root rel path.
- Legend session store remains read-only compatibility until all UI panels migrate.

Релевантные тесты:

- `npm run test:video-editor -- src/video-editor/models/SessionRoot/actions.test.ts`
- `npm run test:video-editor -- src/video-editor/ui/dkt/DktEditorRoot.test.tsx`
- `npm run test:video-editor -- src/video-editor/app/createVideoEditorHarness.test.ts`

| Название шага | Коммиты | Измененные файлы | Проблемы при реализации |
|---|---|---|---|
| Описать SessionRoot attrs/rels for render in DKT models | До текущего ревью, уточнено в `dbfead2` | `src/video-editor/models/SessionRoot.ts`, `src/video-editor/dkt/runtime/createMiniCutDktRuntime.ts` | SessionRoot уже содержит editor attrs; ключевое исправление было использовать его как stream root, а не обходить через app root. |
| Добавить shapes for SessionRoot and Project | `dbfead2` в тестовом покрытии | `src/video-editor/worker/memoryWorker.test.ts` | Проверочный shape теперь идет `root -> pioneer -> project`; production UI shapes еще должны быть вынесены в `src/video-editor/ui/dkt/shapes.ts`. |
| Ввести `DktEditorRoot` with generic `RootScope` and `Path` | Не реализовано в текущем commit | Нет production UI файлов | Гибридный `createDktReplicaRenderRuntime` удален; следующий шаг должен быть прямой React DKT root, без adapter over legacy `EditorRenderRuntime`. |
| Перевести active project navigation на `Path` instead of nested adapter selectors | Не реализовано в текущем commit | Нет production UI файлов | Нужна модельная rel навигация `pioneer/project/activeProject`; сейчас legacy render runtime остается compatibility path. |
| Сохранить Legend session store only as compatibility read adapter | `dbfead2` | `src/video-editor/app/createVideoEditorHarness.ts` | Удален local-session sync в DKT replica adapter; Legend session больше не синхронизируется в DKT через harness fallback. |

### Фаза 5: Timeline render from model tree

Цель: Timeline должен читать Project/Track/Clip/Text/Effect scopes из DKT replica, не из `ProjectRegistry`.

Будущая структура файлов:

```text
src/video-editor/models/Track/shape.ts
src/video-editor/models/Clip/shape.ts
src/video-editor/models/Text/shape.ts
src/video-editor/models/Effect/shape.ts
src/video-editor/ui/timeline/Timeline.tsx
src/video-editor/ui/timeline/TrackLane.tsx
src/video-editor/ui/timeline/ClipItem.tsx
src/video-editor/ui/timeline/TextClipItem.tsx
src/video-editor/ui/dkt/shapes.ts
```

Изменения в файлах:

- Timeline uses `Many rel="tracks" item={TrackLane}` under active Project scope.
- TrackLane uses `useAttrs(['name', 'kind', 'height'])` and `Many rel="clips"`.
- ClipItem reads clip attrs directly: `start`, `duration`, `resource`, `transform`, `opacity`, `color`, `audio`.
- TextClipItem reads Text model attrs directly.
- Effect panels use `Many rel="effects"` from Clip/Text scope.
- No component should read `ProjectRegistry.entitiesById` for timeline render.

Релевантные тесты:

- `npm run test:video-editor -- src/video-editor/ui/timeline/Timeline.test.tsx`
- `npm run test:video-editor -- src/video-editor/ui/timeline/TrackLane.test.tsx`
- `npm run test:video-editor -- src/video-editor/models/Track/actions.test.ts src/video-editor/models/Clip/actions.test.ts`
- `npm run test:video-editor -- tests/integration/video-editor.spec.ts`

| Название шага | Коммиты | Измененные файлы | Проблемы при реализации |
|---|---|---|---|
| Добавить Track/Clip/Text/Effect shape definitions | `dbfead2` частично | `src/video-editor/models/Clip.ts`, `src/video-editor/models/Track/actions.ts`, `src/video-editor/worker/memoryWorker.test.ts` | Clip creation shape расширен `sourceResourceId/sourceTextId`; production UI shape file еще не создан. |
| Перевести Timeline root на active Project DKT scope | Не реализовано в текущем commit | Нет production UI файлов | Старый `EditorRenderRuntime` оставлен, потому что hybrid debug adapter удален; следующий шаг должен быть прямой DKT UI root. |
| Перевести TrackLane на `useAttrs` + `Many rel="clips"` | Не реализовано в текущем commit | Нет production UI файлов | Требуется перенос timeline components на generic `Many`/`useAttrs`; текущий проход исправлял transport/session root. |
| Перевести ClipItem/TextClipItem на scoped attrs and actions | Не реализовано в текущем commit | Нет production UI файлов | Нужны прямые Clip/Text scopes; `sourceResourceId/sourceTextId` добавлены как bridge data для корректной materialization. |
| Убрать registry reads из timeline render path | Не реализовано в текущем commit | `src/video-editor/app/createVideoEditorHarness.ts` проверен, hybrid adapter удален | Registry render path остается compatibility path; важно, что новый debug-based DKT facade не закреплен. |

### Фаза 6: Inspector and property editing через scoped dispatch

Цель: inspector controls должны dispatch-ить action в текущую selected model scope.

Будущая структура файлов:

```text
src/video-editor/ui/inspector/InspectorPanel.tsx
src/video-editor/ui/inspector/ClipInspector.tsx
src/video-editor/ui/inspector/TextInspector.tsx
src/video-editor/ui/inspector/EffectInspector.tsx
src/video-editor/ui/dkt/hooks/useSelectedEntityScope.ts
src/video-editor/models/Clip/actions.ts
src/video-editor/models/Text/actions.ts
src/video-editor/models/Effect/actions.ts
```

Изменения в файлах:

- Selection is DKT rel/attr on SessionRoot, not only Legend state.
- Inspector resolves selected model through DKT scope.
- Controls call `const dispatch = useActions()` and dispatch model-local actions.
- Remove `updateClipById`, `updateTextById`, `updateEffectById` from production UI action route.

Релевантные тесты:

- `npm run test:video-editor -- src/video-editor/ui/inspector/InspectorPanel.test.tsx`
- `npm run test:video-editor -- src/video-editor/models/Clip/actions.test.ts src/video-editor/models/Text/actions.test.ts src/video-editor/models/Effect/actions.test.ts`
- `npm run test:video-editor -- tests/integration/video-editor.spec.ts`

| Название шага | Коммиты | Измененные файлы | Проблемы при реализации |
|---|---|---|---|
| Перевести selected entity на SessionRoot DKT scope/rel | `dbfead2` частично | `src/video-editor/dkt/runtime/createMiniCutDktRuntime.ts` | SessionRoot теперь является DKT stream root; rel/selector для selected entity еще не реализован как model relation. |
| Добавить `useSelectedEntityScope` outside generic layer | Не реализовано в текущем commit | Нет production UI файлов | Должен появиться в `src/video-editor/ui/dkt/hooks`, не в generic `src/dkt-react-sync`. |
| Перевести ClipInspector на scoped attrs/actions | Не реализовано в текущем commit | Нет production UI файлов | Inspector пока использует compatibility render/action route. |
| Перевести TextInspector на scoped attrs/actions | Не реализовано в текущем commit | Нет production UI файлов | Нужно после появления selected entity DKT scope. |
| Перевести EffectInspector на scoped attrs/actions | Не реализовано в текущем commit | Нет production UI файлов | Нужно после появления Effect scopes в UI. |
| Удалить inspector dependency on registry/harness action ids | Не реализовано в текущем commit | Нет production UI файлов | Удаление отложено до полного scoped dispatch UI rewrite. |

### Фаза 7: Editing actions as DKT model actions

Цель: все editing writes становятся model-local DKT actions/effects.

Будущая структура файлов:

```text
src/video-editor/models/Project/actions.ts
src/video-editor/models/Track/actions.ts
src/video-editor/models/Clip/actions.ts
src/video-editor/models/Text/actions.ts
src/video-editor/models/Effect/actions.ts
src/video-editor/models/Resource/actions.ts
src/video-editor/app/createDktActionRuntime.ts
src/video-editor/domain/actionCommandBuilders.ts
src/video-editor/domain/actionTransactions.ts
```

Изменения в файлах:

- Project actions: `addTrack`, `removeTrack`, `importResource`, `createText`, `renderExport`.
- Track actions: `addClip`, `addTextClip`, `removeClip`, `splitAt`, `reorderClip`.
- Clip actions: `rename`, `trim`, `move`, `setTransform`, `setOpacity`, `setAudio`, `addEffect`, `removeEffect`, `reorderEffect`.
- Text actions: `setContent`, `setStyle`, `setBox`, `setTiming`.
- Effect actions: `setEnabled`, `setKind`, `setAmount`, `setParams`, `setColor`.
- `createDktActionRuntime.ts` becomes legacy compatibility adapter only.
- `actionCommandBuilders.ts` stops being production path.

Релевантные тесты:

- `npm run test:video-editor -- src/video-editor/models/Project/actions.test.ts`
- `npm run test:video-editor -- src/video-editor/models/Track/actions.test.ts`
- `npm run test:video-editor -- src/video-editor/models/Clip/actions.test.ts`
- `npm run test:video-editor -- src/video-editor/models/Text/actions.test.ts`
- `npm run test:video-editor -- src/video-editor/models/Effect/actions.test.ts`

| Название шага | Коммиты | Измененные файлы | Проблемы при реализации |
|---|---|---|---|
| Завершить Project model actions for structural edits | `dbfead2` частично | `src/video-editor/dkt/runtime/createMiniCutDktRuntime.ts`, `src/video-editor/dkt/runtime/createMiniCutDktRuntime.test.ts` | Existing `Project.addTrack/importResource` используются для hierarchy materialization; полный production write path еще не переведен. |
| Завершить Track model actions for timeline structure | `dbfead2` частично | `src/video-editor/models/Track/actions.ts`, `src/video-editor/dkt/runtime/createMiniCutDktRuntime.ts` | Track actions принимают source ids для Clip materialization; reorder/remove остаются compatibility scope. |
| Завершить Clip model actions for media clip editing | `dbfead2` частично | `src/video-editor/models/Clip.ts`, `src/video-editor/dkt/runtime/createMiniCutDktRuntime.test.ts` | Clip attrs/actions покрыты focused runtime tests; direct UI scoped dispatch еще не подключен. |
| Завершить Text model actions for text editing | `dbfead2` частично | `src/video-editor/dkt/runtime/createMiniCutDktRuntime.ts`, `src/video-editor/dkt/runtime/createMiniCutDktRuntime.test.ts` | Text proxy materialization and attr actions проверены runtime tests; UI inspector pending. |
| Завершить Effect model actions for effect editing | `dbfead2` частично | `src/video-editor/dkt/runtime/createMiniCutDktRuntime.ts`, `src/video-editor/dkt/runtime/createMiniCutDktRuntime.test.ts` | Effect proxy creation and attr actions проверены runtime tests; UI inspector pending. |
| Перевести UI writes с app action runtime на scoped DKT dispatch | Не реализовано в текущем commit | Нет production UI файлов | Worker/page side готовится; UI writes все еще идут через harness actions until DKT UI root lands. |
| Пометить `createDktActionRuntime` and command builders as legacy compatibility | Не реализовано в текущем commit | Нет изменений | Нужно отдельным cleanup commit после UI scoped dispatch. |

### Фаза 8: Import/export/resource/P2P через DKT effects

Цель: runtime capabilities остаются эффектами, но ownership находится у моделей.

Будущая структура файлов:

```text
src/video-editor/models/Project/effects.ts
src/video-editor/models/Resource/effects.ts
src/video-editor/models/Clip/effects.ts
src/video-editor/media/resourceTransferManager.ts
src/video-editor/render/exportRenderer.ts
src/video-editor/app/mediaImportActions.ts
src/video-editor/app/exportActions.ts
```

Изменения в файлах:

- File picker remains UI capability, then dispatches Project effect request.
- Project effect creates Resource and timeline model nodes through DKT actions.
- Resource effect registers blob/object URL/P2P metadata and exposes status attrs.
- Export effect reads model tree/export projection, not `ProjectRegistry` snapshot.
- `mediaImportActions.ts` and `exportActions.ts` become compatibility wrappers or are removed from production UI.

Релевантные тесты:

- `npm run test:video-editor -- src/video-editor/models/Project/effects.test.ts`
- `npm run test:video-editor -- src/video-editor/models/Resource/effects.test.ts`
- `npm run test:video-editor -- tests/integration/export-audio-artifacts.spec.ts`
- `npm run test:video-editor -- tests/integration/p2p-media-transfer.spec.ts`
- `npm run test:video-editor -- tests/integration/p2p-media-large-chunk-transfer.spec.ts`

| Название шага | Коммиты | Измененные файлы | Проблемы при реализации |
|---|---|---|---|
| Перевести import flow на Project/Resource DKT effects | Не реализовано в текущем commit | Нет model effect files | Current commit только материализует Resource proxies из registry snapshots. |
| Перевести resource local blob/object URL state на Resource attrs/effects | Не реализовано в текущем commit | Нет model effect files | Resource proxy attrs sync `status/name/...`; blob/object URL ownership еще в existing media runtime. |
| Перевести export flow на model tree/export projection | Не реализовано в текущем commit | Нет export changes | Export остается registry/projection based до Phase 8 implementation. |
| Проверить P2P resource availability through Resource model state | `dbfead2` частично | `src/video-editor/p2p/P2PAuthorityAdapter.ts`, `src/video-editor/worker/authorityClient.ts` | P2P authority теперь может expose DKT transport; actual Resource state/effects not migrated. |
| Убрать production dependency on app import/export command wrappers | Не реализовано в текущем commit | Нет import/export wrapper changes | Нужно после Project/Resource effects. |

### Фаза 9: Удаление snapshot/patch/registry render path

Цель: удалить legacy registry authority из production runtime/render.

Будущая структура файлов:

```text
src/video-editor/render-sync/DktRegistryRenderStore.ts
src/video-editor/render-sync/createDktEditorRenderRuntime.ts
src/video-editor/dkt/runtime/pageSyncReceiver.ts
src/video-editor/dkt/runtime/createMiniCutDktRuntime.ts
src/video-editor/domain/applyPatch.ts
src/video-editor/domain/applyPatchInPlace.ts
src/video-editor/domain/applyCommand.ts
src/video-editor/domain/commandHandlerRegistry.ts
src/video-editor/domain/actionCommandBuilders.ts
src/video-editor/domain/actionTransactions.ts
src/video-editor/domain/*CommandHandlers.ts
```

Изменения в файлах:

- Remove `DktRegistryRenderStore` from app imports.
- Remove `registrySnapshot` root attr reliance.
- Remove `PATCHES`, `SNAPSHOT`, `DISPATCH_COMMAND`, `DISPATCH_RESULT` from production message switch.
- Move legacy command/patch code to `src/video-editor/domain/legacy/*` only if historical tests still need it.
- Delete obsolete tests that assert patch envelopes instead of model tree updates.

Релевантные тесты:

- `npm run test:video-editor -- src/video-editor/dkt/runtime/createMiniCutDktRuntime.test.ts`
- `npm run test:video-editor -- src/video-editor/dkt/runtime/createMiniCutPageSyncRuntime.test.ts`
- `npm run test:video-editor -- src/video-editor/render-sync/createDktEditorRenderRuntime.test.ts`
- `npm run test:video-editor -- tests/integration/video-editor.spec.ts`
- `npm run test:video-editor -- tests/integration/shared-worker-sync.spec.ts`

| Название шага | Коммиты | Измененные файлы | Проблемы при реализации |
|---|---|---|---|
| Удалить `DktRegistryRenderStore` из production render path | Не реализовано в текущем commit | `src/video-editor/app/createVideoEditorHarness.ts` проверен | Гибридный DKT replica adapter удален; registry render path остается как честный compatibility path до прямого DKT UI root. |
| Удалить `registrySnapshot` как UI state source | Не реализовано в текущем commit | `src/video-editor/dkt/runtime/createMiniCutDktRuntime.ts` | `registrySnapshot` еще используется для bridge materialization; target removal требует переноса UI/write path. |
| Убрать legacy snapshot/patch/command messages из production runtime switch | `dbfead2` частично | `src/video-editor/dkt/runtime/createMiniCutDktRuntime.ts`, `src/video-editor/dkt/shared/messageTypes.ts` | Legacy switch оставлен for compatibility; page scoped actions now use session resolver. |
| Перенести или удалить command/patch domain modules | Не реализовано в текущем commit | Нет domain legacy movement | Должно быть отдельной фазой после UI migration. |
| Обновить tests from patch assertions to DKT tree assertions | `dbfead2` частично | `src/video-editor/worker/memoryWorker.test.ts`, `src/video-editor/dkt/runtime/createMiniCutDktRuntime.test.ts` | Добавлен DKT transport test через subscriptions; old registry render tests сохранены для compatibility. |

### Фаза 10: Полная валидация и документация результата

Цель: доказать, что MiniCut работает через DKT replica + scoped dispatch end-to-end.

Изменения в файлах:

- Update architecture docs.
- Fill report tables in this document with actual commits/files/problems.
- Add migration notes for removed legacy paths.

Релевантные тесты:

- `npm run test:video-editor`
- `npm run video-editor:build`
- `npm run test:video-editor -- tests/integration/video-editor.spec.ts`
- `npm run test:video-editor -- tests/integration/shared-worker-sync.spec.ts`
- `npm run test:video-editor -- tests/integration/p2p-state-sync.spec.ts`
- `npm run test:video-editor -- tests/integration/p2p-media-transfer.spec.ts`
- `npm run test:video-editor -- tests/integration/export-audio-artifacts.spec.ts`

| Название шага | Коммиты | Измененные файлы | Проблемы при реализации |
|---|---|---|---|
| Запустить full video-editor unit suite | Не запускался в текущем проходе | Нет изменений | Запущен focused suite: `npm run test:video-editor -- src/video-editor/dkt/runtime/createMiniCutDktRuntime.test.ts src/video-editor/worker/memoryWorker.test.ts src/video-editor/render-sync/createDktEditorRenderRuntime.test.ts src/video-editor/app/createVideoEditorHarness.test.ts` = 42/42 passed. |
| Запустить build and verify DKT chunks | Не запускался в текущем проходе | Нет изменений | Build оставлен pending; текущий scope был architecture correction and focused regression. |
| Запустить critical Playwright integration tests | Не запускался в текущем проходе | Нет изменений | Integration suite оставлен pending после next UI-DKT phase. |
| Обновить docs with final architecture and removed legacy list | Документальный commit после `dbfead2` | `docs/dkt-weather-style-model-tree-render-dispatch-plan-2026-05-05.md` | Добавлено ревью weather/Linkkraft и уточнен список удаленных промежуточных решений. |
| Заполнить отчетные таблицы фактическими commits/files/problems | Документальный commit после `dbfead2` | `docs/dkt-weather-style-model-tree-render-dispatch-plan-2026-05-05.md` | Все 10 таблиц заполнены; строки с неготовыми фазами явно помечены как pending, чтобы не маскировать прогресс. |

---

## 9. Глобальные acceptance criteria

1. `src/dkt-react-sync` не импортирует ничего из `src/video-editor` и не содержит app-specific logic.
2. `Path` используется для common nested rel navigation вместо ручных цепочек nested `One`.
3. React render читает DKT attrs/rels через `useSyncExternalStore`, not registry snapshots.
4. UI dispatch из component идет через `useActions()` to current scope.
5. Worker resolves `scope_node_id` to DKT model and calls `model.dispatch`.
6. Timeline/Inspector render path does not import `ProjectRegistry`.
7. Production runtime does not send/receive `PATCHES` or `SNAPSHOT` for editor state.
8. Production UI write path does not build `Command` objects.
9. ShapeRegistry sends structure usage and required shapes for mounted UI scopes.
10. Existing import/export/P2P capabilities work through model effects and Resource state.

---

## 10. Почему это комплексная миграция, а не first slice

Первый вертикальный slice все еще полезен для проверки идеи, но его недостаточно как критерий завершения. Завершенной миграция считается только когда:

- generic layer перенесен и покрыт тестами;
- page runtime and worker runtime работают через DKT sync/action protocol;
- SessionRoot/Project/Timeline/Inspector читают model tree;
- editing/import/export/P2P writes идут через model actions/effects;
- snapshot/patch/command path удален из production runtime;
- отчетные таблицы выше заполнены реальными commits, changed files и фактическими проблемами реализации.
