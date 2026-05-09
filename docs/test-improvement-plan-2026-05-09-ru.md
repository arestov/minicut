# План улучшения тестов MiniCut

Дата: 2026-05-09

Цель документа: привести тесты текущей `dkt-render` ветки к состоянию, где они проверяют продуктовые и доменные контракты, а не случайные детали реализации DKT-миграции. Отдельный фокус: ожидания вычислений, производительность тестов и изоляция P2P-сценариев.

## Краткий диагноз

Ветка добавила полезный слой DKT/model/react-sync тестов и усилила браузерные сценарии экспорта, preview и P2P. Но часть старых тестов с `main` была удалена вместе с важными гарантиями:

- graph invariants после последовательности команд;
- validation ошибок и запретов;
- сохранение duration/source mapping после split;
- contract-level проверки patch/runtime поведения;
- часть пользовательских jsdom-сценариев через Testing Library.

Новые тесты местами проверяют правильные вещи, но часто делают это слишком низкоуровнево:

- прямые вызовы reducer-функций с ожиданием конкретного округленного числа;
- проверки `console.log`-ориентированных debug-сценариев;
- длинные Playwright-тесты, в которых смешаны user flow, export, layout, debug state и внутренние window debug API;
- CSS-локаторы там, где можно проверить доступный пользовательский интерфейс;
- дорогие P2P сценарии, которые частично повторяют unit/integration контракты.

Главный принцип для исправления: тест должен падать, когда ломается смысл поведения, и не должен падать от невидимой для пользователя или потребителя перестановки реализации.

## Принципы

### 1. Проверять наблюдаемое поведение

Для UI-тестов ориентироваться на подход Testing Library: тест взаимодействует с приложением так, как пользователь или assistive technology. Предпочтительный порядок:

1. `getByRole` с доступным именем.
2. `getByLabelText` / `getByLabel`.
3. Видимый текст, если это реально часть UX.
4. `data-*` только для технических диагностических поверхностей, canvas/media/layout и явно не пользовательских контрактов.
5. CSS-классы только для layout/pixel/geometry проверок, где роль не выражает нужный факт.

Плохо:

```ts
await page.locator('.ve-resource-row').filter({ hasText: 'clip.webm' })
  .getByRole('button', { name: 'Add to timeline' })
  .click()
```

Лучше:

```ts
const mediaBin = page.getByRole('region', { name: 'Media bin' })
const resource = mediaBin.getByRole('listitem', { name: /clip\.webm/i })
await resource.getByRole('button', { name: 'Add to timeline' }).click()
```

Если компонента пока не имеет правильной роли или имени, это не повод закреплять CSS-класс в тесте. Лучше доработать доступность компонента и тестировать через нее.

### 2. Проверять контракты, а не форму реализации

Плохо:

```ts
expect(reduceTimelineMoveByAction({ delta: 2.25 }, attrs)).toEqual({ start: 3.3 })
```

Этот тест говорит, что функция вернула `3.3`, но не объясняет, почему это важно. Он также привязывает тест к конкретному reducer API.

Лучше:

```ts
it('moving a clip clamps start to timeline zero and rounds to frame UI precision', () => {
  const moved = moveClip({ start: 1, duration: 4 }, { delta: -4 })

  expect(moved.start).toBe(0)
  expect(moved.duration).toBe(4)
})
```

Для DKT action лучше еще выше:

```ts
it('moveBy never creates a negative clip start', async () => {
  const { ctx, clip } = await createProjectWithClip({ start: 1, duration: 4 })

  await ctx.lockToRead(async () => {
    await clip.dispatch('moveBy', { delta: -4 })
  })

  expect(ctx.getAttr(clip, 'start')).toBe(0)
  expect(ctx.getAttr(clip, 'duration')).toBe(4)
})
```

### 3. Разделять уровни тестов

Нужны четыре явных слоя:

- **Pure calculation tests**: быстрые тесты математических функций и форматтеров.
- **Model/DKT contract tests**: действие над моделью, затем инварианты графа и состояния.
- **React/component tests**: DOM-результат и user interactions через Testing Library.
- **Playwright E2E/P2P/export tests**: минимальное число дорогих end-to-end сценариев, проверяющих склейку систем.

Каждый баг должен закрываться на самом дешевом уровне, который ловит его с достаточной уверенностью. E2E не должен быть единственным местом, где проверяется базовая арифметика split/trim/append.

### 4. Для вычислений проверять свойства

Численное ожидание должно быть связано с бизнес-смыслом:

- monotonicity;
- bounds/clamping;
- conservation laws;
- idempotency;
- source mapping;
- exactness только там, где точность является контрактом;
- tolerance через `toBeCloseTo` для floating point.

Пример для split:

```ts
const expectSplitInvariant = (
  before: { start: number; in: number; duration: number; resourceId: string },
  left: { start: number; in: number; duration: number; resourceId: string },
  right: { start: number; in: number; duration: number; resourceId: string },
  splitTime: number,
) => {
  expect(left.start).toBe(before.start)
  expect(right.start).toBeCloseTo(splitTime, 6)
  expect(left.duration + right.duration).toBeCloseTo(before.duration, 6)
  expect(right.in).toBeCloseTo(before.in + left.duration, 6)
  expect(left.resourceId).toBe(before.resourceId)
  expect(right.resourceId).toBe(before.resourceId)
  expect(left.duration).toBeGreaterThan(0)
  expect(right.duration).toBeGreaterThan(0)
}
```

Этот helper лучше, чем набор независимых `expect(duration).toBe(2)`: он выражает закон операции.

## Целевая структура тестов

### Быстрый unit/model слой

Файлы:

- `src/video-editor/domain/**/*.test.ts` или новый `src/video-editor/dkt/contracts/**/*.test.ts`;
- `src/video-editor/render/**/*.test.ts`;
- `src/video-editor/media/**/*.test.ts`;
- `src/video-editor/color/**/*.test.ts`.

Содержимое:

- pure calculations;
- model actions через DKT runtime;
- graph invariants;
- validation;
- runtime task boundaries.

Запуск должен быть быстрым и стабильным:

```bash
npm run test:video-editor:node
npm run test:video-editor
```

### Компонентный UI слой

Файлы:

- `src/dkt-react-sync/**/*.test.tsx`;
- `src/video-editor/components/**/*.test.tsx`;
- при необходимости новый `src/video-editor/tests/*.test.tsx`.

Содержимое:

- rendering from model snapshot;
- user interactions through `userEvent`;
- accessible roles/labels;
- отсутствие проверки приватных React props/state.

### Playwright слой

Файлы:

- `tests/integration/video-editor.spec.ts`;
- `tests/integration/export-audio-artifacts.spec.ts`;
- `tests/integration/responsive-design.spec.ts`;
- `tests/integration/p2p-*.spec.ts`.

Содержимое:

- smoke/happy path;
- cross-browser/media/export behavior;
- P2P handshake/transfer/failover;
- layout only там, где jsdom не дает доверия.

Нужно уменьшать количество сценариев, которые проходят полный import -> render -> export, если тот же контракт уже доказан ниже.

## План работ

### Шаг 1. Ввести test contract helpers

Создать файл:

```text
src/video-editor/dkt/test/assertions.ts
```

Пример:

```ts
import type { ModelHandle } from './types'

export const expectClipTiming = (
  ctx: TestDktContext,
  clip: ModelHandle,
  expected: {
    start?: number
    in?: number
    duration?: number
  },
) => {
  if (expected.start != null) {
    expect(ctx.getAttr(clip, 'start')).toBeCloseTo(expected.start, 6)
  }
  if (expected.in != null) {
    expect(ctx.getAttr(clip, 'in')).toBeCloseTo(expected.in, 6)
  }
  if (expected.duration != null) {
    expect(ctx.getAttr(clip, 'duration')).toBeCloseTo(expected.duration, 6)
  }

  expect(Number(ctx.getAttr(clip, 'start'))).toBeGreaterThanOrEqual(0)
  expect(Number(ctx.getAttr(clip, 'in'))).toBeGreaterThanOrEqual(0)
  expect(Number(ctx.getAttr(clip, 'duration'))).toBeGreaterThan(0)
}
```

Добавить:

```ts
export const expectProjectGraphInvariants = async (ctx: TestDktContext) => {
  const graph = await ctx.dumpGraph()

  for (const node of graph.nodes) {
    for (const [relName, value] of Object.entries(node.rels ?? {})) {
      const ids = Array.isArray(value) ? value : value ? [value] : []
      for (const id of ids) {
        expect(graph.nodesById[id], `${node.nodeId}.${relName} references missing ${id}`).toBeTruthy()
      }
    }

    for (const [attrName, value] of Object.entries(node.attrs ?? {})) {
      if (typeof value === 'number') {
        expect(Number.isFinite(value), `${node.nodeId}.${attrName} is non-finite`).toBe(true)
      }
    }
  }
}
```

Если `dumpGraph()` сейчас не возвращает удобный индекс, добавить helper локально в тестах, не менять production API только ради теста.

### Шаг 2. Вернуть invariant coverage из `main` на DKT-модельном уровне

Создать:

```text
src/video-editor/dkt/models/timelineInvariants.test.ts
src/video-editor/dkt/models/validationInvariants.test.ts
src/video-editor/dkt/models/randomActionInvariants.test.ts
```

Что покрыть:

- split сохраняет суммарную длительность;
- right clip сохраняет resource/source mapping;
- `in` у right clip смещается на left duration;
- duration всегда положительный;
- start/in не уходят ниже нуля;
- удаление clip не оставляет dangling refs;
- locked track запрещает clip mutations;
- video resource не добавляется в audio track;
- invalid duration/opacity rejected или normalized согласно DKT-контракту;
- повторный import с тем же именем создает отдельные ids.

Пример:

```ts
it('split preserves total duration and source mapping', async () => {
  const { ctx, videoTrack, clip } = await createProjectWithClip({
    sourceClipId: 'clip:source',
    sourceResourceId: 'res:video',
    start: 0,
    in: 1,
    duration: 7,
  })

  const before = readClipForInvariant(ctx, clip)

  await ctx.lockToRead(async () => {
    await clip.dispatch('splitSelfAt', { time: 2.75 })
  })

  const clips = await ctx.queryRel(videoTrack, 'clips')
  const left = clips.find((item) => ctx.getAttr(item, 'sourceClipId') === 'clip:source')
  const right = clips.find((item) => item !== left)

  expect(left).toBeTruthy()
  expect(right).toBeTruthy()
  expectSplitInvariant(before, readClipForInvariant(ctx, left!), readClipForInvariant(ctx, right!), 2.75)
  await expectProjectGraphInvariants(ctx)
})
```

### Шаг 3. Переписать debug-style DKT тесты

Файл-кандидат:

```text
src/video-editor/dkt/models/addResourceToTimeline-appendStart.test.ts
```

Что сделать:

- удалить `console.log`;
- разбить длинные сценарии на маленькие arrange/act/assert;
- заменить `expect(imageStart).toBe(1.5)` на контракт append:
  - новый clip стартует на текущем `appendStart`;
  - `appendStart` после добавления равен max end;
  - video/audio tracks независимы;
  - image не меняет audio track;
  - audio не меняет video track.

Пример:

```ts
it('appends image clip at the end of the video track without touching audio track', async () => {
  const { ctx, project, videoTrack, audioTrack } = await setupProjectWithImportedVideo()
  const videoAppendBefore = ctx.getAttr(videoTrack, 'appendStart')
  const audioClipCountBefore = (await ctx.queryRel(audioTrack, 'clips')).length

  await importReadyResource(ctx, project, {
    sourceResourceId: 'res:image',
    kind: 'image',
    duration: 1,
  })

  await ctx.lockToRead(async () => {
    await project.dispatch('addResourceToTimeline', { sourceResourceId: 'res:image' })
  })

  const imageClip = await findClipByResource(ctx, videoTrack, 'res:image')
  expectClipTiming(ctx, imageClip, { start: videoAppendBefore, duration: 1 })
  expect(await ctx.queryRel(audioTrack, 'clips')).toHaveLength(audioClipCountBefore)
  expect(ctx.getAttr(videoTrack, 'appendStart')).toBeCloseTo(videoAppendBefore + 1, 6)
})
```

### Шаг 4. Сделать вычислительные ожидания устойчивыми

Файлы-кандидаты:

- `src/video-editor/dkt/timelineActions.test.ts`;
- `src/video-editor/models/SessionRoot/actions.test.ts`;
- `src/video-editor/render/timing.test.ts`;
- `src/video-editor/media/resourceTransferScheduler.test.ts`;
- `src/video-editor/render/colorScopes.test.ts`.

Что улучшить:

- для rounded time явно назвать precision contract;
- использовать `toBeCloseTo` для floating point;
- добавить property-style таблицы cases;
- проверять monotonic/bounds вместо полного internal snapshot.

Пример для timeline actions:

```ts
describe.each([
  { start: 1, delta: 2.25, expected: 3.25 },
  { start: 1, delta: -4, expected: 0 },
])('moveBy timing contract', ({ start, delta, expected }) => {
  it(`moves from ${start} by ${delta}`, () => {
    const result = reduceTimelineMoveByAction({ delta }, { start, in: 1, duration: 4 })

    expect(result?.start).toBeCloseTo(expected, 6)
    expect(result?.start).toBeGreaterThanOrEqual(0)
  })
})
```

Если production code intentionally rounds to one decimal, зафиксировать это явно:

```ts
it('rounds timeline edits to one decimal second because timeline UI operates in 0.1s steps', () => {
  expect(roundTimelineSeconds(3.25)).toBe(3.3)
})
```

Тогда reducer-тест не должен одновременно быть тестом rounding helper.

### Шаг 5. Усилить Testing Library слой

Для `src/dkt-react-sync`:

- оставить тесты `One`, `Many`, `Path`, `useAttrs`, `useActions`;
- заменить `fireEvent` на `userEvent` там, где это реальный user action;
- добавить проверки fallback/empty/error states;
- не проверять identity (`toBe`) без необходимости. Identity важна только если это performance contract, и тогда тест должен так называться.

Пример:

```ts
it('dispatches action from the current scope when user clicks rename', async () => {
  const user = userEvent.setup()
  const runtime = createTestReactScopeRuntime(...)

  render(...)

  await user.click(screen.getByRole('button', { name: 'Rename' }))

  expect(runtime.dispatchCalls).toEqual([
    expect.objectContaining({
      nodeId: 'project',
      action: 'rename',
    }),
  ])
})
```

Для editor components:

- восстановить jsdom happy-path как быстрый smoke без real browser export;
- проверить доступность основных regions/buttons;
- основные edit flows: import/add/select/split/trim/name/color/audio/text;
- избежать проверки CSS filter string там, где лучше проверить effect state и видимый preview state.

### Шаг 6. Упорядочить Playwright E2E

Текущий `tests/integration/video-editor.spec.ts` слишком большой. Разделить:

```text
tests/integration/editor-smoke.spec.ts
tests/integration/timeline-interactions.spec.ts
tests/integration/preview-rendering.spec.ts
tests/integration/export-smoke.spec.ts
tests/integration/layout.spec.ts
```

Правила:

- один файл отвечает за один риск;
- expensive export tests не повторяют базовые timeline edit tests;
- layout tests имеют право использовать bounding boxes/CSS;
- user flow tests используют roles/labels;
- вместо `waitForTimeout` использовать наблюдаемое состояние.

Плохо:

```ts
await page.waitForTimeout(700)
await expect(currentTime).not.toHaveText('0.00s')
```

Лучше:

```ts
await expect.poll(async () => Number((await currentTime.textContent())?.replace('s', '') ?? 0), {
  timeout: 2_000,
}).toBeGreaterThan(0)
```

### Шаг 7. Вынести Playwright helpers

Создать:

```text
tests/integration/helpers/editorApp.ts
tests/integration/helpers/mediaFixtures.ts
tests/integration/helpers/p2pRoom.ts
tests/integration/helpers/exportProbe.ts
```

Пример `editorApp.ts`:

```ts
export const createProjectFromMenu = async (page: Page) => {
  const projects = page.getByRole('region', { name: 'Projects' })
  await projects.getByRole('button').click()
  await projects.getByRole('menuitem', { name: 'New project' }).click()
  await expect(projects.getByRole('button', { name: /Project \d+/i })).toBeVisible()
}

export const addMediaToTimeline = async (page: Page, fileName: string) => {
  const mediaBin = page.getByRole('region', { name: 'Media bin' })
  const row = mediaBin.getByRole('listitem', { name: new RegExp(fileName, 'i') })
  await row.getByRole('button', { name: 'Add to timeline' }).click()
}
```

Это снизит дублирование и сделает будущий рефактор DOM дешевле.

## P2P: производительность и изоляция

### Текущее состояние

Плюсы:

- P2P вынесены в отдельный `playwright.p2p.config.js`;
- `fullyParallel: false`, `workers: 1`, значит глобальный signaling backend меньше рискует пересекать комнаты;
- room id генерируются уникально через `Date.now()` и `Math.random()`;
- многие тесты закрывают browser contexts вручную.

Риски:

- helpers `buildRoomUrl`, `getRole`, `getTransfers`, `openPeer` дублируются по файлам;
- уникальность room id не детерминирована и не привязана к `testInfo`, сложнее расследовать флейки;
- cleanup контекстов не везде централизован через `try/finally`;
- backend room state может переживать тест, если peer/context не закрылся из-за ошибки;
- mixed-engine P2P сценарии дорогие и serial, их надо держать в отдельном nightly/manual bucket;
- `expect.poll` часто дергает debug API без backoff и может создавать шум;
- тесты иногда проверяют transfer internals в браузерном E2E, хотя часть можно проверить unit-тестами `resourceTransferManager`.

### P2P helper для изоляции

Создать `tests/integration/helpers/p2pRoom.ts`:

```ts
import { expect, type Browser, type BrowserContext, type Page, type TestInfo } from '@playwright/test'

export type Peer = {
  context: BrowserContext
  page: Page
}

export const createRoomId = (testInfo: TestInfo, prefix = 'p2p') => {
  const stableTitle = testInfo.titlePath
    .join('-')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80)

  return `${prefix}-${testInfo.workerIndex}-${testInfo.repeatEachIndex}-${Date.now().toString(36)}-${stableTitle}`
}

export const buildRoomUrl = (roomId: string, params: Record<string, string | number> = {}) => {
  const search = new URLSearchParams({
    p2p: '1',
    signal: 'ws://127.0.0.1:8787/api/signal',
    ...Object.fromEntries(Object.entries(params).map(([key, value]) => [key, String(value)])),
  })

  return `/?${search.toString()}#/${roomId}`
}

export const openPeer = async (browser: Browser, roomUrl: string): Promise<Peer> => {
  const context = await browser.newContext()
  const page = await context.newPage()
  await page.goto(roomUrl)
  await expect(page.getByRole('heading', { name: 'minicut' })).toBeVisible()
  return { context, page }
}

export const closePeers = async (...peers: Array<Peer | null | undefined>) => {
  await Promise.all(
    peers
      .filter(Boolean)
      .map((peer) => peer!.context.close().catch(() => undefined)),
  )
}
```

Использование:

```ts
test('p2p media import transfers to remote peer', async ({ browser }, testInfo) => {
  const roomId = createRoomId(testInfo, 'p2p-media')
  const roomUrl = buildRoomUrl(roomId, { chunkSize: 65536 })
  const peers: Peer[] = []

  try {
    peers.push(await openPeer(browser, roomUrl))
    peers.push(await openPeer(browser, roomUrl))

    const { server, client } = await waitForServerClient(peers)
    await server.page.getByLabel('Import media files').setInputFiles(generatedVideo)

    await expectTransferReady(client.page, { resourceName: 'fixture-video.webm' })
  } finally {
    await closePeers(...peers)
  }
})
```

### Изоляция backend/signaling

Добавить debug/test-only API в backend только для тестов:

```ts
// GET /api/test/rooms/:roomId
// DELETE /api/test/rooms/:roomId
```

После P2P теста:

```ts
await request.delete(`/api/test/rooms/${roomId}`)
await expect.poll(async () => {
  const state = await request.get(`/api/test/rooms/${roomId}`).then((r) => r.json())
  return state.peerCount
}).toBe(0)
```

Если не хочется добавлять HTTP API, добавить browser-side assertion:

```ts
await expect.poll(() => getDebugPeers(server.page)).toHaveLength(expectedPeerCount)
```

Но серверный cleanup лучше, потому что ловит утечки вне браузера.

### Разделение P2P тестов по стоимости

Оставить в обычном P2P CI:

- two-peer same-browser handshake;
- main-owned transfer;
- client-owned transfer;
- reconnect mid-transfer;
- failover server -> client;
- one late joiner relay.

Вынести в nightly/manual:

- mixed-engine matrix;
- large chunk 3MB+ transfer;
- three-peer cross-engine relay matrix;
- visual preview under slow transfer.

Предложенные scripts:

```json
{
  "test:integration:p2p": "playwright test -c playwright.p2p.config.js --grep-invert @slow",
  "test:integration:p2p:slow": "playwright test -c playwright.p2p.config.js --grep @slow"
}
```

Имена:

```ts
test('@slow three-peer mixed-engine relay from edge owner through firefox main', async (...) => {})
```

### P2P ожидания: что считать сутью

Не суть:

- конкретный порядок debug transfer events, если пользовательский результат не зависит от него;
- точное число retry events;
- внутренний статус, если observable media already ready.

Суть:

- ровно один peer становится server;
- остальные становятся client;
- imported resource появляется на remote peer;
- preview URL становится `blob:` или иной playable local URL;
- loaded bytes достигают total bytes;
- после disconnect late joiner получает resource через main/relay;
- stale owner disconnect не оставляет transfer в permanent error;
- failover не теряет committed project state.

Пример:

```ts
await expect.poll(async () => {
  const transfer = await getTransferByName(client.page, 'fixture-video.webm')
  return {
    status: transfer?.status,
    loadedBytes: transfer?.loadedBytes,
    totalBytes: transfer?.totalBytes,
    previewUrl: transfer?.previewUrl,
  }
}).toMatchObject({
  status: 'ready',
  loadedBytes: expect.any(Number),
  totalBytes: expect.any(Number),
  previewUrl: expect.stringMatching(/^blob:/),
})
```

Если важна стратегия chunk scheduling, это должен проверять unit-тест scheduler/manager, а не браузерный P2P E2E.

## Производительность всего набора

### Проблемы

- Много browser tests проходят через `page.goto('/')`, import fixtures, media encode/decode.
- Export tests с real WebM/MediaRecorder/WebCodecs дорогие и serial.
- P2P tests открывают несколько browser contexts и держат signaling/backend.
- Некоторые тесты используют `waitForTimeout`, что всегда добавляет фиксированную задержку.
- Дублирование fixture generation в тестах может повторно создавать медиа.

### План оптимизации

1. Замерить baseline:

```bash
npm run test:video-editor -- --reporter=verbose
npm run test:video-editor:node -- --reporter=verbose
npm run test:integration:fast -- --reporter=line
npm run test:integration:p2p -- --reporter=line
```

2. Добавить Playwright JSON reporter в CI для анализа slow tests:

```bash
playwright test --reporter=json,line
```

3. Разнести тесты:

- `unit`: всегда на PR;
- `component`: всегда на PR;
- `integration:fast`: всегда на PR;
- `integration:export`: PR только smoke, full nightly;
- `integration:p2p`: PR core, slow matrix nightly.

4. Кэшировать generated media fixtures:

```ts
export const createSolidVideoFixture = test.extend<{
  solidVideo: { name: string; mimeType: string; buffer: Buffer }
}>({
  solidVideo: async ({ page }, use) => {
    const video = await createSolidVideoFile(page, 'solid-red-video.webm', '#e11d48')
    await use(video)
  },
})
```

Для больших файлов лучше хранить готовые fixture bytes в `tests/fixtures/media`, а не генерировать в каждом тесте.

5. Заменить фиксированные waits:

- `waitForTimeout(700)` -> `expect.poll`;
- `waitForTimeout(250)` после export -> wait на link href/status/download event;
- profiler tests оставить отдельными и пометить как diagnostic/slow.

6. Минимизировать браузерные assertions на internal debug state:

- если проверяется graph invariant, перенести в Vitest;
- если проверяется real browser boundary, оставить в Playwright.

## Как понять, что тест проверяет суть

Перед добавлением или изменением теста пройти чеклист:

1. Какая пользовательская или доменная гарантия защищается?
2. Упал бы тест, если поменять внутреннюю структуру, но поведение останется верным?
3. Можно ли проверить то же дешевле на pure/model уровне?
4. Есть ли отдельная проверка ошибок/границ?
5. Численные ожидания объясняют закон или только копируют текущий результат?
6. Для UI: пользователь может найти этот элемент так же, как тест?
7. Для P2P: тестовая комната, browser contexts и server state гарантированно очищаются?
8. Для async: ожидание связано с наблюдаемым состоянием, а не с таймером?

Пример плохого теста:

```ts
expect(clipsAfter.length).toBeGreaterThanOrEqual(2)
const rightClip = clipsAfter.find((clip) => ctx.getAttr(clip, 'start') === 1)
expect(ctx.getAttr(rightClip!, 'duration')).toBe(1)
```

Он допускает лишние clips и ищет right clip по `start`, что может случайно совпасть.

Лучше:

```ts
expect(clipsAfter).toHaveLength(2)

const left = findClipBySourceId(ctx, clipsAfter, 'clip:original')
const right = findOnlyNewClip(clipsBefore, clipsAfter)

expectSplitInvariant(
  readClipForInvariant(ctx, originalBefore),
  readClipForInvariant(ctx, left),
  readClipForInvariant(ctx, right),
  1,
)
```

## Приоритеты реализации

### P0

- Вернуть DKT graph/timeline validation invariants.
- Убрать debug `console.log` из тестов.
- Централизовать P2P helpers и cleanup через `try/finally`.
- Заменить `waitForTimeout` в обычных E2E на `expect.poll` или event wait.
- Разделить slow P2P/export tests от PR-critical набора.

### P1

- Разбить `video-editor.spec.ts` на тематические файлы.
- Восстановить быстрый jsdom happy-path для editor UI.
- Добавить accessible roles/labels там, где тесты вынуждены использовать CSS selectors.
- Ввести reusable assertion helpers для clip/project/resource invariants.

### P2

- Добавить backend test cleanup/debug API для P2P rooms.
- Добавить perf reporting по slow tests в CI.
- Пересмотреть mixed-engine matrix и оставить минимальный PR набор.
- Расширить property-style tests для scheduler/color/timing.

## Definition of Done

Тестовая система считается улучшенной, когда:

- DKT model tests ловят основные ошибки timeline graph без запуска браузера;
- UI tests используют Testing Library-style queries везде, где это возможно;
- Playwright tests проверяют только реальные browser/system boundaries;
- P2P tests не имеют cross-test room leakage и стабильно чистят contexts;
- expensive tests размечены и не блокируют быстрый PR loop;
- численные тесты имеют named contract или invariant helper;
- при изменении CSS-класса, не влияющем на UX/layout contract, большинство тестов не падает;
- при поломке split/append/trim/source mapping падает быстрый unit/model тест до E2E.

## Дополнение: ожидания DKT-settle в browser/P2P тестах

### Проблема

В `src/video-editor/dkt/testingInit.ts` уже есть правильная модель ожидания вычислений для DKT unit/model тестов:

```ts
const computed = async (): Promise<void> => {
  if (runtime.whenAllReady) {
    return new Promise<void>((resolve) => runtime.whenAllReady!(() => resolve()))
  }
  if (flow?.whenReady) {
    return new Promise<void>((resolve) => flow.whenReady(() => resolve()))
  }
  await new Promise<void>((resolve) => {
    if (typeof appModel.input === 'function') {
      appModel.input?.(() => resolve())
    } else {
      resolve()
    }
  })
}
```

Этот контракт используется через `lockToRead`: сначала выполнить действие, потом дождаться, что DKT-граф досчитан, и только после этого читать attrs/rels. Это правильный уровень синхронизации для model tests.

В Playwright/P2P тестах сейчас есть более слабое ожидание: `window.__MINICUT_P2P_DEBUG__.isRuntimeReady()`. Оно означает, что page runtime bootstrapped и sync graph в принципе доступен. Оно не гарантирует, что после последнего `dispatchAction` все DKT computations уже завершились, worker отправил sync updates, а page sync receiver применил их локально.

Из-за этого возможен флейк:

1. Тест вызывает debug action через `page.evaluate`.
2. Worker принял action и начал DKT propagation.
3. `isRuntimeReady()` уже возвращает `true`.
4. Тест читает `dumpGraph`, `getProjectCount`, `getActiveProjectDetails` или transfer state.
5. Часть вычисленного состояния еще не дошла до page graph.

### Решение

Добавить test-only ожидание уровня runtime/model idle и пробросить его на страницу через debug bridge:

```ts
type MiniCutDebugBridge = {
  isRuntimeReady: () => boolean
  waitForRuntimeSettled: () => Promise<void>
}
```

На уровне worker/runtime нужен явный request/response контракт, например:

```ts
export const DKT_MSG = {
  WAIT_IDLE: 'dkt:wait-idle',
  IDLE: 'dkt:idle',
}
```

Worker-side обработчик:

```ts
case DKT_MSG.WAIT_IDLE: {
  const app = await bootstrapApp()
  if (!app) {
    transport.send({ type: DKT_MSG.IDLE, requestId: message.requestId })
    return
  }

  if ('whenAllReady' in app.runtime && typeof app.runtime.whenAllReady === 'function') {
    await new Promise<void>((resolve) => app.runtime.whenAllReady(resolve))
  } else if (typeof app.appModel.input === 'function') {
    await new Promise<void>((resolve) => app.appModel.input?.(() => resolve()))
  }

  transport.send({ type: DKT_MSG.IDLE, requestId: message.requestId })
  return
}
```

Page runtime должен уметь отправить `WAIT_IDLE` и дождаться `IDLE`:

```ts
const waitForRuntimeSettled = () =>
  new Promise<void>((resolve, reject) => {
    const requestId = `idle:${Date.now()}:${Math.random()}`
    pendingIdleResolves.set(requestId, resolve)
    emit({ type: DKT_MSG.WAIT_IDLE, requestId })
    setTimeout(() => {
      pendingIdleResolves.delete(requestId)
      reject(new Error('Timed out waiting for DKT runtime idle'))
    }, 5000)
  })
```

Debug bridge должен открыть это только для тестов:

```ts
const debug: MiniCutDebugBridge = {
  isRuntimeReady: () => harness.pageRuntime?.getSnapshot().ready ?? false,
  waitForRuntimeSettled: () => harness.pageRuntime?.waitForRuntimeSettled?.() ?? Promise.resolve(),
}
```

### Как использовать в тестах

Использовать `waitForRuntimeSettled()` после debug-dispatch или перед чтением debug graph/state:

```ts
await page.evaluate(() => {
  window.__MINICUT_P2P_DEBUG__?.dispatchProjectAction('addResourceToTimeline', payload)
})

await page.evaluate(() =>
  window.__MINICUT_P2P_DEBUG__?.waitForRuntimeSettled?.(),
)

await expect.poll(() =>
  page.evaluate(() => window.__MINICUT_P2P_DEBUG__?.getActiveProjectDetails()),
).toMatchObject({
  tracks: expect.arrayContaining([
    expect.objectContaining({
      clips: expect.arrayContaining([
        expect.objectContaining({ sourceResourceId: payload.sourceResourceId }),
      ]),
    }),
  ]),
})
```

Не использовать это как замену пользовательским ожиданиям. Для UI-сценариев основной assert остается Testing Library/Playwright-style:

```ts
await expect(page.getByRole('button', { name: /export/i })).toBeEnabled()
await expect(page.getByText(projectTitle)).toBeVisible()
```

`waitForRuntimeSettled()` нужен для тестов, которые сами дергают debug/runtime API и затем читают внутренний graph/state. Он не должен маскировать отсутствие видимого пользовательского результата.

### Критерий готовности

- В DKT unit/model тестах все чтения после mutations идут через `lockToRead`.
- В browser/P2P тестах `isRuntimeReady()` используется только для bootstrap readiness.
- После debug `dispatchRootAction`, `dispatchProjectAction`, `createProject` и перед debug graph/state assertions используется `waitForRuntimeSettled()`.
- Тесты, проверяющие пользовательский UI, продолжают ждать видимый DOM/result через role/label/text/event ожидания.
- Не добавляются фиксированные `waitForTimeout` для стабилизации DKT propagation.

## Дополнительное ревью выполненной реализации

### Уже сделано

- Добавлен общий P2P helper слой в `tests/integration/p2pTestHelpers.ts`: запуск изолированных комнат, ожидания runtime readiness, transfer activity/ready, чтение debug state, cleanup через единый сценарий.
- P2P smoke specs переведены на более явные доменные ожидания: роль peer, project count, transfer ready/activity, reconnect/failover state.
- Убрана часть фиксированных стабилизирующих waits из P2P сценариев и заменена на `expect.poll`.
- Добавлены DKT invariant helpers в `src/video-editor/dkt/test/projectGraphAssertions.ts`.
- Добавлены DKT tests для graph invariants и action contracts:
  - `src/video-editor/dkt/models/project-graph-invariants.test.ts`
  - `src/video-editor/dkt/models/clip-action-contracts.test.ts`
- Усилен существующий append-start test: ожидания стали ближе к timeline/domain invariants, debug logging убран.
- Проверены основные наборы:
  - `npm run test:integration:p2p`
  - `npm run test:video-editor:node`
  - узкий `resourceTransferManager` прогон через Vitest.

### Что осталось сделать

- Реализовать `waitForRuntimeSettled()` для browser/P2P тестов поверх DKT runtime/page sync transport. Это главный оставшийся пробел в ожиданиях вычислений.
- После добавления `waitForRuntimeSettled()` пройтись по P2P helpers/specs и заменить чтение debug graph/state после debug actions на explicit settled wait.
- Разделить большой `tests/integration/video-editor.spec.ts` на тематические файлы. Сейчас он все еще смешивает user flows, layout, media playback, export/debug checks и поэтому остается дорогим и сложным для диагностики.
- Добавить быстрые jsdom/component happy-path тесты там, где browser E2E сейчас проверяет обычное UI-поведение без настоящей browser/system границы.
- Доработать accessibility roles/labels в компонентах, где тесты все еще вынуждены использовать CSS selectors.
- Добавить CI/perf reporting по slow tests и закрепить PR/nightly разбиение для export/P2P matrix.
- Добавить backend/test cleanup API для P2P rooms, если появятся признаки leakage между сценариями на уровне signaling/server state.

### Риск, который стоит закрыть первым

Самый важный оставшийся риск - смешение `runtime ready` и `runtime settled` в browser/P2P тестах. Уже сделанная стабилизация уменьшила флейки transfer-сценариев, но без явного DKT idle handshake тесты, которые читают внутренний graph после debug actions, все еще могут иногда видеть промежуточное состояние. Поэтому следующий технический шаг должен быть именно `WAIT_IDLE`/`IDLE` handshake и `waitForRuntimeSettled()` в debug bridge.
