# DKT graph invariants and legacy cleanup plan

Date: 2026-05-10

## Цель

Зафиксировать MiniCut как DKT-only редактор с единой идентичностью через DKT `_node_id`.

Важно различать два разных смысла слова "graph":

- DKT graph state - объектная модель состояния редактора: `Project`, `Track`, `Clip`, `Resource`, `Text`, `Effect`.
- Render pipeline graph - вычисляемый execution artifact в `render/*`; это не editable state и не источник identity.

## Итоговый статус реализации

Выполнено:

- `guard:dkt-hard` проверяет running editor path на legacy source ids, attr lookup routing и no-op legacy stubs.
- `Project.importResource` больше не восстанавливает созданный resource по attrs; downstream flow получает DKT ref через `$output`.
- `Project.addResourceToTimeline` создаёт clip и relation updates в одном Project multi-target action.
- Timeline resource routing использует только DKT node id, без `source*Id` и без lookup-by-attrs.
- Остаточный ручной lookup идёт только по `_node_id`; он помечен `TODO(remove)` до появления чистого `$input_id` model-ref handoff в reducer args.
- `expectProjectGraphInvariants(ctx)` подключён к focused graph mutation contract tests.
- Удалён no-op legacy `authorityClient.contract.ts`.
- Удалён P2P `workerProtocol: 'legacy' | 'dkt'` branch; proxy worker закрывается только DKT `CLOSE_SESSION`.

## Canonical identity rule

Разрешено в running editor path:

- `_node_id`;
- actual DKT model ref;
- `$input_id` / `$input_id_all` в action declarations, когда DKT отдаёт достаточно контекста;
- тестовые helpers вида `findResourceById`, если они не участвуют в production mutation routing.

Запрещено в production mutation routing:

- `sourceProjectId`, `sourceTrackId`, `sourceResourceId`, `sourceClipId`, `sourceTextId`, `sourceEffectId`;
- `sourceResourceName`;
- `findByAttr`, `findByAttrs`, `lookupByAttr`, `resolveByAttrs`.

## Invariant suite as gate

Обязательный gate для graph mutations - это post-condition assertion:

```ts
await expectProjectGraphInvariants(ctx)
```

Его нужно вызывать после тестового dispatch, если action создаёт, удаляет или перелинковывает graph nodes/rels:

- project/track/resource/clip/text/effect creation;
- `track.clips`, `clip.track`, `clip.resource`, `clip.text`, `clip.effects`;
- split/delete/move clip sagas;
- `project.tracks`, `project.resources`;
- import/add-to-timeline flows.

Не нужно вызывать gate после чистых attr-only изменений, если action не меняет graph topology.

Один известный low-level компромисс: isolated relation setter может менять только одну сторону relation, если его контракт именно такой. Для пользовательского flow нужно использовать orchestration action, например `Project.moveClipToTrack`, и уже для него invariant gate обязателен.

## Текущая декларация `Project.addResourceToTimeline`

Action использует multi-target output:

```ts
addResourceToTimeline: [
  {
    to: {
      clip: ['<< clip << #', {
        method: 'at_end',
        can_create: true,
        can_hold_refs: true,
        creation_shape: CLIP_CREATION_SHAPE,
      }],
      videoClips: ['<< primaryVideoTrack.clips', {
        method: 'at_end',
        can_use_refs: true,
      }],
      audioClips: ['<< primaryAudioTrack.clips', {
        method: 'at_end',
        can_use_refs: true,
      }],
    },
    fn: [
      [
        '$noop',
        '<< @all:resources',
        '<< @one:primaryVideoTrack',
        '<< @one:primaryAudioTrack',
        '< @one:appendStart < primaryVideoTrack',
        '< @one:appendStart < primaryAudioTrack',
      ] as const,
      reduceAddResourceToTimeline,
    ],
  },
]
```

Reducer создаёт clip с `hold_ref_id: 'timelineClip'`, ставит `rels.track` и `rels.resource`, затем возвращает только активный relation target:

```ts
return kind === 'audio'
  ? { ...result, audioClips: { use_ref_id: 'timelineClip' } }
  : { ...result, videoClips: { use_ref_id: 'timelineClip' } }
```

Пропущенный key в multi-target означает, что target не мутируется. `$noop` тоже допустим как явный сигнал, но текущий вариант выбран как более компактный.

## Guardrails

Файл:

- `scripts/check-dkt-hard-guardrails.mjs`

Production roots:

- `src/video-editor/app`
- `src/video-editor/components`
- `src/video-editor/models`
- `src/video-editor/render`
- `src/video-editor/p2p`
- `src/video-editor/worker`

Проверки:

- legacy source-id identity usage;
- attribute lookup routing;
- no-op legacy contract stubs.

Команда:

```powershell
cmd /c npm.cmd run guard:dkt-hard
```

## Focused tests

Invariant gate уже используется в:

- `src/video-editor/dkt/models/session-root-action-contracts.test.ts`
- `src/video-editor/dkt/models/project-track-action-contracts.test.ts`
- `src/video-editor/dkt/models/clip-action-contracts.integration.test.ts`
- `src/video-editor/dkt/models/text-effect-resource-action-contracts.test.ts`
- `src/video-editor/dkt/models/track-clip-rel.test.ts`
- `src/video-editor/dkt/models/split-clip-saga.test.ts`
- `src/video-editor/dkt/models/addResourceToTimeline-appendStart.test.ts`
- `src/video-editor/dkt/models/project-graph-invariants.test.ts`
- `src/video-editor/dkt/models/resource-node-id-routing.test.ts`

`resource-node-id-routing.test.ts` отдельно фиксирует, что `Project.addResourceToTimeline` маршрутизирует image/video в video track, audio в audio track, и делает это по DKT node id.

## Validation matrix

Fast:

```powershell
cmd /c npm.cmd run guard:dkt-hard
cmd /c npm.cmd run test:video-editor:node
```

Full local:

```powershell
cmd /c npm.cmd run test:video-editor
cmd /c npm.cmd run video-editor:build
```

P2P:

```powershell
cmd /c npm.cmd run test:video-editor -- src/video-editor/p2p/PageP2PManager.test.ts
cmd /c npm.cmd run test:integration:p2p:smoke
```

## Остаточный TODO

`src/video-editor/models/Project/actions.ts` всё ещё содержит временный `_node_id` lookup:

```ts
// TODO(remove): replace this node-id lookup with a pure $input_id model-ref handoff
// once DKT action deps expose the resolved transient base as a reducer argument.
```

Это не legacy compatibility layer и не lookup-by-attrs. Это node-id-only bridge до тех пор, пока DKT action deps не позволят получить resolved model ref напрямую из `$input_id` в reducer.
