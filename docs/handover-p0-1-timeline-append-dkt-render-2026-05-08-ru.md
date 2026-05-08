# Handover: P0-1 timeline append overlap на ветке dkt-render

## Краткий итог

Ниже зафиксировано состояние на момент остановки работ по багу P0-1: при добавлении новых клипов в timeline они попадают в `start=0`, визуально накладываются друг на друга, и верхний клип перехватывает pointer events, из-за чего падает тест экспорта.

Главный вывод на текущий момент:

- текущий незакомиченный эксперимент в `src/video-editor/app/editorHarnessAdapter.ts` является архитектурно неверным;
- он делает внешний traversal через page-side sync receiver и на его основе вычисляет payload для dispatch;
- это нарушает правильную границу ответственности;
- вычисление append position должно происходить внутри DKT action через deps / rel addr traversal, а наружу должен уходить только минимальный dispatch с `sourceResourceId`.

## Ответы на прямые вопросы

### 1. Был ли commit в `dkt-render`, хотя работа должна была идти в отдельном worktree

Да. По состоянию контекста VS Code есть успешный commit, выполненный из `D:\code\minicut`, то есть из репозитория на текущей ветке `dkt-render`.

Зафиксирован успешный запуск команды:

`git add -A; git commit -m "refactor: move test-only helpers out of createMiniCutDktRuntime into .testing.ts"`

Контекст также показывает:

- `Current branch: dkt-render`
- `Cwd: D:\code\minicut`
- `Exit Code: 0`

Следовательно, да: commit был сделан прямо в `dkt-render`, а не в отдельном worktree.

Важно: этот commit не относится к текущему незакомиченному эксперименту с append start в адаптере. Незакомиченные изменения сейчас отдельно висят поверх ветки.

### 2. Какие есть незакомиченные изменения

По состоянию git diff незакомичен только один файл:

- `src/video-editor/app/editorHarnessAdapter.ts`

Суть незакомиченных изменений:

1. Добавлен helper `getTrackAppendStart(...)`.
2. Он делает traversal по page runtime:
   - читает `project -> tracks`
   - затем `track -> clips`
   - затем `clip.start` и `clip.duration`
   - вычисляет `maxEnd`
3. `addResourceToTimeline(resourceId)` в адаптере перестал dispatch-ить минимальный payload в project action.
4. Вместо этого адаптер:
   - сам читает state;
   - сам определяет target track;
   - сам вычисляет `start`;
   - сам dispatch-ит `addClip` на track scope.
5. В коде остались `console.log(...)` для отладки.

То есть незакомиченный хвост сейчас состоит не просто из debug-логов, а из неправильного архитектурного разворота: бизнес-логика append position была вынесена из DKT action наружу в adapter.

### 3. Какая проблема прямо сейчас

Проблема двойная.

#### Техническая проблема теста

Целевой тест:

- `tests/integration/video-editor.spec.ts`, кейс `exports generated solid video, trailing image, and audio with audible output`

Текущее фактическое состояние:

- image-клип появляется в V1;
- wav-клип появляется в A1;
- но оба новых клипа оказываются на `start=0`;
- они накладываются на уже существующие клипы;
- из-за overlap новый клип перехватывает pointer events;
- из-за этого падает `videoClip.click()`.

Отдельно важно: предыдущая проблема, из-за которой WAV вообще не появлялся, была локализована. Она связана не с UI, а с семантикой DKT multi-step action payload propagation. WAV теперь появляется, но позиционируется неправильно.

#### Архитектурная проблема текущего подхода

Текущий незакомиченный эксперимент в `editorHarnessAdapter.ts` неверен по сути, даже если бы он заработал.

Почему он неверен:

1. Adapter не должен читать deep state (`tracks`, `clips`, `start`, `duration`) для того, чтобы сконструировать сложный payload.
2. Adapter должен как можно раньше сделать `dispatch(...)` с минимальными данными.
3. Чтение model state, traversal по rel и вычисление append position должны происходить внутри DKT action.
4. Внешний traversal через page-side receiver не является source of truth и не должен определять бизнес-решение о том, куда и как создавать clip.
5. Этот путь обходит топ-даун вычисление внутри DKT и размывает ответственность между UI runtime и model layer.

Именно поэтому текущий блокер нужно трактовать не как "надо еще чуть-чуть допатчить adapter", а как сигнал, что направление ошибочное и его надо откатить или заменить на нормальную action-логику в model.

## Что именно было понято про DKT

### 1. Реальная причина, почему WAV ранее не добавлялся через `addResourceToTimeline`

Файл:

- `src/video-editor/models/Project.ts`

Исходная реализация `addResourceToTimeline` состоит из двух шагов:

1. шаг на `primaryVideoTrack`
2. шаг на `primaryAudioTrack`

Оба шага завязаны на один и тот же payload `{ sourceResourceId }`.

Но в DKT multi-step action есть важная семантика inline saga:

- после обычного не-SKIPPED шага `current_payload` не сохраняется автоматически;
- если step не записал `$output`, то следующий step получает `null`;
- payload между шагами не протаскивается сам по себе.

Критичный эффект:

- шаг 1 по video track выполняется даже для audio resource, потому что `when` смотрит только на наличие `sourceResourceId`;
- внутри `fn` он возвращает `'$noop'`, но сам шаг считается выполненным;
- после этого payload для следующего шага становится `null`;
- шаг 2 на audio track уже не видит `sourceResourceId` и фактически теряет входные данные.

Именно это было скрытой причиной, почему WAV не появлялся при исходной DKT-реализации `addResourceToTimeline`.

### 2. Что из этого следует

Если `addResourceToTimeline` остается multi-step action, то payload между шагами нужно передавать явно через `$output`.

Альтернатива лучше и проще:

- не делать fragile multi-step cascade, где следующий шаг зависит от того, не занулил ли предыдущий payload;
- сделать action так, чтобы расчет и dispatch были локальны и очевидны;
- при необходимости разнести логику на отдельные actions с минимальным входом и чтением state через deps.

## Что именно сейчас неверно в `editorHarnessAdapter.ts`

Файл:

- `src/video-editor/app/editorHarnessAdapter.ts`

Сейчас туда добавлено:

### `getTrackScopeByKind(...)`

Эта функция сама по себе уже тянет adapter глубже, чем нужно: adapter читает `project -> tracks`, затем проверяет `track.kind`.

### `getTrackAppendStart(...)`

Это основной неверный кусок. Он:

1. берет `trackScope`;
2. читает `clips` через `env.pageRuntime.readMany(trackScope, 'clips')`;
3. читает `start` и `duration` у каждого clip;
4. вычисляет `maxEnd`;
5. возвращает его для формирования payload.

Почему это плохо:

- adapter занимается traversal по state graph;
- adapter вычисляет бизнес-производную величину `append start`;
- adapter на основе read model формирует write payload;
- фактически write decision принимается не в DKT model/action, а снаружи.

Это именно тот паттерн, который нельзя дальше продолжать.

### Переписанный `addResourceToTimeline(resourceId)`

Сейчас adapter не делает:

- `dispatchProject(env, 'addResourceToTimeline', { sourceResourceId: resourceId })`

Вместо этого он:

- находит active project scope;
- ищет resource в synced state;
- отдельно находит video/audio track;
- отдельно считает `appendStart`;
- отдельно dispatch-ит `addClip` прямо на track.

Это и есть неправильный внешний traversal.

## Почему проблема с `getTrackAppendStart(...)` не должна чиниться локально

Даже если бы удалось выяснить, почему `readMany(trackScope, 'clips')` или `readAttrs(clipScope, ['start', 'duration'])` возвращают `0` / пустые данные, это не тот путь, который надо доводить до конца.

Причина:

- сам эксперимент основан на неверной архитектурной предпосылке;
- починка receiver-side чтения только закрепит неправильный слой ответственности;
- это не root fix.

То есть текущий вопрос не в том, как заставить adapter правильно прочитать clip attrs, а в том, что adapter вообще не должен делать это вычисление.

## Корректное направление исправления

### Принцип

Нужно вернуться к такому контракту:

1. UI / adapter делает минимальный dispatch как можно раньше.
2. В payload уходит только то, что пользователь реально выбрал, например `sourceResourceId`.
3. Внутри DKT action читается state через deps / rel addr.
4. Внутри DKT action вычисляется append position.
5. Внутри DKT action dispatch-ится `addClip` на нужный track через `inline_subwalker` или другой локальный action path.

### Практически это означает

#### В adapter

`addResourceToTimeline(resourceId)` должен быть снова минимальным:

```ts
addResourceToTimeline(resourceId: string): void {
  dispatchProject(env, 'addResourceToTimeline', { sourceResourceId: resourceId })
}
```

Допустимый максимум снаружи:

- дойти до session root scope;
- dispatch-нуть action на root/project scope.

Недопустимо снаружи:

- читать `tracks`;
- читать `clips`;
- читать `clip.start` / `clip.duration`;
- вычислять append position;
- решать, на какой track пойдет clip, если это можно вычислить в model.

#### В `Project.ts`

Нужно переделать `addResourceToTimeline` так, чтобы он сам:

1. находил resource по `sourceResourceId`;
2. понимал `resource.kind`;
3. находил нужный track внутри model graph;
4. читал существующие clips нужного track;
5. считал append start на основании clip attrs;
6. вызывал `addClip` на правильном submodel.

### Важное ограничение по реализации

Текущую двухшаговую схему нельзя просто слегка подкрутить. Из-за семантики payload propagation она хрупкая.

Если оставлять multi-step action, нужно явно использовать `$output` между шагами.

Но лучше ориентир такой:

- либо первый шаг вычисляет все и через `$output` передает строго нужную структуру дальше;
- либо логика раскладывается так, чтобы не зависеть от неявного переноса payload между шагами.

## Что уже известно про исходный баг

### Root cause P0-1

Новые клипы создавались с `start: 0`.

Это приводило к двум последствиям:

1. визуальный overlap на таймлайне;
2. pointer interception, когда новый clip перекрывает уже существующий.

### Первое частичное исправление

Ранее был найден и локально исправлен сценарий, где image попадал в video track после video clip. Но это не закрыло всю проблему, потому что audio path оставался сломанным.

### Второе понимание

Было установлено, что WAV не появляется из-за DKT payload propagation между шагами в `Project.addResourceToTimeline`.

### Ошибочный поворот

После этого был сделан переход к adapter-side fix:

- читать state из `pageRuntime`;
- вычислять append start снаружи;
- dispatch-ить `addClip` прямо на `track`.

Именно этот поворот является неверным и не должен продолжаться.

## Текущее фактическое состояние теста

Целевой тест:

- `tests/integration/video-editor.spec.ts`
- кейс: `exports generated solid video, trailing image, and audio with audible output`

Из ранее собранных фактов:

- ожидание видимости image clip проходит;
- ожидание видимости wav clip проходит;
- падает клик по исходному video clip;
- причина падения: overlap и intercept pointer events.

То есть функционально мы находимся в промежуточной точке:

- добавление resources в timeline стало видимым;
- позиционирование осталось неправильным;
- архитектурное направление текущего фикса признано неверным.

## Конкретные файлы, которые нужно трогать дальше

### Обязательно

- `src/video-editor/models/Project.ts`
- `src/video-editor/app/editorHarnessAdapter.ts`

### На чтение и верификацию

- `src/video-editor/models/Track.ts`
- `src/video-editor/models/Track/actions.ts`
- `tests/integration/video-editor.spec.ts`

## Что делать следующим инженером

### 1. Сначала убрать неверный adapter-side эксперимент

Нужно вернуть `editorHarnessAdapter.ts` к минимальному dispatch контракту для `addResourceToTimeline`.

То есть удалить:

- `getTrackAppendStart(...)`
- внешнее чтение track/clip state для append calculation
- прямой dispatch `addClip` на track из adapter
- временные `console.log(...)`

### 2. После этого переносить append logic внутрь DKT action

Нужно реализовать append position в `Project.addResourceToTimeline`.

Ключевая идея:

- action получает только `sourceResourceId`;
- deps читают resources и релевантные clips;
- внутри action вычисляется `start`;
- потом внутри же model dispatch-ится `addClip` на target track.

### 3. Не повторять внешний traversal

Нельзя снова идти путем:

- `pageRuntime.readMany(projectScope, 'tracks')`
- `pageRuntime.readMany(trackScope, 'clips')`
- `pageRuntime.readAttrs(...)`
- `dispatchTrackClip(...)`

Это должно считаться заведомо неверным направлением.

### 4. Учитывать семантику payload propagation в DKT

Если в multi-step action используется несколько шагов, надо помнить:

- следующий step не получает payload автоматически;
- после не-SKIPPED step payload может стать `null`;
- для передачи данных между шагами нужен `$output`.

## Предпочтительный дизайн фикса

Ниже не готовый патч, а направление.

### Вариант A. Оставить один public action `addResourceToTimeline`

`editorHarnessAdapter.ts`:

```ts
addResourceToTimeline(resourceId: string): void {
  dispatchProject(env, 'addResourceToTimeline', { sourceResourceId: resourceId })
}
```

`Project.ts`:

- action читает resource;
- action определяет target track;
- action читает clips target track;
- action считает `max(start + duration)`;
- action вызывает `addClip` с вычисленным `start`.

### Вариант B. Разделить вычисление и запись на внутренние actions

Можно сделать тонкий public action и внутренние action-слои:

1. `addResourceToTimeline({ sourceResourceId })`
2. internal action для video append
3. internal action для audio append

Но и в этом случае:

- traversal остается внутри model/action layer;
- наружу не выносится.

## Что нельзя потерять

### 1. WAV path

Нельзя вернуться к состоянию, где WAV снова не появляется на A1. При переписывании `Project.addResourceToTimeline` нужно помнить про уже выявленную проблему с multi-step payload propagation.

### 2. Embedded audio path у video

Нужно перепроверить, чтобы импорт video не дублировал audio track clip сверх ожидаемого поведения.

### 3. Pointer-intercept regression

Итоговая проверка должна быть не только на видимость клипов, но и на отсутствие overlap в позиции `start=0`.

## Минимальный критерий готовности

Исправление можно считать корректным только если одновременно выполняется все ниже:

1. `editorHarnessAdapter.ts` снова dispatch-ит минимальный payload и не делает deep traversal для append logic.
2. append start считается внутри DKT action.
3. image clip добавляется после video clip, а не в `0.0s`.
4. wav clip добавляется после existing audio clip, а не в `0.0s`.
5. `videoClip.click()` в целевом playwright-тесте больше не падает из-за intercept.
6. весь тест `exports generated solid video, trailing image, and audio with audible output` проходит до конца.

## Текущее решение по статусу

Статус на момент handover:

- работа остановлена до продолжения неправильного adapter-side подхода;
- текущий незакомиченный diff надо рассматривать как временный и архитектурно неверный;
- правильное следующее действие: перенести логику append внутрь `Project.ts` и вернуть adapter к thin-dispatch роли.