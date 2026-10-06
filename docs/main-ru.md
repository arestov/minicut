# MiniCut Spore Alignment Memory

Дата: 2026-05-25  
Назначение: операторская память для pilot-alignment в Spore перед запуском fleet/worktree/tmux orchestration на репозитории MiniCut.


## Практический компас DKT

1. DKT state - pure data: graph nodes, attrs и rels. Side effects живут на границе `effects.*`, `$fx_`, runtime/task APIs, но не внутри state.
2. `action` и `comp` - оба pure state primitives. `action` - push style: intent/event frame пишет attrs/rels через декларативные targets. `comp` - pull style: live/reactive query, которая вычисляет derived attrs/rels из уже объявленного graph state.
3. `handleAttr` и `handleRel` - граница, где pull/reactive model превращается в push transition: изменение attr/rel вызывает declared action path, а не imperative observer code.
4. `$fx_` и `effects.out` - side-effect boundary. Используй их, когда pure data соприкасается с реальным миром: сеть, файлы, browser/electron APIs, timers, workers, media, storage.
5. Render path - top-down tree by scope. `RootScope` задаёт root scope; `Path`/`One`/`Many` переходят по rel и меняют `ScopeContext`; `useAttrs`/`useActions` работают с текущей scope-моделью. Если UI нужен attr/rel/projection, подготовь его в DKT model через attrs/rels/comp, а не собирай в React/debug traversal.
6. Эффективное вычисление и доставка view updates через компактный diff строятся на простых attrs/rels и mounted shapes. `Many rel` даёт stable scope list и key по `_nodeId`, `useAttrs` подписан на конкретные attr names, а shape registry запрашивает только реально смонтированные attrs/rels. Предпочитай простые состояния и проброс rel-связей вместо больших nested objects в comp attr, потому что большой объект превращает точечный diff в скрытый read-model.
7. В одной транзакции могут быть цепочки, но они должны быть видны фреймворку через декларативные targets: `to`, `$output`, `sub_flow`, `$fx_`, declared child targets. Не прячь orchestration в `dispatch -> read -> dispatch`.
8. Flow tests должны разделять write step и read step. Для DKT runtime/lazy state читать `queryAttr`, `queryRel`, `queryAddr` внутри отдельного `input`/`readInput`; см. [flow-step-read-write-testing](</D:/code/linkcraft/dkt/docs/internal/flow-step-read-write-testing.md>).
9. `runtimeRef` нужен только для live runtime objects вроде `File`, `Blob`, file handle, `MessagePort`, `OffscreenCanvas`. В DKT state можно класть serializable id/metadata/status, но не сам файл или handler object.
10. Если точно найден баг в DKT, сначала сделай DKT test/repro, который его воспроизводит; MiniCut workaround не должен скрывать framework bug.
11. Декларативность DKT = framework-visible intent. Не прячь важные зависимости, rel traversal, writes, side-effect triggers и cross-model transitions в adapter/helper code. Описывай их в model attrs/rels/comp/actions/effects, чтобы DKT мог оптимизировать, доставлять compact diff, lazy-load-ить graph state, реплицировать/persist-ить нужный подграф, а также поддерживать статический анализ и визуализацию.
12. `Date.now()` и `new Date()` запрещены внутри DKT `comp` attrs и `action.fn`: это скрытый wall-clock side effect внутри pure state primitive. Для derived time conditions используй `$meta$time` в `comp`; для timestamp writes используй `$now` или текущий DKT time action-dep; для реальных timers/schedulers держи side effect на `effects`/runtime boundary и возвращай результат в DKT явным action/event payload. См. [$meta$time в comp attrs](</D:/code/linkcraft/dkt/docs/State/meta-time-comp-reference-ru.md>) и [Meta Resource Schema Groups](</D:/code/linkcraft/dkt/docs/internal/meta-resource-schema-groups.md>).
13. UI не строит domain read-model. Dynamic model sets выражай через `comp rel`; per-model state/detail/flags - через маленькие `comp attrs` на owning model. Renderer может выбирать layout, labels и DOM structure, но не должен искать latest/active, фильтровать domain statuses, агрегировать child state или собирать большой synthetic view-model.
14. Model instance в DKT production code - это identity/scope/ref, а не object API для чтения state. Не приводить instance к `{ getAttr }`, `{ attrs }`, `queryAttr`, `_states` или другим runtime/debug shapes, чтобы достать данные. Если `comp`, `action.fn`, reducer, production effect orchestration или renderer domain logic нужен attr/rel, он должен прийти через declared deps: `comp attr` deps, `comp rel` deps, action deps, effect deps/payload или scoped renderer attrs/rels. Нельзя делать `model.getAttr("status")`, `model.attrs.status`, `model.attrs?.[name]`, fallback `getAttr ?? attrs[...]`, сканировать model instances и читать из каждого attrs, чтобы найти latest/active/visible/owned item. Если значения не хватает в функции, это сигнал добавить нужный attr dep, rel dep, comp projection, action dep или effect boundary. Исключение: tests/debug/inspect code может читать через `queryAttr`, `queryRel`, serialized `.attrs` или inspect DTO, если это явно диагностика, assertion или debug dump; это не production pattern.


## Сводная таблица замечаний

| ID | Замечание | Важность | Почему это важно | Рекомендация для align |
| --- | --- | --- | --- | --- |
| M01 | DKT - единственный source of truth для running editor path. | Критично | Новые feature/data paths не должны создавать второй state graph рядом с DKT. | promoted |
| M02 | Запрещена внешняя orchestration-схема `dispatch -> await/read -> dispatch`. | Критично | Такой код ломает transaction boundaries и плодит split-brain state. | promoted |
| M03 | Нельзя чинить missing attrs/rels fallback-ом к debug graph, worker dump, replica scans или старым registry/source-id подходам. | Критично | Это маскирует missing DKT contracts вместо исправления причины. | promoted |
| M04 | Create actions обязаны писать semantic owner rel в той же DKT transaction. | Критично | Иначе page получает node без правильного owner traversal path. | promoted |
| M05 | Текущий identity-contract для MiniCut - DKT `_node_id`; не возвращать `source*Id` как traversal backbone. | Критично | Эта ветка уже node-id-first, поэтому source-id joins должны рассматриваться как регрессия. | promoted |
| M06 | `spore bootstrap` честно блокируется на `pilot-aligned`, а прямой `spore fleet reconcile` сам этот gate не проверяет. | Критично | Fleet можно включить слишком рано, если оператор обойдёт governance discipline. | promoted candidate |
| M07 | Главный локальный editor-check: `npm run test:video-editor -- <paths>`. | Высокая | Raw `tsx` плохо подходит для DKT alias imports и даёт ложные сигналы. | note |
| M08 | После DKT-изменений нужно прогонять targeted tests, `npm run guard:dkt-hard` и релевантный build/smoke. | Высокая | Иначе легко пропустить hard-law violations. | note |
| M09 | Export должен идти по одному DKT `$fx_`/runtime-task пути без dual-path trigger/fallback схем. | Высокая | Export regressions здесь часто вызваны конкурирующими execution paths. | note |
| M10 | Import/export/P2P/media/worker boundary code может держать runtime objects, но обязан возвращать результат в DKT через actions/tasks. | Высокая | Иначе boundary превращается во второе state graph. | note |
| M11 | DKT sync stream - это stream receiver, а не snapshot/debug API. | Высокая | Reading debug/state internals как production data ломает архитектурный контур. | note |
| M12 | Skeleton race реален: rel update может приехать раньше attrs. | Высокая | UI и Playwright могут увидеть временные null attrs и сделать неверные действия. | note |
| M13 | Export/tests должны ждать events/semantic state, а не фиксированные таймеры. | Высокая | Time-based waits здесь особенно быстро становятся flaky. | note |
| M14 | P2P/CRDT тесты требуют явной cleanup-дисциплины, isolated room ids и осознанного project selection на replica. | Высокая | Иначе появляются cross-test leakage и ложные network failures. | note |
| M15 | `resourceTransferManager` и export-path должны жить в мире resource node ids и валидных resource URLs. | Высокая | Пустой `resourceUrl` легко ломает export audio без явной ошибки. | note |
| M16 | Debug dumps для тестов должны быть structured-clone-safe. | Средняя | Сырые CRDT internals плохо проходят через `postMessage`. | note |
| M17 | Широкие integration/export/P2P tests могут падать на timing и browser boundary; rerun допустим только после проверки semantic waits. | Средняя | Простое увеличение таймаутов закрепляет плохой паттерн. | note |
| M18 | User-facing export labels и diagnostics должны совпадать с реальным форматом/path: WebM/WebCodecs/MediaRecorder fallback. | Средняя | Неправильные labels дают неверный product contract. | note |
| M19 | Для честного fleet enable нужно пройти минимум 10 notes, 3 promoted notes и `spore align flip`. | Критично | Это governance gate самого Spore, а не декоративный шаг. | note |
| M20 | `spore bootstrap --skip pilot-aligned` допустим только как явный local smoke bypass. | Высокая | Иначе bootstrap перестаёт быть честным сигналом readiness. | note |

## Короткий вывод

MiniCut нельзя безопасно отдавать fleet без локального alignment, потому что у репозитория есть жёсткие архитектурные табу, которые generic workers почти наверняка нарушат без предварительной памяти. Главный риск - не один плохой патч, а быстрое размножение неправильного паттерна: второй state graph рядом с DKT, debug/worker-dump traversal как production data, внешняя orchestration-цепочка, polling вместо event-driven ожиданий.

## Память по проекту MiniCut

### 1. Базовый закон репозитория

1. Running editor contour должен быть DKT-only.
2. React читает scoped attrs/rels top-down через `One`, `Many`, `Path` и dispatch-ит scoped/root DKT actions.
3. Boundary code допускается только как IO/runtime layer: files, object URLs, media probe, P2P transport, export renderer, worker compute, storage, network.
4. Любой boundary result должен вернуться в DKT через actions/tasks/effects.
5. Старые registry/Legend/source-id документы относятся к historical context/main-branch memory; в этой ветке это не running production path.

### 2. Запрещённые паттерны

- Читать command snapshots, debug dumps, replica graph или read-model helpers как production business state.
- Сканировать debug/replica graph, чтобы искать clip/resource/effect/text/project или dispatch scope.
- Реализовывать workflow как `dispatch -> await -> read state -> dispatch more`.
- Держать второй state graph в import/export/P2P layer.
- Возвращать source-id traversal вместо `_node_id` + owner rel traversal.
- Строить fallback runtime, compatibility runtime, legacy store branch или registry-shaped session attrs.
- Компенсировать missing owner rel запись join-ами по root-routed rels в render path.
- Заменять архитектурную дыру большим таймаутом в Playwright.

### 3. Обязательные паттерны

- Multi-step model workflows живут внутри DKT action arrays.
- Для передачи результата между шагами используется `$output`.
- Вложенные model workflows держатся внутри `sub_flow` или эквивалентного inline pattern.
- Owner rel должен записываться в той же транзакции, где создаётся child model.
- Missing field должен исправляться на owning DKT model: attr, comp attr, rel, comp rel, action или effect.

### 4. Owner rel и transaction rules

Критическое наблюдение для MiniCut: root-routed create без owner rel - не временный недочёт, а полноценная ошибка модели.

Особенно важно:

- `Project.importResource` обязан писать `Project.resources` в той же DKT action/saga.
- `Track.addClip`, `Track.addTextClip`, `Track.splitClipAt` обязаны корректно обновлять `Track.clips`.
- `Clip.addEffect` обязан обновлять `Clip.effects`.
- Для clip/text/resource/effect relations нельзя рассчитывать, что UI потом сам что-то «дособерёт» обходом graph.

### 4.1. Time purity rules

В DKT-моделях время - это dependency или payload, а не императивный global read.

Запрещено в `attrs.comp`, `rels.comp`, `action.fn`, reducers и model-level helper
functions, вызываемых из них:

```js
Date.now()
new Date()
performance.now()
```

Почему это критично:

- `action` и `comp` должны быть воспроизводимыми относительно объявленных deps;
- скрытое чтение часов ломает deterministic tests, replay, sync/storage,
  lazy-load и future orchestration/recovery;
- DKT не видит такой dependency и не может корректно reinit/watch/export schema.

Используй альтернативы:

| Задача | Чем заменить | Документация |
| --- | --- | --- |
| Derived time condition: expired, active interval, local day, timed out | `$meta$time` dependency в `comp` attr | [$meta$time в comp attrs](</D:/code/linkcraft/dkt/docs/State/meta-time-comp-reference-ru.md>) |
| Записать `createdAt`, `updatedAt`, `startedAt`, `completedAt` в action | `$now` или текущий DKT time action-dep; если syntax отличается, сначала добавить/уточнить DKT time dep, не использовать `Date.now()` | [AppGuide README](</D:/code/linkcraft/dkt/docs/AppGuide/README.md>) |
| Реальный timeout/scheduler/timer | `effects.out`, `$fx_` или runtime task boundary, который потом dispatch-ит явный DKT action/event payload со временем | [`$fx_` usage guide](</D:/code/linkcraft/dkt/docs/fx-usage-guide-ru.md>) |
| Deterministic tests для timeout/recovery | explicit tick/event payload, например `{ now }`, затем отдельный read step | [Flow step read/write boundaries in tests](</D:/code/linkcraft/dkt/docs/internal/flow-step-read-write-testing.md>) |
| Schema/reinit tooling для generated time deps | generated `$meta$time` sources, не app attrs | [Meta Resource Schema Groups](</D:/code/linkcraft/dkt/docs/internal/meta-resource-schema-groups.md>) |

Пример derived attr:

```js
attrs: {
  timeoutAt: ['input', null],

  isTimedOut: [
    'comp',
    ['$meta$time/instant/[:timeoutAt]'],
    Boolean,
  ],
}
```

Пример timestamp write:

```js
actions: {
  markStarted: {
    to: {
      startedAt: ['startedAt'],
      updatedAt: ['updatedAt'],
    },
    fn: [
      ['$now'],
      (_payload, now) => ({
        startedAt: now,
        updatedAt: now,
      }),
    ],
  },
}
```

Если `$now` в текущем DKT runtime называется иначе или еще не подключен в этом
контуре, это blocker для timestamp write: сначала подключить правильный DKT
time action-dep, а не обходить его через `Date.now()`.

### 4.2. UI projection ownership

UI может решать layout, порядок визуальных блоков, локальные labels и DOM
structure. Domain projection должна жить в DKT model layer.

Если компоненту нужна готовая форма данных, сначала раздели ее на две части:

- Domain projection: какие модели видимы, какая сущность active/latest, какой
  state/detail/flag показывать. Это `comp rel` или маленькие `comp attrs` на
  owning model.
- Layout projection: как уже готовые attrs разложить в DOM, какие короткие
  labels использовать, какой визуальный компонент выбрать. Это может оставаться
  в renderer.

Практическая форма:

- Набор существующих моделей для render traversal - `comp rel`, например
  filtered/ordered/visible relation. Это сохраняет stable scope list и `_nodeId`
  keys.
- State, flag, counter или detail для конкретной модели - отдельный `comp attr`
  на владельце состояния.
- Fixed gates/summary slots, которые не являются child model list, - отдельные
  маленькие `comp attrs` на ближайшей owning model.
- Renderer читает declared attrs/rels и рендерит их; он не вычисляет domain
  semantics.

Запрещенные признаки renderer read-model:

- компонент ищет latest/active по rel list;
- компонент фильтрует domain statuses, чтобы решить, какие модели существуют
  для бизнес-смысла;
- компонент агрегирует child states в parent state;
- компонент строит большой synthetic array/object, где смешаны domain state,
  traversal, latest selection и UI labels;
- один большой `comp attr` возвращает nested view-model вместо точечных attrs и
  rels.

Правило выбора: если изменение значения должно быть видно DKT как dependency,
diff, persisted/synced state или testable model contract, это не layout - это
`comp attr`/`comp rel`.

### 5. Identity и node-id contract

Текущий contract этой ветки:

- Канонический identity - DKT `_node_id`.
- `selectedEntityId` хранит clip node id.
- `activeProjectId` хранит project node id.
- Export/preview/resource transfer используют node ids.
- Новые изменения не должны расширять внутреннюю зависимость от `sourceProjectId/sourceTrackId/sourceResourceId/sourceClipId/sourceTextId/sourceEffectId/sourceResourceName`.

Практический вывод:

- Source ids допустимы только как historical docs, external labels, compatibility payloads или test fixtures. Внутренний backbone системы - node ids и semantic owner rels.

### 6. DKT path и action notes

- `$noop` - это DI token, а не строковый sentinel.
- `$output` должен быть явным, если следующий step зависит от результата предыдущего.
- `$input*` не означает «поле payload», а интерпретирует payload как runtime model base.
- `<<` идёт вниз по rel.
- `<<<<` идёт вверх к root/parent.
- `<< @all:relName` полезен для чтения many-rel refs.
- `hold_ref_id` и `use_ref_id` работают как same-flow механизм для newly created refs.

### 7. DKT page stream и render rules

- Page runtime - это stream receiver, а не snapshot API.
- React должен работать от текущего scoped traversal path и объявленных shapes.
- Debug dumps, receiver model objects, local replica scans и worker state dumps нельзя использовать как production data path.
- Reading direct rel в строго техническом boundary допустим, но новый feature logic должен жить в DKT model layer, а не в app traversal helpers.

### 8. Skeleton race и безопасный render

В MiniCut уже подтверждён skeleton race:

- rel membership может приехать раньше attrs;
- новый clip/resource временно виден как scope с `null` attrs;
- позиционные вычисления по `null` опасны, особенно для clip geometry.

Из этого следуют правила:

- Для clip rendering нужны ready guards по `start` или аналогичному semantic attr.
- Для resources безопасно ждать `name`.
- Тесты не должны кликать элемент сразу после visibility, если semantic attrs ещё не стабилизировались.
- Если page уже показывает child в rel, а attrs догоняют через 10-30ms, это не обязательно compute bug в worker.

### 9. Import boundary memory

- File handling, object URL creation и metadata probe - boundary work.
- UI не должен сам принимать domain-решения о track placement, active project logic или timeline emptiness через page/debug reads.
- Runtime refs для `File`, Blob и других non-serializable values - допустимая boundary plumbing.
- Но runtime-task facade не должна становиться бизнес-слоем, который дублирует модельные решения.

### 10. Export pipeline memory

Жёсткие правила по export:

- SessionRoot остаётся owner export state.
- Экспорт должен идти по одному пути: root action -> DKT `$fx_`/runtime-task -> page-side executor -> progress/completion обратно в DKT.
- Нельзя смешивать trigger-attr path и `$fx_` call path для одного и того же эффекта.
- Нельзя возвращать fallback export plan builder в adapter business flow.
- `resourceTransferManager.resolveResourceUrl(resourceId, fallbackUrl)` важен в момент старта export.
- Пустой `resourceUrl` может дать тихую поломку audio pipeline.
- UI labels обязаны называть реальный экспортный формат.

### 11. P2P, CRDT и transfer rules

- Default runtime остаётся shared-worker/local authority path; P2P/product-room authority bootstrap остаётся opt-in через room/signal configuration.
- P2P tests должны иметь deterministic room ids и cleanup через `try/finally`.
- Replica tests должны явно выбирать synced project, а не надеяться на implicit selection.
- Для CRDT timing-conflict tests нужны небольшие различающиеся deltas, иначе min-duration clamp может скрыть конфликт.
- Resource transfer должен мыслить resource node ids как основной identity.
- Test/debug payloads, идущие через `postMessage`, должны быть structured-clone-safe.

### 12. Testing discipline

Надёжные команды:

```powershell
npm run test:video-editor
npm run test:video-editor -- <paths>
npm run test:video-editor:shared -- <paths>
npm run test:video-editor:isolated -- <paths>
npm run test:video-editor:node -- <paths>
npm run test:video-editor:crdt
npm run test:integration:fast
npm run test:integration:fast:shared-cache
npm run test:integration:p2p
npm run test:integration:p2p:smoke
npm run test:integration:p2p:slow
npm run test:integration:p2p:shared-cache
npm run test:integration:crdt
npm run test:integration:crdt:smoke
npm run test:integration:crdt:conflict
npm run test:integration:export
npm run test:integration:profile
npm run test:integration:serial
npm run guard:dkt-hard
npm run video-editor:build
npm run node:headless:run
```

Текущий тестовый surface:

- Около 116 test/spec/testing files в `test`, `tests` и `src/video-editor`.
- Около 18 Playwright integration specs в `tests/integration`.
- Около 53 DKT-area tests под `src/video-editor/dkt`.
- Export suite теперь покрывает WebCodecs/MediaRecorder fallback, audio parity, visual parity и artifact inspection.
- P2P/CRDT suite включает room/workspace storage, reconnect, mixed engine media, large transfer/preview strategy, real conflict UX и maelstrom-level simulations.

Практические правила тестирования:

- Сначала узкий DKT model/runtime test, потом широкий Playwright.
- Tests должны создавать состояние через DKT actions или DKT task completions.
- Page runtime tests должны bootstrap-ить runtime и монтировать shapes, которые реально объявляют нужные attrs/rels.
- Assertions должны описывать product/domain contract, а не historical implementation detail.
- Export completion лучше ждать через event-driven trackers/subscriptions, а не через polling loops.
- Polling helpers допустимы только как явные testing/bootstrap utilities, а не как основной путь ожидания pipeline completion.

Текущие test hazards:

- `tests/integration/video-editor.spec.ts` - широкий smoke с import/add-to-timeline/export/playback paths; при падении сначала проверять semantic waits и debug bridge, а не увеличивать timeout.
- Export/P2P/CRDT specs проходят через browser/worker/media/network boundaries; rerun допустим как triage, но фикс должен быть event/semantic based.
- Exact labels и exact counts остаются хрупкими; лучше проверять semantic state, artifact metadata, DKT rels/attrs или user-visible contract.

### 13. Debugging memory

Когда нужно отличить worker compute bug от page replica/render timing issue:

- Сравнивать page-side debug view и raw inbound runtime messages на близком timestamp.
- Если sync payload уже содержит правильные attrs, а UI кратко показывает null/partial state, причина вероятнее в replica/render timing, а не в worker computation.
- Debug helpers надо держать в test/debug surface, не превращая их в production data API.

## DKT reference docs для MiniCut workers

### 14. Хранить связи между nodes/models как rels

А не как id внутри атрибутов. использовать $input_id (saga action) если нужно взаимодействовать с id (node_id) пришедшим извне. Использовать id -> $input_id вместо, models_list.find() {match by id}, стараться не хранить и не использовать id Для внутреннего использования


### 15 Demux в DI interface -> много effect in subscribe
Когда данные проходят через границу (мир side effects => pure data {dkt}) то в этих случаях универстальные сообщения с параметром вроде event_name нужно дробить на уровне interface DI (вне dkt state), вместо того чтобы создавать огромный action со множеством `if (event_name == '...') {}`

### 16 Не делать microtask, delay и прочей магии с отложенными исполнением (ни в коде ни в тестах). Вместо этого разбираться в чем дело, правильно строить ожидания (но dkt код не должен строиться на await), проверять flow-step-read-write-testing.md


### Читать первым

- [Flow step read/write boundaries in tests](</D:/code/linkcraft/dkt/docs/internal/flow-step-read-write-testing.md>) - важнейший документ для DKT-тестов. State mutation и state read должны быть в разных flow step-ах; `queryAttr`, `queryRel`, `queryAddr` надо читать внутри `app.input(async () => ...)` или helper-а `readInput`.

Пример:

```js
await runInput(app_model, async () => {
  await clip.dispatch("rename", { name: "Intro" })
})

await readInput(app_model, async () => {
  expect(await clip.queryAttr("name")).toBe("Intro")
})
```

- [AppGuide README](</D:/code/linkcraft/dkt/docs/AppGuide/README.md>) - практическая рамка DKT: pure data + pure functions + declarative side effects. Читать перед любыми новыми model/action/effect изменениями.

Пример: action возвращает data descriptor, а I/O уходит в `effects` или `$fx_`, не в тело action.

```js
actions: {
  requestExport: {
    to: ["$fx_renderExport"],
    fn: (payload) => ({ request: payload }),
  },
}
```

- [DKT Model-First Rendering AppGuide](</D:/code/minicut/src/dkt-react-sync/docs/model-rendering-appguide-ru.md>) - MiniCut-specific rendering guide: top-down по DKT model tree, current scope, `useAttrs`, `One`, `Many`, `Path`, local `useActions`, и запрет на graph-wide selectors/debug traversal в render path.

Пример: компонент внутри `<Many rel="clips">` читает attrs текущего clip через `useAttrs(["start", "duration"])`; если нужен project-level summary, он должен быть comp/rel на модели, а не вычисляться поиском по replica graph.

### Actions, flow и адресация

- [DKT addressing и special addresses](</D:/code/minicut/docs/dkt-addressing-and-spec-addr-ru.md>) - как читать и писать deps/targets: `state`, `nesting`, `resource`, `base`, а также `<<`, `<<<<`, `$input`, `$output`, `$noop`.

Пример: `"< @all:clipRenderData < tracks.clips"` читает `clipRenderData` у всех clips через `tracks.clips`.

- [State nests/rels reference](</D:/code/linkcraft/dkt/docs/State/nests.md>) - краткий reference по rel declarations: `nest`, `model`, `conj`, `sel`, `compx`. Полезно, когда нужно выбрать правильный тип relation вместо ручного traversal или debug scan.

Пример:

```js
rels: {
  clips: ["input", { many: true, linking: "<< clip << #", role: "owner" }],
  activeClips: ["sel", { from: "clips", where: { ">duration": [">", 0] } }],
}
```

Пример `sel`, где критерий справа - другой attr/state, а не захардкоженное значение:

```js
rels: {
  projectReviewItems: [
    "sel",
    {
      from: "$root.reviewItem",
      where: {
        ">projectId": ["=", "_node_id"],
      },
    },
  ],
}
```

Здесь `>projectId` читается у candidate item из `reviewItem`, а `_node_id` читается у текущей модели. Для literal/static value DKT использует массив из одного элемента, например `{ ">isOpen": ["=", [true]] }`.

- [Saga Action Reference](</D:/code/linkcraft/dkt/docs/State/saga-action-reference.md>) - reference по многошаговым actions, `$input`, `$output`, `hold_ref_id`, `use_ref_id`, `when`, child action calls и `sub_flow`.

Пример:

```js
[
  {
    to: { clip: ["<< clip << #", { can_create: true, can_hold_refs: true }] },
    fn: () => ({ clip: { attrs: { name: "Intro" }, hold_ref_id: "newClip" } }),
  },
  {
    to: { clips: ["<< clips", { can_use_refs: true }] },
    fn: () => ({ clips: { use_ref_id: "newClip" } }),
  },
]
```

- [State passes](</D:/code/linkcraft/dkt/docs/State/passes.md>) - low-level reference по `to` options: `method`, `action`, `can_create`, `creation_shape`, `can_use_refs`, `can_hold_refs`, step-level walker contracts.

Пример: `["<< clips", { method: "at_end", can_use_refs: true }]` добавляет ref в rel через previously held ref.

- [CRDT Relation Method Mapping](</D:/code/linkcraft/dkt/docs/crdt/crdt-relation-method-mapping.md>) - reference по тому, как `action.to` rel target `method` превращается в domain relation update и CRDT op. Для user edits предпочитай semantic methods (`at_end`, `without`, `insert_after_id`, `insert_before_id`, `replace`) вместо грубых `set_many`/`set_one`, потому что они точнее выражают intent, stable anchors и conflict context.

Пример: reorder/move клипа лучше писать как `["<< clips", { method: "insert_after_id" }]` с payload `{ id: previousClipIdOrNull, value: clipRef }`; `set_many` оставлять для import/restore/repair full list.

- [Flow transaction boundary guide](</D:/code/linkcraft/dkt/docs/internal/flow-transaction-boundary-guide.md>) - как выбирать `input`, `nextTick`, `scheduleFollowupTransaction`, `planSequence`, чтобы не создавать второй action/queue system.

Пример: CRDT sync recap должен идти как ordered follow-up transaction, а не как произвольный `dispatch` из callback-а.

### Effects, runtime refs и AppGuide practice

- [`$fx_` usage guide](</D:/code/linkcraft/dkt/docs/fx-usage-guide-ru.md>) - декларативный запуск side effects из action без промежуточного trigger attr/out-effect boilerplate.

Пример:

```js
actions: {
  loadWeather: {
    to: ["$fx_weather", { intent: "request" }],
    fn: () => ({}),
  },
}
```

- [AppGuide Cookbook](</D:/code/linkcraft/dkt/docs/AppGuide/Cookbook.md>) - практические рецепты: pure data vs side effects, state_request, `$fx_`, comp attrs, refs, API injection, file organization.

Пример: computed state писать как `comp`, а не синхронизировать вручную action-ом.

- [AppGuide Cheatsheet](</D:/code/linkcraft/dkt/docs/AppGuide/Cheatsheet.md>) - короткий синтаксис для models, attrs, rels, actions, effects, `$fx_`, addresses, refs, router.

Пример: держать рядом при написании `to` targets и rel deps.

- [AppGuide FAQ](</D:/code/linkcraft/dkt/docs/AppGuide/FAQ.md>) - быстрые ответы на типичные вопросы: почему action не вызывает action, когда `$fx_`, когда `effects.out`, почему trigger не сработал, что значит API gate.

Пример: если нужно синхронно отреагировать на attr без async/API, смотреть `handleAttr:`, а не out-effect.

- [Dispatch task runtime ref AppGuide](</D:/code/linkcraft/dkt/docs/AppGuide/dispatch-task-runtime-ref-appguide-ru.md>) - когда нужно передать live runtime object (`File`, `Blob`, object URL, worker handle) через task/runtimeRef и как не превращать это в business state.

Пример: import action получает handle id, effect берёт runtime ref, а результат возвращает в DKT action/task completion.

- [Router Spyglass Guide](</D:/code/linkcraft/dkt/docs/AppGuide/Router-Spyglass-Guide-RU.md>) - router/scoped spyglass/view context patterns. Для MiniCut полезно как аналогия, когда нужно проектировать scoped page/runtime views.

- [DTeor sample rules](</D:/code/linkcraft/dkt/docs/AppGuide/DTeor-Sample-Rules-RU.md>) - правила `dk-import`, `dk-rel`, `sample_name`, `dk-inline-sample`. Применимо только если работа касается DTeor/view templates, не обычных MiniCut React components.

Пример: sample для `dk-import` должен иметь `dk-inline-sample`, а sample для `dk-rel`/`sample_name` не должен.

- [TMP handleRel walker-form vs inline saga depth overflow](</D:/code/linkcraft/dkt/docs/AppGuide/tmp-inline-saga-depth-overflow-handleRel.md>) - временная заметка про depth overflow в reactive `handleRel` walker-form. Читать при ошибках inline saga depth или при рефакторе reactive handleRel.

### CRDT, review и meta resources

- [DKT CRDT conflict review API reference](</D:/code/linkcraft/dkt/docs/internal/dkt-crdt-conflict-review-api-reference.md>) - app-root CRDT handlers, conflict record shape, `$meta$crdt` deps, `$crdt:*` commands и workflow materialization.

Пример: UI должен читать conflict review через `$meta$crdt`/review materialization, а resolve отправлять через declared command/action path.

- [CRDT conflict anchor](</D:/code/linkcraft/dkt/docs/internal/crdt-conflict-anchor.md>) - как помечать conflict anchor на attrs/rels, чтобы conflict metadata привязывалась к правильной user-facing сущности.

Пример: timeline conflict anchor ставить на `Track.clips`/clip timing field, а не на случайный projection attr.

- [CRDT explicit field exclusions](</D:/code/linkcraft/dkt/docs/internal/crdt-explicit-field-exclusions.md>) - какие поля явно исключать из CRDT sync и почему: projections, runtime-only attrs, pipeline/status attrs.

Пример: `importProgress` или `previewFrame` должны оставаться local/projection, если они не являются collaborative domain state.

- [Meta Resource Schema Groups](</D:/code/linkcraft/dkt/docs/internal/meta-resource-schema-groups.md>) - schema grouping для meta resources и user deps; важно для `$meta$crdt` и подобных provider-backed deps.

Пример: list resource group может объединять несколько `$meta$crdt` deps с общим provider source.

- [$meta$time в comp attrs](</D:/code/linkcraft/dkt/docs/State/meta-time-comp-reference-ru.md>) - time deps для comp attrs: instant, interval, local date, projections и generated internal attrs.

Пример: если model comp зависит от текущего времени, использовать `$meta$time`, а не `Date.now()` внутри action/comp reducer.

## Чеки по типу изменений

### DKT model/action change

```powershell
npm run test:video-editor -- src/video-editor/models
npm run test:video-editor -- src/video-editor/dkt
npm run test:video-editor:crdt
```

### Export change

```powershell
npm run test:video-editor:node -- src/video-editor/dkt/runtime/createMiniCutDktRuntime.exportRequest.test.ts
npm run test:video-editor -- src/video-editor/app/runtimeTaskFacade.test.ts
npm run test:video-editor -- src/video-editor/app/renderExportTaskExecutor.contract.test.ts
npm run test:integration:export
```

### Import/resource transfer/P2P change

```powershell
npm run test:video-editor -- src/video-editor/media
npm run test:video-editor -- src/video-editor/dkt/importTasks.test.ts
npm run test:video-editor -- src/video-editor/app/runtimeTaskFacade.test.ts
npm run test:integration:p2p:smoke
```

### CRDT/review/room storage change

```powershell
npm run test:video-editor:crdt
npm run test:video-editor -- src/video-editor/dkt/review
npm run test:integration:crdt:smoke
```

### UI/render/color change

```powershell
npm run test:video-editor -- src/video-editor/components
npm run test:video-editor -- src/video-editor/render
npm run test:integration:fast
```

Если script не прокидывает path:

```powershell
npx playwright test -c playwright.p2p.config.js tests/integration/p2p-media-transfer.spec.ts
```

### Hard-law guard и build

```powershell
npm run guard:dkt-hard
npm run video-editor:build
```

Полезные grep-проверки:

```powershell
rg -n "exportRequestIntent|buildFallbackExportPlan|dispatchClipActionById" src test tests
rg -n "source(Project|Track|Resource|Clip|Text|Effect)Id|sourceResourceName" src tests
rg -n "readOne\(|readMany\(|readAttrs\(" src/video-editor src/dkt-react-sync
rg -n "MP4|video-webm|webm" src/video-editor/components src/video-editor/app src/video-editor/models
```

Интерпретация:

- `exportRequestIntent` и `buildFallbackExportPlan` должны оставаться нулевыми в production code; `dispatchClipActionById` допустим только в testing/debug surfaces.
- Source-id hits в production code подозрительны, если они становятся traversal/identity backbone; в docs/tests/compatibility payloads они могут быть historical context.
- `readOne/readMany/readAttrs` ожидаемы в `src/dkt-react-sync/**`, тестах, `*.testing.*` и узких page-runtime boundaries, но не в feature business flow.
