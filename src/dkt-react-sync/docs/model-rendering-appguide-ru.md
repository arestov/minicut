# DKT Model-First Rendering AppGuide

Дата: 2026-05-05

Этот документ лежит рядом с `src/dkt-react-sync` временно, чтобы зафиксировать правило для MiniCut migration. Он не должен превращать generic layer в MiniCut layer.

## Главное правило

Rendering идет top-down по DKT model tree. React-компонент не ищет данные в середине графа и не вычисляет межмодельные зависимости сам.

Правильная цепочка:

```text
model rels / comp attrs / comp rels
  -> sync stream
  -> current scope
  -> useAttrs / One / Many / Path
  -> local useActions
  -> model action
  -> optional forwarding through declared rel path
```

## Производное состояние

Если значение можно вычислить из модели и ее rels, это `comp` на модели, которая стоит выше по иерархии.

Примеры:

- `project.totalDuration` вычисляется на `Project` из `tracks/clips`.
- `project.hasVideo` вычисляется на `Project`, а не в React timeline.
- `clip.hasActiveColorGrade` вычисляется на `Clip` из `effects.kind/enabled`.
- `effect.projectDuration` не ищется в React; `Effect` получает это через объявленный rel/dependency path к `Clip/Track/Project` или через comp/forwarding выше.

Паттерн:

```ts
attrs: {
  totalDuration: ['comp', ['< @sum:duration < tracks'], (sum) => sum],
}
```

Для deep paths используй dep address paths, а не `debugDumpGraph()`.

## Родительское состояние

Если child нужен state родителя, не прокидывай его через React context вручную и не ищи parent в replica graph.

Допустимые варианты:

- parent считает comp и child читает его через объявленный rel path;
- parent action forwards нужное значение вниз;
- child имеет input rel/reference, установленный модельной операцией;
- child comp читает dependency path, если этот path стабилен в model tree.

## Actions

UI dispatch всегда локальный: компонент вызывает action текущей scope-модели.

Если действие должно изменить другую модель, локальная модель action должна forward-нуть payload через `to`:

```ts
actions: {
  applyToChild: {
    to: {
      childAction: ['<< child', { action: 'apply', sub_flow: true }],
    },
    fn: (payload) => ({ childAction: payload }),
  },
}
```

Для parent/up-tree действий используй DKT address syntax (`<<<<`, `<< rel << ^`, или другой объявленный путь), а не app-level switch в React adapter.

## What Not To Do

Не добавлять в render layer:

- graph-wide subscriptions;
- source-id search through `debugDumpGraph()`;
- selector functions that walk unrelated branches;
- legacy registry reads as fallback for DKT state;
- action switches that know every model action in the app.

`debugDescribeNode()` and `debugDumpGraph()` are diagnostics. They are acceptable in tests, logs, migration probes, and postmortems. They are not production traversal APIs.

## Generic Layer Boundary

`src/dkt-react-sync` may contain:

- sync receiver protocol parsing;
- scope handles;
- generic attr/rel reads and subscriptions;
- React bindings (`RootScope`, `One`, `Many`, `Path`, hooks);
- shape registry and bridge callbacks.

`src/dkt-react-sync` must not contain:

- MiniCut model names;
- MiniCut source-id lookup;
- MiniCut action routing;
- global app graph selectors;
- recovery policy for a specific app.

## MiniCut Migration Checklist

Before marking a UI path migrated:

- Component starts from a DKT scope.
- Component reads only scope attrs/rels or model comps.
- Parent/child traversal is declared in model rels or `Path`.
- Writes are local `useActions(scope)` calls.
- Cross-model writes are model action forwarding.
- No `debugDumpGraph()` in render path.
- No graph-wide subscription in model-first render code.
- No legacy `readComp()` for DKT-backed state.
