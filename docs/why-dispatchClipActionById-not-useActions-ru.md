# Почему useActions() недостаточно как универсальный слой и почему by-id wrappers надо убирать

## TL;DR

`useActions()` подходит для обычных clip-команд, когда компонент уже находится в нужном `Clip scope`.

`actions.renameClipById` и похожие wrapper-методы, которые делают traversal вне DKT actions, это anti-pattern.

Если UI не находится в нужном scope, traversal все равно должен происходить внутри DKT action chain, обычно от dispatch на `SessionRoot`.

---

## Сценарий 1: scoped UI, прямой dispatch

### ClipItem (внутри Clip scope)

```typescript
const dispatch = useActions()
dispatch('moveBy', { delta })
```

Flow:
1. `useActions()` берет текущий scope из `ScopeContext`.
2. Возвращается `runtime.getDispatch(scope)`.
3. `dispatch('moveBy', ...)` идет прямо в action текущего `Clip`.

---

## Сценарий 2: Inspector тоже в Clip scope

В текущем коде `Inspector` рендерит выбранные панели внутри:

```tsx
<ScopeContext.Provider value={resolvedClipScope}>
  <SelectedClipPanels ... />
</ScopeContext.Provider>
```

Это значит, что `InspectorClipHeader` находится в `Clip scope` выбранного клипа.

Следствие:
1. Для rename здесь можно и нужно использовать scoped dispatch (`useActions` + `dispatch('rename', { name })`).
2. `actions.renameClipById(...)` в этом месте не обязателен и считается лишним wrapper-слоем.

---

## Сценарий 3: компонент вне target scope

Если компонент не внутри нужного clip scope, правильный путь:

```typescript
dispatchRoot('renameClipByIdRequested', { clipId, name })
```

Дальше внутри DKT:
1. `SessionRoot` action по deps находит target clip.
2. Следующим шагом делает subwalker dispatch на найденный `Clip`.
3. Если clip не найден, делается явный `$noop` или controlled error branch.

---

## Почему by-id wrapper в adapter это anti-pattern

Плохой паттерн:
1. UI вызывает `actions.renameClipById(clipId, name)`.
2. Adapter вызывает `dispatchClipActionById`.
3. Adapter сам travers-ит `activeProject -> tracks -> clips`.
4. Adapter dispatch-ит action на найденный scope.

Проблемы:
1. Traversal утекает из DKT action layer.
2. Правила адресации дублируются с model-layer.
3. Появляется склонность к скрытому fallback behavior.
4. Под каждую команду появляется новая wrapper-обертка.

---

## Нормативное правило

### Запрещено

1. Добавлять новые методы вида `actions.*ById(...)`, если они снаружи DKT ищут scope через graph traversal.
2. Добавлять helper-ы типа `findClipScopeById` / `dispatchClipActionById` в adapter/UI boundary.
3. Делать `readOne/readMany/readAttrs` в adapter только ради target resolution.
4. Делать неявный fallback на selected entity при lookup failure.

### Разрешено

1. Scoped `useActions()` для синхронных model actions, если компонент уже в нужном scope.
2. Root command (`SessionRoot`) + target resolution внутри DKT action.
3. Async/IO через DKT command -> `$fx_*` -> executor.

---

## Почему export не сводится к "просто useActions()"

`queueClipExportById` сейчас это orchestration, а не простой clip reducer action:
1. range/plan selection,
2. renderer call,
3. progress/result,
4. blob url lifecycle.

Сделать export action в `Clip` можно, но это уже DKT saga/command-flow:
1. command action,
2. `$fx_renderExport`,
3. task protocol для progress/result/error.

---

## Полный flow для каждой функции VideoEditorHarnessActions

Обозначения:
- `Root`: `dispatchRoot(env, action, payload)`
- `Project`: `dispatchProject(env, action, payload)`
- `Selected`: `dispatchSelectedClipAction(env, action, payload)`
- `ById`: `dispatchClipActionById(env, clipId, action, payload)`

### A. Project/session control

1. `createProject(title?)`
- UI -> adapter
- adapter генерирует `sourceProjectId`/title
- Root `createProject`
- graph mutation в SessionRoot action chain

2. `setActiveProject(projectId)`
- UI -> adapter -> Root `setActiveProject`

3. `selectEntity(entityId)`
- UI -> adapter -> Root `selectEntity`

4. `setActiveInspectorTab(tab)`
- UI -> adapter -> Root `setActiveInspectorTab`

5. `togglePlayback()`
- UI -> adapter -> Root `togglePlayback`

6. `setCursor(value)`
- UI -> adapter -> Root `setCursor`

7. `tickPlayback(deltaSeconds)`
- UI -> adapter -> Root `tickPlayback`

8. `zoomTimeline(delta)`
- UI -> adapter -> Root `zoomTimeline`

### B. Import/create timeline entities

9. `importSampleResource()`
- UI -> adapter -> Root `importSampleResource`

10. `importFiles(files)`
- UI -> adapter -> `importFilesDirectly` (imperative async pipeline)
- waits + direct graph reads + direct dispatch on project scope
- anti-pattern branch (target: move to DKT + fx)

11. `addResourceToTimeline(resourceId)`
- UI -> adapter -> Project `addResourceToTimeline`
- project scope resolution в adapter

12. `addTextClip(content?)`
- UI -> adapter
- генерируются `sourceTextId` + `sourceClipId`
- Root `addTextClipToTimeline`

13. `addTrack(kind)`
- UI -> adapter -> Project `addTrack`

### C. Clip by-id wrappers (anti-pattern)

Общий flow для каждого:
- UI -> adapter method
- `ById` -> `findClipScopeById`
- traversal `activeProject -> tracks -> clips` + `sourceClipId`
- найден -> dispatch на clip scope
- не найден -> fallback на `Selected`

14. `renameClipById` -> `rename`
15. `colorClipById` -> `color`
16. `updateClipOpacityById` -> `updateOpacity`
17. `updateClipFadeById` -> `setFade`
18. `updateClipTransformById` -> `setTransform`
19. `updateClipAudioById` -> `setAudio`
20. `trimClipById` -> `trim`
21. `resizeClipById` -> `resize`
22. `addEffectToClip` -> `addEffect`
23. `addColorCorrectionToClip` -> `addEffect(color-correction)`
24. `deleteClipById` -> `removeSelf`
25. `splitClipByIdAt` -> `splitSelfAt`
26. `removeEffectFromClip` -> `removeEffect`
27. `moveClipById` -> `moveBy`

### D. Selected clip flows

Общий flow:
- UI -> adapter
- `Selected` helper читает `selectedClip` у root
- dispatch на selected clip scope

28. `renameSelectedClip` -> `rename`
29. `colorSelectedClip` -> `color`
30. `updateSelectedClipOpacity` -> `updateOpacity`
31. `updateSelectedClipFade` -> `setFade`
32. `updateSelectedClipTransform` -> `setTransform`
33. `updateSelectedClipAudio` -> `setAudio`
34. `trimSelectedClip` -> `trim`
35. `addEffectToSelectedClip` -> `addEffect`
36. `addColorCorrectionToSelectedClip` -> `addEffect(color-correction)`
37. `removeEffectFromSelectedClip` -> `removeEffect`
38. `nudgeSelectedClip` -> `moveBy`

### E. Root selected-clip commands (лучше)

39. `deleteSelectedClip()`
- UI -> adapter -> Root `deleteSelectedClip`
- resolution внутри DKT

40. `splitSelectedClip()`
- UI -> adapter -> Root `splitSelectedClip`
- resolution внутри DKT

### F. Export flows

41. `queueClipExportById(clipId, onProgress?)`
- UI -> adapter -> `queueExport(range=clip)`
- project scope resolution + attrs reads + fallback/computed plan selection
- `env.export.render`
- blob url registration

42. `queueSelectedClipExport(onProgress?)`
- UI -> adapter
- selected clip attrs -> clipId
- потом flow как в п.41

43. `queueProjectExport(onProgress?)`
- UI -> adapter -> `queueExport(range=project)`
- потом flow как в п.41

---

## Сводная таблица по всем функциям

| Функция | Entry dispatch | Где traversal сейчас | Final action/effect | Статус |
|---|---|---|---|---|
| createProject | Root | нет (кроме title/id util) | SessionRoot.createProject | Ок |
| setActiveProject | Root | нет | SessionRoot.setActiveProject | Ок |
| importSampleResource | Root | нет | SessionRoot import chain | Ок |
| importFiles | imperative async | adapter waits + graph reads | importResource + transfer side effects | Не ок |
| addResourceToTimeline | Project | adapter project lookup | Project.addResourceToTimeline | Не ок |
| addTextClip | Root | нет | addTextClipToTimeline chain | Ок |
| addTrack | Project | adapter project lookup | Project.addTrack | Не ок |
| selectEntity | Root | нет | SessionRoot.selectEntity | Ок |
| setActiveInspectorTab | Root | нет | SessionRoot.setActiveInspectorTab | Ок |
| renameClipById | ById | adapter traversal | Clip.rename | Anti-pattern |
| renameSelectedClip | Selected | adapter selected lookup | Clip.rename | Transitional |
| colorClipById | ById | adapter traversal | Clip.color | Anti-pattern |
| colorSelectedClip | Selected | adapter selected lookup | Clip.color | Transitional |
| updateClipOpacityById | ById | adapter traversal | Clip.updateOpacity | Anti-pattern |
| updateSelectedClipOpacity | Selected | adapter selected lookup | Clip.updateOpacity | Transitional |
| updateClipFadeById | ById | adapter traversal | Clip.setFade | Anti-pattern |
| updateSelectedClipFade | Selected | adapter selected lookup | Clip.setFade | Transitional |
| updateClipTransformById | ById | adapter traversal | Clip.setTransform | Anti-pattern |
| updateSelectedClipTransform | Selected | adapter selected lookup | Clip.setTransform | Transitional |
| updateClipAudioById | ById | adapter traversal | Clip.setAudio | Anti-pattern |
| updateSelectedClipAudio | Selected | adapter selected lookup | Clip.setAudio | Transitional |
| trimClipById | ById | adapter traversal | Clip.trim | Anti-pattern |
| trimSelectedClip | Selected | adapter selected lookup | Clip.trim | Transitional |
| resizeClipById | ById | adapter traversal | Clip.resize | Anti-pattern |
| addEffectToClip | ById | adapter traversal | Clip.addEffect | Anti-pattern |
| addEffectToSelectedClip | Selected | adapter selected lookup | Clip.addEffect | Transitional |
| addColorCorrectionToClip | ById | adapter traversal | Clip.addEffect(color-correction) | Anti-pattern |
| addColorCorrectionToSelectedClip | Selected | adapter selected lookup | Clip.addEffect(color-correction) | Transitional |
| deleteClipById | ById | adapter traversal | Clip.removeSelf | Anti-pattern |
| deleteSelectedClip | Root | внутри DKT | SessionRoot.deleteSelectedClip | Target pattern |
| splitSelectedClip | Root | внутри DKT | SessionRoot.splitSelectedClip | Target pattern |
| splitClipByIdAt | ById | adapter traversal | Clip.splitSelfAt | Anti-pattern |
| removeEffectFromClip | ById | adapter traversal | Clip.removeEffect | Anti-pattern |
| removeEffectFromSelectedClip | Selected | adapter selected lookup | Clip.removeEffect | Transitional |
| queueClipExportById | queueExport | adapter graph reads | export renderer side effect | Move to DKT saga/fx |
| queueSelectedClipExport | queueExport | adapter selected+graph reads | export renderer side effect | Move to DKT saga/fx |
| queueProjectExport | queueExport | adapter graph reads | export renderer side effect | Move to DKT saga/fx |
| nudgeSelectedClip | Selected | adapter selected lookup | Clip.moveBy | Transitional |
| moveClipById | ById | adapter traversal | Clip.moveBy | Anti-pattern |
| togglePlayback | Root | нет | SessionRoot.togglePlayback | Ок |
| setCursor | Root | нет | SessionRoot.setCursor | Ок |
| tickPlayback | Root | нет | SessionRoot.tickPlayback | Ок |
| zoomTimeline | Root | нет | SessionRoot.zoomTimeline | Ок |

---

## Идеальный target flow

1. UI вызывает либо scoped `useActions()` (если уже в нужном scope), либо root command.
2. Если нужен поиск target по id, это делает DKT action через deps/subwalker.
3. Adapter не делает graph traversal для адресации.
4. Async/IO идет через DKT command -> `$fx_*` -> executor.
5. Финальные graph mutations всегда результат DKT action chain.
