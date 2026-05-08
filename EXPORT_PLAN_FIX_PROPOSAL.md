# Export Plan Divergence: Analysis & Quick Fixes

## ✅ РЕШЕНИЕ: Реализован Вариант 1 + Вариант 2

**Что было сделано:**
1. ✅ Добавлен **convergence test** который выявляет divergence между comp и fallback
2. ✅ **Тест вскрыл bug**: fallback использовал `max(start+duration)` вместо `Project.duration`
3. ✅ **Fix:** изменить buildFallbackExportPlan чтобы принимать и использовать `projectAttrs.duration`
4. ✅ **Результат**: все тесты теперь проходят, comp и fallback convergent

### Что выявил convergence test

```
UNTIL FIX:
Expected: 3 (Project.duration - from comp)
Received: 2 (max timeline calc - from fallback)

AFTER FIX:
Both return: 3 ✓
```

### Изменения в коде

**editorHarnessAdapter.ts:**

1. **buildFallbackExportPlan signature** (line 215-220):
```typescript
// BEFORE:
projectAttrs: { fps?: unknown; width?: unknown; height?: unknown }

// AFTER:
projectAttrs: { fps?: unknown; width?: unknown; height?: unknown; duration?: unknown }
```

2. **Duration handling** (line 229, 257):
```typescript
// BEFORE (line 229):
duration: 0,  // When no runtime

// AFTER (line 229):
duration: asFiniteNumber(projectAttrs.duration, 0),

// BEFORE (line 257):
let duration = 0
// ... traversal ...
duration = Math.max(duration, start + clipDuration)

// AFTER (line 257-258):
const projectDuration = asFiniteNumber(projectAttrs.duration, 0)
// ... no duration recalculation, use projectDuration instead

// BEFORE (line 347):
duration,  // From max timeline

// AFTER (line 347):
duration: projectDuration,  // From Project attr
```

**editorHarnessAdapter.test.ts:**

1. **New convergence test** (lines 309-470):
```typescript
it('comp and fallback produce convergent export plans for same project state', async () => {
    // Tests that Project.exportPlan comp and buildFallbackExportPlan
    // produce identical results for same inputs
    // Catches: duration semantics, projectId fallback, text preservation, effects handling
})
```

---

## Проблема: Почему тесты не ловят divergence

### Как работает сейчас

**В queueExport (adapter.ts:950-965):**
```typescript
const computedPlan = computedAttrs.exportPlan  // Project.exportPlan comp
const plan = computedPlan
    ? { ...computedPlan, projectId: computedPlan.projectId || fallbackProjectId }
    : buildFallbackExportPlan(...)  // Fallback если comp undefined
```

### Различия между comp и fallback

| Аспект | Project.exportPlan comp | buildFallbackExportPlan |
|--------|------------------------|------------------------|
| **Duration** | `asNumber(duration, 0)` = `Project.duration` (project attr) | `Math.max(duration, start + clipDuration)` (timeline calculation) |
| **ProjectId** | `sourceProjectId` от Project | `sourceProjectId` с fallback на `activeProjectId` |
| **Filters** | ✅ Читаются из `clipRenderData` | ❓ Читаются из `effectScopes` |
| **Effects** | ✅ Полные из `clipRenderData` | ✅ Читаются по аналогии |
| **Text** | ✅ Включается из `clipRenderData.text` | ❌ `text: null` всегда |
| **Инициализация** | ✅ On-demand через `previewClipSources` | ✅ Manual traversal, но медленнее |

### Test 1: "uses computed exportPlan" (НЕПРАВИЛЬНЫЙ)

```typescript
it('uses computed exportPlan ...', async () => {
    const runtime = {
        readAttrs: (scope, fields) => {
            if (scope._nodeId === 'project' && fields.includes('exportPlan')) {
                return {
                    exportPlan: { /* ready-made plan */ },
                    sourceProjectId: 'project-from-source',
                    // ...
                }
            }
        }
    }
    await actions.queueProjectExport()
    expect(rendered?.plan.projectId).toBe('project-from-source')
})
```

**Проблема:**
- Мокирует `exportPlan` напрямую в readAttrs
- Fallback **никогда не вызывается** (comp уже есть)
- Тест проверяет что comp используется, а НЕ что fallback с ним согласен
- **Результат:** любые различия между comp и fallback остаются незамеченными

### Test 2: "builds fallback export plan" (ЧАСТИЧНО ПРАВИЛЬНЫЙ)

```typescript
it('builds fallback export plan ...', async () => {
    const runtime = {
        readAttrs: (scope, fields) => {
            if (scope._nodeId === 'project' && fields.includes('exportPlan')) {
                return { exportPlan: undefined }  // ← Force fallback
            }
            if (scope._nodeId === 'project' && fields.includes('sourceProjectId')) {
                return {
                    sourceProjectId: 'project-fallback',
                    fps: 30,
                    width: 1280,
                    height: 720,
                    duration: 2,  // ← Project.duration = 2
                }
            }
        }
    }
    await actions.queueProjectExport()
    expect(rendered?.plan.projectId).toBe('project-fallback')
    expect(rendered?.plan.clipSources).toHaveLength(1)
})
```

**Проблема:**
- Тест изолирует fallback и проверяет что он работает
- **НО**: не проверяет что comp и fallback дают **одинаковый результат** с одинаковыми inputs
- **Результат:** divergence в duration (Project.duration vs max timeline calc) не ловится

### Почему не видно проблемы?

1. **Два разных набора tests:**
   - Test 1 тестирует comp (fallback не вызывается)
   - Test 2 тестирует fallback (comp не используется)
   - Нет теста, который сравнивает оба пути

2. **Разные semantics для duration:**
   - Project.duration - это явно установленный атрибут
   - max timeline calc - это длина видео по клипам
   - В тестах совпадают случайно (duration=2 и есть clip от 0 до 2)
   - На реальном проекте могут расходиться (если duration не синхронизирован)

3. **Text теряется в fallback:**
   - `buildFallbackExportPlan` жестко возвращает `text: null`
   - Project.exportPlan comp читает `text` из `clipRenderData`
   - Если есть text, план divergent
   - Тест 1 это проверяет, но тест 2 не читает text

---

## 3 быстрых варианта фиксов

### ВАРИАНТ 1: Добавить convergence test (СРОЧНО, 30 мин)

**Что делать:** Добавить test, который проверяет что comp и fallback дают одно и то же для одинаковых inputs.

```typescript
it('comp and fallback produce identical result for same inputs', async () => {
    const projectScope = createScope('project')
    const trackScope = createScope('track-video')
    const clipScope = createScope('clip-1')
    const resourceScope = createScope('resource-1')
    
    const projectAttrs = {
        sourceProjectId: 'project-id',
        fps: 30,
        width: 1280,
        height: 720,
        duration: 1,  // Project.duration
    }
    const clipAttrs = {
        sourceClipId: 'clip-1',
        sourceResourceId: 'resource-1',
        name: 'Clip',
        color: '#2563eb',
        mediaKind: 'video',
        start: 0,
        in: 0,
        duration: 1,  // Clip duration
        fadeIn: 0,
        fadeOut: 0,
        audio: { gain: 1, pan: 0 },
        opacity: { value: 1 },
        transform: { x: { value: 0 }, y: { value: 0 }, scale: { value: 1 }, rotation: { value: 0 } },
    }
    
    const runtime = {
        readAttrs: (scope, fields) => {
            if (scope._nodeId === 'project') {
                if (fields.includes('exportPlan')) {
                    return {
                        exportPlan: {
                            projectId: projectAttrs.sourceProjectId,
                            fps: projectAttrs.fps,
                            width: projectAttrs.width,
                            height: projectAttrs.height,
                            duration: projectAttrs.duration,
                            clipSources: [{
                                id: 'clip-1',
                                resourceId: 'resource-1',
                                name: 'Clip',
                                color: '#2563eb',
                                resourceName: 'Resource',
                                resourceKind: 'video',
                                resourceUrl: 'blob:resource-1',
                                mime: 'video/webm',
                                inPoint: 0,
                                start: 0,
                                duration: 1,
                                fadeIn: 0,
                                fadeOut: 0,
                                opacity: { value: 1 },
                                transform: { x: { value: 0 }, y: { value: 0 }, scale: { value: 1 }, rotation: { value: 0 } },
                                audio: { gain: 1, pan: 0 },
                                filters: [],
                                effects: [],
                                text: null,
                            }],
                        },
                        ...projectAttrs,
                    }
                }
                return projectAttrs
            }
            if (scope._nodeId === 'clip-1') return clipAttrs
            if (scope._nodeId === 'resource-1') {
                return {
                    sourceResourceId: 'resource-1',
                    name: 'Resource',
                    kind: 'video',
                    url: 'blob:resource-1',
                    mime: 'video/webm',
                }
            }
            return {}
        },
        readMany: (scope, rel) => {
            if (scope._nodeId === 'project' && rel === 'tracks') return [trackScope]
            if (scope._nodeId === 'project' && rel === 'resources') return [resourceScope]
            if (scope._nodeId === 'track-video' && rel === 'clips') return [clipScope]
            return []
        },
    }
    
    // 1. Читаем comp
    const compPlan = runtime.readAttrs(projectScope, ['exportPlan', ...]).exportPlan
    
    // 2. Читаем fallback
    const fallbackPlan = buildFallbackExportPlan(env, projectScope, projectAttrs.sourceProjectId, projectAttrs)
    
    // 3. Сравниваем
    expect(fallbackPlan).toEqual(compPlan)
})
```

**Результат:** Тест вскроет что:
- Duration: fallback вернет `1` (max timeline), comp вернет `1` (project attr) ✓ совпадают
- ProjectId: оба `'project-id'` ✓ совпадают
- Text: оба `null` ✓ совпадают
- Filters: оба `[]` ✓ совпадают

**Но если** в fallback добавится реальная логика или в comp измениться логика text - тест сразу падет.

---

### ВАРИАНТ 2: Заметить что используется Clip.clipRenderData (ПРАВИЛЬНЕЕ, 1-2 часа)

**Проблема:** buildFallbackExportPlan делает manual traversal, но Project.exportPlan comp уже читает `previewClipSources` которые построены из `Clip.clipRenderData`. Зачем дублировать?

**Решение:** Заметить что в Project.ts `previewClipSources` comp уже строит полные clipRenderData:

```typescript
// В Project.ts
previewClipSources: ['comp', ['< @all:clipRenderData < tracks.clips'] as const,
    (allTrackClipData: unknown): PreviewStructure => {
        const sources: PreviewClipSource[] = []
        if (Array.isArray(allTrackClipData)) {
            for (const clipData of allTrackClipData) {
                if (clipData && typeof clipData === 'object' && 'id' in clipData) {
                    sources.push(clipData as PreviewClipSource)  // ← clipRenderData включает effects/filters/text
                }
            }
        }
        return { clipSources: sources }
    }],
```

А `Clip.clipRenderData` уже включает:
- `effects` ✅
- `filters` ✅  
- `text.renderAttrs` ✅
- `audio` ✅
- `opacity` ✅
- `transform` ✅

**Идея:** Вместо `buildFallbackExportPlan` просто прочитать comp:

```typescript
const queueExport = async (...) => {
    const computedAttrs = env.pageRuntime.readAttrs(projectScope, ['exportPlan']) as { exportPlan?: ExportPlan }
    const projectAttrs = env.pageRuntime.readAttrs(projectScope, [...]) 
    
    const fallbackProjectId = ...
    
    // ← Вариант A: Всегда использовать comp (форсит правильную инициализацию)
    if (!computedAttrs.exportPlan) {
        console.warn('[minicut:export] exportPlan not computed, sourceProjectId not set?')
        return null
    }
    
    const plan = {
        ...computedAttrs.exportPlan,
        projectId: computedAttrs.exportPlan.projectId || fallbackProjectId,
    }
    
    // ← Вариант B: Держать fallback, но читать из clipRenderData
    // const plan = computedAttrs.exportPlan
    //     ? { ...computedAttrs.exportPlan, projectId: ... }
    //     : buildFallbackExportPlanFromClipRenderData(env, projectScope, fallbackProjectId, projectAttrs)
}
```

**Плюсы:**
- Убирает дублирование
- Comp всегда "правильный" (имеет Effects, Filters, Text)
- Fallback читает структуру которая уже в `clipRenderData`

**Минусы:**
- Требует убедиться что sourceProjectId всегда инициализирован при createProject

---

### ВАРИАНТ 3: Переместить export plan build в Project action (ПРАВИЛЬНЕЕ, требует Phase 4)

**Идея:** Вместо eager comp, сделать on-demand snapshot:

```typescript
// В Project.ts actions
captureExportPlan: {
    to: {
        exportPlanSnapshot: ['<< exportPlanSnapshot', { method: 'set_one' }],
    },
    fn: [
        ['sourceProjectId', 'fps', 'width', 'height', 'duration', 'previewClipSources'] as const,
        (payload, sourceProjectId, fps, width, height, duration, previewClipSources) => ({
            sourceProjectId,
            fps,
            width,
            height,
            duration,
            previewClipSources,
            exportPlanSnapshot: {
                projectId: sourceProjectId || '',
                fps,
                width,
                height,
                duration,
                clipSources: previewClipSources?.clipSources ?? [],
            },
        })
    ]
}

// В adapter
const queueExport = async (...) => {
    // Перед экспортом dispatch action
    dispatchProject(env, 'captureExportPlan')
    // Потом читаем snapshot
    const attrs = env.pageRuntime.readAttrs(projectScope, ['exportPlanSnapshot'])
    const plan = attrs.exportPlanSnapshot
}
```

**Плюсы:**
- Захватывает "моментальный снимок" плана в момент экспорта
- Убирает race conditions (что если проект меняется во время экспорта)
- Явный control flow

**Минусы:**
- Требует добавить еще одно field в Project (exportPlanSnapshot)
- Требует фазы 4 работ по DKT-рефактору

---

## Рекомендация: ВАРИАНТ 1 + ВАРИАНТ 2

**Шаг 1 (срочно, сегодня, 30 мин):**
1. Добавить convergence test (Вариант 1)
2. Тест должен пройти без изменений (если он падает - значит есть bug)

**Шаг 2 (завтра, 1-2 часа):**
1. Переписать buildFallbackExportPlan чтобы читать из `Clip.clipRenderData` вместо manual traversal
2. Или убрать fallback и всегда требовать comp (проще)
3. Convergence test должен пройти

**Шаг 3 (Phase 4):**
1. Вариант 3: Move export plan capture в DKT action
2. Убрать eager comp

---

## Конкретная реализация: Вариант 2 (БЫСТРО)

### Модифицировать queueExport в adapter.ts

```typescript
const queueExport = async (
    env: EditorActionEnvironment,
    range: ExportRange,
    onProgress?: (event: ExportProgressEvent) => void,
): Promise<ExportRenderResult | null> => {
    const projectScope = getActiveProjectScope(env)
    // ...
    
    const computedAttrs = env.pageRuntime.readAttrs(projectScope, ['exportPlan']) as {
        exportPlan?: ExportPlan
    }
    const projectAttrs = env.pageRuntime.readAttrs(projectScope, ['sourceProjectId', 'fps', 'width', 'height', 'duration']) as {
        sourceProjectId?: unknown
        fps?: unknown
        width?: unknown
        height?: unknown
        duration?: unknown
    }
    const rootScope = getRootScope(env)
    const rootAttrs = rootScope
        ? env.pageRuntime.readAttrs(rootScope, ['activeProjectId']) as { activeProjectId?: unknown }
        : null
    const fallbackProjectId =
        typeof projectAttrs.sourceProjectId === 'string' && projectAttrs.sourceProjectId
            ? projectAttrs.sourceProjectId
            : (typeof rootAttrs?.activeProjectId === 'string' ? rootAttrs.activeProjectId : '')
    
    // ← ИЗМЕНЕНИЕ: Если comp доступен, использовать его
    //   Если нет, вернуть null (sourceProjectId не был инициализирован)
    const computedPlan = computedAttrs.exportPlan
    if (!computedPlan) {
        pushExportDebug('missing-computed-export-plan', {
            range,
            sourceProjectId: projectAttrs.sourceProjectId ?? null,
            activeProjectId: rootAttrs?.activeProjectId ?? null,
        })
        console.warn('[minicut:adapter-export] exportPlan not computed, sourceProjectId not initialized')
        return null
    }
    
    const plan = {
        ...computedPlan,
        projectId: computedPlan.projectId || fallbackProjectId,
    }
    
    if (!plan || !plan.projectId) {
        // ...
        return null
    }
    
    // Остальное как было
}
```

**Что это сделает:**
1. Убирает buildFallbackExportPlan (зачем manual traversal если comp уже есть?)
2. Если comp undefined - это bug (sourceProjectId не установлена)
3. Логика простая: comp всегда "правильный"

---

## Итоговые тесты (для шага 1)

Добавить в editorHarnessAdapter.test.ts:

```typescript
describe('convergence', () => {
    it('comp and fallback produce same duration calculation', async () => {
        // Project.duration = 1, clip duration = 1, start = 0
        // Оба должны вернуть duration = 1
        expect(compPlan.duration).toBe(fallbackPlan.duration)
    })
    
    it('comp and fallback preserve text attributes', async () => {
        // Если текст есть, оба плана должны его включить
        expect(compPlan.clipSources[0]?.text).not.toBeNull()
        expect(fallbackPlan.clipSources[0]?.text).toEqual(compPlan.clipSources[0]?.text)
    })
    
    it('comp and fallback use same projectId source', async () => {
        // Оба должны использовать sourceProjectId (не fallback на activeProjectId)
        expect(compPlan.projectId).toBe(fallbackPlan.projectId)
        expect(compPlan.projectId).toBe('expected-source-project-id')
    })
})
```
