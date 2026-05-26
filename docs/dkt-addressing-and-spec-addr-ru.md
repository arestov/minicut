# DKT addressing и special addresses

## Зачем нужен этот документ

В DKT адреса используются сразу в нескольких местах, и у них не одна общая семантика.

Нужно различать минимум четыре слоя:

1. deps для `action.fn` и `action.when`
2. deps для `comp` attrs
3. `to`-адреса в action target
4. служебные placeholder-ы и special tokens

Одинаково выглядящие строки в этих слоях могут интерпретироваться по-разному.

Документ ниже собран по коду из:

- `dkt/js/libs/provoda/utils/multiPath/asString.js`
- `dkt/js/libs/provoda/utils/multiPath/parse.js`
- `dkt/js/libs/provoda/utils/multiPath/inputBase.js`
- `dkt/js/libs/provoda/utils/multiPath/readingDeps/readingDeps.js`
- `dkt/js/libs/provoda/dcl/passes/dcl.js`
- `dkt/js/libs/provoda/dcl/passes/targetedResult/dcl.js`
- `dkt/js/libs/provoda/dcl/passes/targetedResult/save.js`
- `dkt/js/libs/provoda/dcl/passes/baseRelShape.js`
- `dkt/js/libs/provoda/dcl/passes/validateActionsDestinations.js`
- `dkt/js/libs/provoda/utils/multiPath/parse.test.js`

## Ментальная модель адреса

Полный modern-адрес строится из четырех частей:

```text
< [state|effect] < [nesting] < [resource] < [base]
```

Где:

- `state` — какой attr/effect читать или писать
- `nesting` — через какую rel идти
- `resource` — route/resource часть
- `base` — от какой базы идти: self/root/parent/input

Сериализация делается в `asString.js`.
Парсинг делается в `parse.js`.

## Базовые части адреса

### 1. State part

Разбирается через `addr-parts/attr.js`.

Пример:

```text
title
timelineDuration
clipRenderData
```

Если путь state содержит точки, это все еще один state path, но для action target есть ограничение: запись в attr target поддерживает только случай, где `state.path === state.base`, кроме wildcard sink `*`.

### 2. Nesting part

Разбирается через `addr-parts/rel.js`.

Пример:

```text
tracks
tracks.clips
primaryVideoTrack
```

Парсер превращает rel path в:

- `path` — весь путь
- `base` — все части кроме последней
- `target_nest_name` — последняя часть

### 3. Resource part

Разбирается через `addr-parts/route.js`.

Это legacy/resource traversal слой. Для большинства minicut action deps почти не нужен, но он существует как часть grammar.

Если используется `resource`, строка должна быть route template с inline generic template. Просто произвольный `/path` не пройдет.

### 4. Base part

Разбирается через `addr-parts/ascendor.js`.

Поддерживаемые базы:

- `#` — root
- `^`, `^^`, `^^^` — parent на 1/2/3 уровня вверх
- `$input`
- `$input:key`
- `$input_all`
- `$input_all:key`
- `$input_id`
- `$input_id:key`
- `$input_id_all`
- `$input_id_all:key`

## Self-address

Есть отдельный special case:

```text
<<<<
```

Это не обычный multiPath, а shortcut `base_itself`.

Используется, когда step должен получить текущую model instance как dep или использовать её как базу для последующих операций.

Пример из minicut:

```ts
fn: [['<<<<'] as const, (payload, self) => { ... }]
```

## Zip names

Zip указывается как `@zipName:` перед state или nesting.

Поддерживаемые zip для state:

- `@one:`
- `@all:`
- `@every:`
- `@some:`
- `@find:`
- `@filter:`

Поддерживаемые zip для nesting:

- `@one:`
- `@all:`
- `@notEmpty:`
- `@length:`

Ограничения из `parse.js`:

- zip нельзя одновременно ставить и на state, и на nesting
- если zip стоит на nesting и одновременно есть explicit state string, это ошибка
- если zip стоит на state, но state пустой, а nesting непустой, это ошибка

## Современные примеры адресов

### Простые attr deps

```text
title
duration
timelineDuration
```

Это просто self attr reads.

### State через rel traversal

```text
< @all:timelineClipSource < resources
< @all:clipRenderData < tracks.clips
< @one:title < activeProject
```

Смысл:

- взять state `timelineClipSource` у всех элементов relation `resources`
- взять `clipRenderData` у всех clip в `tracks.clips`

### Nesting-only traversal

```text
<< primaryVideoTrack
<< tracks
```

Обычно встречается в `to`, а не в deps.

Важная тонкость: в `readingDeps` есть проверка, что если адрес читает nesting path, то должен быть zip `@one:` или `@all:`. Поэтому голый nesting path в deps без zip недопустим.

### Base от root и parent

```text
< title <<< #
< timelineZoom <<< ^
< selectedEntityId <<< ^^
```

### Base от input

```text
< title <<< $input
< title <<< $input:project
< status <<< $input_all:models
< title <<< $input_id
< title <<< $input_id_all:items
```

## Как реально работает `$input*`

`$input*` не читает attr из payload автоматически.
Сначала он разрешает payload в model base.

Логика в `inputBase.js`:

- `$input` ожидает runtime model
- `$input_all` ожидает список runtime models
- `$input_id` ожидает model id и превращает его в runtime model через `getModelById`
- `$input_id_all` ожидает список model id

Если тип не совпадает, выбрасывается ошибка.

### Это ключевой вывод

`$input` и `$input_id` — это не "возьми поле из объекта payload".
Это именно механизм подстановки runtime model base в адресацию.

## `input_base_rel_shape` и `output_base_rel_shape`

Если step использует `$input*`, DKT требует описать `input_base_rel_shape`.

Если текущий step пишет в `$output`, а следующий step использует `$input*`, DKT требует `output_base_rel_shape` у текущего шага.

Это проверяется в `baseRelShape.js`.

Смысл проверки:

- если ты передаешь runtime model через `$output`
- и следующий step читает ее как `$input`
- движок хочет знать rel shape этого значения заранее

Иначе шаг считается недоописанным декларативно.

## Special deps для `action.fn` и `action.when`

Эти токены обрабатываются не парсером multiPath напрямую, а `readingDeps/readingDeps.js` через placeholder-ы.

### `$noop`

Семантика:

- служебный placeholder для "ничего не делать"
- в `dcl/passes/noop.js` это не строка, а специальная function-sentinel
- `prepareResults.js` проверяет `value === noopForPass` и тогда не создает ни одного mutation item

Практический смысл:

- если в deps включен `'$noop'`, в `fn` приходит special noop token
- возвращать нужно именно этот token, а не произвольную строку

Пример:

```ts
fn: [
  ['$noop', 'start', 'duration'] as const,
  (payload, noop, start, duration) => {
    if (!shouldMutate(start, duration)) {
      return noop
    }
    return { duration: 1 }
  },
]
```

### `$now`

Семантика:

- special dep, который резолвится в function `now()`
- `now()` возвращает `Date.now()`

Это не snapshot timestamp транзакции, а просто runtime helper текущего времени.

### `$meta$timestamp`

Семантика:

- placeholder для точного времени dispatch контекста
- wiring идет через `dcl/passes/dcl.js`
- используется как meta dep, а не как multiPath address

### `$meta$payload`

Семантика:

- placeholder для meta-информации о payload/context action dispatch
- тоже заводится через `dcl/passes/dcl.js`

Важно: это не то же самое, что target alias `$payload`.

## Special targets в `to`

### `$output`

`targetedResult/dcl.js` рассматривает `$output` как `inline_saga_output` target.

При сохранении `save.js` вызывает `saveInlineSagaOutput(...)`, который кладет значение в `inline_saga_sequence.next_payload`.

Именно так данные переносятся между шагами inline saga.

Критично:

- `$output` локален текущему frame inline saga
- без `$output` следующий step не получает автоматически payload прошлого шага

### `$payload`

В `targetedResult/dcl.js` `$payload` — alias того же `inline_saga_output` target type.

Практически это второй spelling для той же идеи.

### `*`

Если `to` равен `'*'`, target становится `by_node_id`.

Это особый sink для patch-объекта по node id.

Используется, когда handler возвращает объект формата примерно:

```ts
{
  "node-id": {
    attrs: {...},
    rels: {...}
  }
}
```

## `$fx_...` effect addresses

### Как парсятся

Если строка начинается с `$fx_`, `parse.js` распознает её как effect address.

Например:

```text
$fx_test
< $fx_requestWeather < selectedLocation
```

Если в parsed state path начинается с `$fx_`, результат получает:

- `result_type: 'effect'`
- `effect.effect_name = '$fx_...'`

### Где допустимы

В `targetedResult/dcl.js` `$fx_`-target допустим только без `action` option.

Он требует:

- `intent`

Разрешенные intent:

- `request`
- `refresh`
- `reload`
- `reset`
- `append`
- `call`

### Что происходит при сохранении

`save.js` не пишет attr/rel напрямую.
Он ставит fx task в очередь через `enqueueFxTask(...)`.

### Важные ограничения

- `$fx_` target нельзя комбинировать с `action`
- `intent: 'append'` допустим только для `nest_request` effect
- валидатор проверяет, что effect реально существует в `__fx_by_name`

## Как различать contexts

Один и тот же token нельзя объяснять вне контекста.

### В deps

Смотрит `readingDeps.js`:

- `$noop`
- `$now`
- `$meta$timestamp`
- `$meta$payload`
- обычные multiPath address

### В target `to`

Смотрит `targetedResult/dcl.js`:

- `$output`
- `$payload`
- `*`
- `$fx_...`
- обычные attr/nesting address

### В base части multiPath

Смотрит `parse.js` + `inputBase.js`:

- `#`
- `^`
- `$input*`

## Примеры графов и адресов

### Граф 1

```text
SessionRoot
└─ activeProject
   ├─ resources: [R1, R2]
   ├─ tracks: [V1, A1]
   │  ├─ V1.clips: [C1, C2]
   │  └─ A1.clips: [C3]
   ├─ primaryVideoTrack -> V1
   └─ primaryAudioTrack -> A1
```

### Пример A

```text
< @all:timelineClipSource < resources
```

Результат:

- взять relation `resources`
- пройти по всем model в relation
- прочитать у каждой attr `timelineClipSource`
- вернуть list

### Пример B

```text
<< primaryVideoTrack
```

Результат:

- в `to` это target relation `primaryVideoTrack`
- в deps без zip такой адрес использовать нельзя

### Пример C

```text
< title <<< $input:project
```

Результат:

- взять из payload поле `project`
- интерпретировать его как runtime model
- прочитать у нее `title`

### Пример D

```text
to: { $output: ['$output'] }
```

Результат:

- значение шага не пишется в model
- оно становится `next_payload` для следующего шага inline saga

### Пример E

```ts
to: ['$fx_loadMore', { intent: 'append' }]
```

Результат:

- не mutation attr/rel
- а enqueue effect task
- валидатор проверит, что `$fx_loadMore` объявлен как effect и поддерживает `append`

## Что важно помнить при проектировании action

### 1. `$noop` — это не бизнес-строка

Если нужен истинный noop для pass, правильный путь:

```ts
['$noop', ...deps]
```

и потом:

```ts
return noop
```

а не произвольная строка.

### 2. `$output` нужен явно

Inline saga не переносит payload между шагами автоматически так, как это часто ожидают.
Если step должен передать данные следующему step, надо использовать `$output`.

### 3. `$input` работает только при описанном shape

Если step читает `$input*`, нужен `input_base_rel_shape`.
Если предыдущий step пишет в `$output`, а следующий читает это как `$input*`, нужен `output_base_rel_shape` у предыдущего step.

### 4. `deps` и `to` — разные dialects

Нельзя механически переносить адрес из deps в `to` и наоборот.

## Краткая таблица special tokens

### Deps

- `$noop` — служебный noop token для pass
- `$now` — функция `Date.now()`
- `$meta$timestamp` — meta timestamp dispatch
- `$meta$payload` — meta payload/context

### Base markers

- `#` — root
- `^`, `^^`, ... — parent levels
- `$input`, `$input:key` — runtime model из payload
- `$input_all`, `$input_all:key` — список runtime models
- `$input_id`, `$input_id:key` — model id -> runtime model
- `$input_id_all`, `$input_id_all:key` — список id -> список runtime models

### Special paths / targets

- `<<<<` — self/base itself
- `$output` — inline saga output
- `$payload` — alias inline saga output
- `*` — by-node-id sink
- `$fx_...` — effect target

## Практический вывод для minicut

Для minicut action design это означает:

- читать state traversal надо внутри DKT action deps
- если нужен настоящий noop, использовать DI token `['$noop', ...]`
- если multi-step action должен передавать промежуточный результат, использовать `$output`
- если нужно передавать runtime models между steps, описывать `input_base_rel_shape` и `output_base_rel_shape`

Именно непонимание этой границы обычно и рождает баги вида:

- payload потерялся между шагами
- `$noop` перепутали со строкой
- traversal вынесли наружу в adapter
- target path объявлен корректно синтаксически, но semantic phase у него другая