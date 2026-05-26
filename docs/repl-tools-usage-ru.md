# Minicut REPL и debug tools

## Что добавлено

В проект добавлены два класса инструментов:

1. `test/repl/run.mjs` и `test/repl/bootstrap.tsx`
   для быстрого jsdom/in-memory анализа runtime/state без браузера.
2. browser-side скрипты в `test/repl/playwright-*.mjs`
   для проверки уже реального DOM/CSS/runtime в dev server.

Это адаптация подхода из `D:\code\linkcraft\weather\test\repl`, но под `minicut` и с упором на инспекцию DKT state.

## Основные файлы

- `test/repl/bootstrap.tsx`
  создает `MiniCutReplHarness` на базе `MemoryWorkerAuthority`, bootstraps `DktEditorRoot` и экспонирует inspect helpers.

- `test/repl/stateInspect.ts`
  набор state helpers: active project, root state, graph summary, flush/wait helpers.

- `test/repl/run.mjs`
  headless jsdom runner. Запускать через `node --import tsx`, уже обернуто в npm script.

- `test/repl/playwright-run.mjs`
  быстрый browser smoke-debug: snapshot, tracks, messages, screenshot.

- `test/repl/playwright-runtime-inspect.mjs`
  вытаскивает детальное состояние runtime/graph/messages из живого браузера.

- `test/repl/playwright-css-inspect.mjs`
  через CDP читает computed CSS по ключевым селекторам timeline/media bin/inspector.

## Быстрый старт

### 1. jsdom state REPL

Запуск:

```bash
npm run repl:run
```

По умолчанию runner:

- создает jsdom window
- поднимает in-memory DKT runtime
- bootstraps page runtime
- печатает snapshot, root summary, active project summary, graph summary и последние messages

### 2. Свой сценарий для jsdom

Можно передать модуль сценария через `MINICUT_REPL_SCENARIO`.

Пример запуска:

```bash
$env:MINICUT_REPL_SCENARIO='test/repl/scenario-example.ts'
npm run repl:run
```

Сценарий должен экспортировать `run(harness)` или default function.

Контракт `harness`:

- `harness.createProject(title?)`
- `harness.dispatchRootAction(actionName, payload?)`
- `harness.dispatchProjectAction(actionName, payload?)`
- `harness.flush(ticks?)`
- `harness.whenReady()`
- `harness.inspect.snapshot()`
- `harness.inspect.root()`
- `harness.inspect.activeProject()`
- `harness.inspect.graph()`
- `harness.inspect.graphSummary()`
- `harness.inspect.messages()`

Пример сценария:

```ts
export async function run(harness) {
  harness.createProject('REPL project')
  await harness.flush(4)
  console.log(harness.inspect.activeProject())
}
```

### 3. Browser/runtime debug

Нужен поднятый dev server, обычно на `http://127.0.0.1:4174`.

Запуск:

```bash
npm run repl:playwright
```

Что делает:

- открывает браузер
- ждет `__MINICUT_P2P_DEBUG__`
- при отсутствии проектов создает один через debug API
- печатает snapshot/tracks/messages/graph summary
- сохраняет screenshot в `test/repl/minicut-playwright.png`

### 4. Детальный runtime dump в браузере

```bash
npm run repl:playwright:runtime
```

Полезно, когда надо быстро увидеть:

- `activeProject`
- `selection`
- полный `graph`
- полный `messages`

### 5. CSS inspection

```bash
npm run repl:playwright:css
```

Скрипт читает computed style через CDP по ключевым селекторам:

- `main`
- timeline region
- media bin
- inspector
- `.ve-timeline-track`
- `.ve-timeline-clip`

Это полезно для случаев, где state уже правильный, а проблема живет в layout/z-index/pointer-events.

## Debug API в браузере

В dev-режиме `VideoEditorHarnessApp` кладет в `window.__MINICUT_P2P_DEBUG__` дополнительные helper-ы:

- `getSnapshot()`
- `dumpGraph()`
- `dumpGraphSummary()`
- `getProjectCount()`
- `getProjectTitles()`
- `getActiveProjectTracks()`
- `getActiveProjectPrimaryTracks()`
- `getActiveProjectDetails()`
- `getSelectionState()`
- `getRuntimeMessages()`
- `dispatchRootAction(actionName, payload?)`
- `dispatchProjectAction(actionName, payload?)`
- `dispatchCreateProject(title?)`

Это удобно и для manual debugging из DevTools console.

## Полезная стратегия использования

### Когда начинать с jsdom REPL

Использовать `npm run repl:run`, если нужно понять:

- дошел ли dispatch до DKT runtime
- создались ли project/track/clip/resource nodes
- какие attrs и rels реально лежат в authoritative state
- ломается ли flow еще до React/DOM

### Когда переходить к browser REPL

Использовать `npm run repl:playwright` или `npm run repl:playwright:runtime`, если нужно понять:

- page runtime получил sync update или нет
- виден ли clip в page graph
- совпадают ли active project/tracks/clips между worker и page runtime

### Когда нужен CSS inspect

Использовать `npm run repl:playwright:css`, если уже ясно, что state корректный, но:

- clip невидим
- clip кликается не туда
- есть overlap
- есть подозрение на `z-index`, `pointer-events`, `left`, `width`, `overflow`

## Отличие от weather REPL

В weather `run.mjs` бандлит `bootstrap.tsx` через `rolldown`.
В `minicut` сделано проще:

- используется уже установленный `tsx`
- `run.mjs` запускается как `node --import ./test/repl/register-dkt-alias-loader.mjs --import tsx ./test/repl/run.mjs`
- отдельный import loader резолвит алиасы `dkt` и `dkt-all` для Node/jsdom режима
- это уменьшает glue code и избавляет от новой dev dependency

## Практическая польза для P0-1

Для бага класса `pointer intercept` поток отладки должен идти слоями:

1. jsdom REPL: проверить authoritative state и sequence of actions
2. browser runtime inspect: проверить sync graph на page side
3. CSS inspect / Playwright screenshot: проверить DOM geometry, stacking и hit-testing

Именно под такой flow новые инструменты и добавлены.