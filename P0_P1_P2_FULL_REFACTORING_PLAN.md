# Полный план рефакторинга: P0-P2 (all 6 items)

**Дата:** 9 мая 2026  
**Версия:** 1.0  
**Статус:** Detailed specification for all phases

---

## Структура документа

- **P0-1**: Удалить fallbackSelectedClipScope из Inspector
- **P0-2**: Явный delivery контракт для экспорта (minimal version без retry)
- **P1-1**: Выпилить legacy requestClipExport interface hook
- **P1-2**: Упростить subscribeToResourceScopes до события
- **P2-1**: Изолировать debug traversal
- **P2-2**: Event/subscription completion helpers вместо setTimeout

Каждый пункт содержит: **Было → Стало**, flow диаграмму, step-by-step изменения, валидацию.

---

# P0-1: Удалить fallbackSelectedClipScope traversal из Inspector

## Текущее состояние (Было)

**Файл:** `src/video-editor/components/Inspector.tsx`

```typescript
// Lines 53-71
const fallbackSelectedClipScope = (() => {
    const activeProjectScope = runtime.readOne(rootScope, 'activeProject')
    if (!activeProjectScope) return null
    
    const trackScopes = runtime.readMany(activeProjectScope, 'tracks')
    for (const trackScope of trackScopes) {
        const clipScopes = runtime.readMany(trackScope, 'clips')
        for (const clipScope of clipScopes) {
            const sourceClipId = runtime.readOne(clipScope, 'sourceClipId')
            if (sourceClipId === selectedClipSourceId) {
                return clipScope
            }
        }
    }
    return null
})()

const selectedClipScope = selectedClipScopeFromRel || fallbackSelectedClipScope
// Потом selectedClipScope используется для всех читаний attrs
```

### Проблемы

1. **Manual graph traversal** — нарушение Pure DKT (graph search вне action deps)
2. **Divergence risk** — если `selectedClip` rel потеряет синхронизацию (edge case при concurrent updates), fallback может вернуть другой clip
3. **Performance** — O(tracks × clips) поиск на каждый render
4. **Hidden fallback** — код скрывает проблему вместо явной ошибки

## Целевое состояние (Стало)

```typescript
// Используем ТОЛЬКО selectedClipScopeFromRel
const selectedClipScope = selectedClipScopeFromRel
// Если null → component не рендерится или показывает "no selection"
```

### Принцип

- `selectedClip` rel на SessionRoot — single source of truth
- Если rel не инициализирован → явная пустая state, не fallback search
- Сложность перемещается в DKT action (deps + inline_subwalker), не в UI component

## Flow: Был vs Стал

### ДО (with fallback)

```
┌──────────────────────────────────┐
│ Inspector component              │
│ prop: selectedClipSourceId        │
└──────────────────────┬────────────┘
                       │
        ┌──────────────┴──────────────┐
        │                             │
        ▼                             ▼
┌───────────────────────┐     ┌──────────────────────────┐
│ selectedClip rel read │     │ Manual traversal fallback│
│ via readOne(root,     │     │                          │
│'selectedClip')        │     │ for track in tracks      │
│                       │     │   for clip in clips      │
│ Result: scope or null │     │     if clip.sourceClipId │
│                       │     │        == targetId       │
│                       │     │       return clip        │
└───────────┬───────────┘     └──────────┬───────────────┘
            │                            │
            ▼                            ▼
        ┌─────────────────────────────────┐
        │ selectedClipScope               │
        │ = rel || fallback (DIVERGENCE!) │
        └──────────────┬──────────────────┘
                       │
                       ▼
                ┌──────────────────┐
                │ readOne/readMany │
                │ on selectedClip   │
                │ attrs (effect,    │
                │ filters, etc)     │
                └──────────────────┘

⚠️ RISK: rel и fallback могут вернуть разные scopes
```

### ПОСЛЕ (pure rel-only)

```
┌──────────────────────────────────┐
│ Inspector component              │
└──────────────────────┬────────────┘
                       │
                       ▼
        ┌──────────────────────────┐
        │ selectedClip rel read    │
        │ via readOne(root,        │
        │'selectedClip')           │
        └──────────────┬───────────┘
                       │
                ┌──────┴──────┐
                │             │
                ▼             ▼
          ┌─────────┐   ┌──────────────┐
          │ Scope   │   │ null/not set │
          │ found   │   │              │
          └────┬────┘   └────┬─────────┘
               │             │
               ▼             ▼
        ┌────────────┐  ┌─────────────┐
        │ readMany   │  │ Explicit:   │
        │ attrs from │  │ show empty  │
        │ selected   │  │ state or    │
        │ clip       │  │ "(none)"    │
        └────────────┘  └─────────────┘

✅ Clean: single path, no divergence
```

## Step-by-Step изменения

### Шаг 1: Удалить fallback function

**Файл:** `src/video-editor/components/Inspector.tsx`

**Было:**
```typescript
const selectedClipScope = (() => {
    const selectedClipScopeFromRel = runtime.readOne(rootScope, 'selectedClip')
    if (selectedClipScopeFromRel) return selectedClipScopeFromRel
    
    // Fallback traversal
    const fallbackSelectedClipScope = (() => {
        const activeProjectScope = runtime.readOne(rootScope, 'activeProject')
        if (!activeProjectScope) return null
        
        const trackScopes = runtime.readMany(activeProjectScope, 'tracks')
        for (const trackScope of trackScopes) {
            const clipScopes = runtime.readMany(trackScope, 'clips')
            for (const clipScope of clipScopes) {
                const sourceClipId = runtime.readOne(clipScope, 'sourceClipId')
                if (sourceClipId === selectedClipSourceId) {
                    return clipScope
                }
            }
        }
        return null
    })()
    
    return fallbackSelectedClipScope
})()
```

**Стало:**
```typescript
const selectedClipScope = runtime.readOne(rootScope, 'selectedClip')
```

### Шаг 2: Обновить return / render logic

**Было:**
```typescript
if (!selectedClipScope) {
    // some fallback UI
    return <div>Fallback view</div>
}

return (
    <div>
        <ClipName name={runtime.readOne(selectedClipScope, 'name')} />
        {/* ... */}
    </div>
)
```

**Стало:**
```typescript
if (!selectedClipScope) {
    return <div className="empty-state">No clip selected</div>
}

return (
    <div>
        <ClipName name={runtime.readOne(selectedClipScope, 'name')} />
        {/* ... */}
    </div>
)
```

### Шаг 3: Удалить unused imports/locals

Если `selectedClipSourceId` prop больше не используется:
```typescript
// Удалить из props
export interface InspectorProps {
    // selectedClipSourceId?: string  // ← УДАЛИТЬ
}
```

### Шаг 4: Run tests

```bash
npm run test:video-editor -- Inspector
```

Должны пройти все тесты (если есть).

## Валидация

```bash
# Проверка: нет fallback traversal
grep -n "fallbackSelectedClipScope\|for (const trackScope" src/video-editor/components/Inspector.tsx
# Результат: ничего (если clean) или show line numbers if exists

# Проверка: selectedClip rel читается один раз
grep -n "readOne.*selectedClip\|readOne(.*'selectedClip'" src/video-editor/components/Inspector.tsx
# Результат: только one line
```

## Документация

После merge:
- [ ] Обновить комментарий в SessionRoot.ts: "selectedClip rel is authoritative source for selected clip scope"
- [ ] Удалить любые doc comments о fallback search в Inspector

---

# P0-2: Явный delivery контракт для экспорта (minimal version)

⚠️ **Этот пункт уже полностью описан в [EXPORT_DELIVERY_KONTRACT.md](EXPORT_DELIVERY_KONTRACT.md)**

**Кратко:**

### Было (current fire-and-forget)
```
action requestProjectExport
  → $fx_requestExport
    → runtime.requestExport(payload)
      → transport.send(EXPORT_REQUEST)
        → [FIRE-AND-FORGET, no ACK]
        → PAGE: export progress updates
        
⚠️ If transport breaks: worker state = pending, page UI = frozen
```

### Стало (clear on disconnect)
```
action requestProjectExport
  → $fx_requestExport
    → runtime.requestExport(payload)
      → transport.send(EXPORT_REQUEST)
        → PAGE: export progress updates
        
transport.onDisconnect()
  → dispatch('clearExportProgress')
    → SessionRoot.exportProgress = null
    → SYNC to page
    → PAGE: UI clears
    
✅ Explicit: no hanging state
```

### Реализация

Смотри полный документ: [EXPORT_DELIVERY_KONTRACT.md](EXPORT_DELIVERY_KONTRACT.md) (Шаги 1-6, ~90 строк кода).

**Summary of changes:**
- Add `clearExportProgress` action to SessionRoot
- Add `clearExportProgressInAllSessions()` helper in worker runtime
- Subscribe to `transport.onDisconnect()` and dispatch action
- Type updates + validation

---

# P1-1: Выпилить legacy requestClipExport interface hook

## Текущее состояние (Было)

**Файл:** `src/video-editor/dkt/runtime/createMiniCutDktRuntime.ts`

```typescript
// ~L137
const requestClipExport = (payload: unknown) => {
    void dispatchScopedAction('requestClipExport', payload, null)
}

// Export interface
interfaces.registerInterface('#exportRuntime', {
    requestExport: publishExportRequest,
    requestClipExport: requestClipExport,  // ← LEGACY HOOK
})
```

### Проблемы

1. **Dual path** — три root actions (`requestProjectExport`, `requestClipExport`, `requestSelectedClipExport`) но `requestClipExport` также доступен как interface hook
2. **Unnecessary API surface** — interface hooks должны быть для IO/async, не для domain actions
3. **Hidden call site** — если есть старый код где-то вызывающий `runtime.requestClipExport()`, он не явный в code search
4. **Type confusion** — отличие между `requestExport` (effect output) и `requestClipExport` (domain action via interface) не ясно

## Целевое состояние (Стало)

```typescript
// Удалить requestClipExport hook полностью
// Только оставить requestExport для out-effect

interfaces.registerInterface('#exportRuntime', {
    requestExport: publishExportRequest,
    // requestClipExport: УДАЛЁН
})

// Если кому-то нужен clip export:
// → dispatchRoot('requestClipExportById', { clipId, ... })
//   или
// → dispatchSelectedClip('requestClipExport', { ... })
```

## Flow: Был vs Стал

### ДО (dual path)

```
UI / test
  │
  ├─ path 1: dispatchRoot('requestProjectExport', {})
  │              ↓
  │         SessionRoot action
  │              ↓
  │         → $fx_requestExport
  │              ↓
  │         runtime.requestExport(payload)
  │
  ├─ path 2: dispatchRoot('requestClipExportById', {clipId})
  │              ↓
  │         SessionRoot action (if exists)
  │              ↓
  │         → $fx_requestExport
  │              ↓
  │         runtime.requestExport(payload)
  │
  └─ path 3 (LEGACY): runtime.requestClipExport(payload)
                 ↓
            dispatchScopedAction('requestClipExport', ...)
                 ↓
            Clip model action
                 ↓
            ???
```

### ПОСЛЕ (single path)

```
UI / test
  │
  ├─ path 1: dispatchRoot('requestProjectExport', {})
  │              ↓
  │         SessionRoot action
  │              ↓
  │         → $fx_requestExport
  │              ↓
  │         runtime.requestExport(payload)
  │
  └─ path 2: dispatchRoot('requestClipExportById', {clipId})
                 ↓
            SessionRoot action (explicit by-id)
                 ↓
            multi-step: resolve clip scope from id
                 ↓
            → $fx_requestExport
                 ↓
            runtime.requestExport(payload)

✅ Single out-effect, clear paths
```

## Step-by-Step изменения

### Шаг 1: Search for call sites

```bash
# Найти где requestClipExport используется
grep -rn "requestClipExport" src/ test/ --include="*.ts" --include="*.tsx"

# Результаты: смотреть все matches
```

**Ожидаемые результаты:**
- Может быть старый тест
- Может быть старый комментарий
- Возможно, ничего (код мертв)

### Шаг 2: Если есть call sites — создать root action вместо

**Пример:** если где-то вызывается `runtime.requestClipExport({clipId: 'abc', ...})`

**Было:**
```typescript
runtime.requestClipExport({clipId: 'abc', format: 'mp4'})
```

**Стало:**
```typescript
dktPort.dispatch('requestClipExportById', {
    clipId: 'abc',
    format: 'mp4',
    initiatedBy: 'user',
})
```

**Добавить action в SessionRoot:**
```typescript
requestClipExportById: [
    {
        when_deps: ['<< @all:sourceClipId < activeProject.tracks.clips'],
        when_fn: (clips, payload) => {
            const clipId = (payload as { clipId?: string } | null)?.clipId
            return Array.isArray(clips) && clips.some(c => c === clipId)
        },
        fn: (payload) => ({
            exportRequest: {
                id: generateId(),
                range: 'clip',
                clipId: (payload as any).clipId,
                format: (payload as any).format,
            },
        }),
    },
    {
        to: ['$fx_requestExport', { intent: 'call', drop_when_api_not_ready: false }],
        fn: () => '$noop',
    },
]
```

### Шаг 3: Удалить hook из runtime

**Файл:** `src/video-editor/dkt/runtime/createMiniCutDktRuntime.ts`

**Было:**
```typescript
const requestClipExport = (payload: unknown) => {
    void dispatchScopedAction('requestClipExport', payload, null)
}

// Line ~L160
interfaces.registerInterface('#exportRuntime', {
    requestExport: publishExportRequest,
    requestClipExport: requestClipExport,
})
```

**Стало:**
```typescript
// requestClipExport function: УДАЛИТЬ

// Line ~L160
interfaces.registerInterface('#exportRuntime', {
    requestExport: publishExportRequest,
    // requestClipExport: УДАЛЁН
})
```

### Шаг 4: Удалить из type exports

**Файл:** `src/video-editor/dkt/runtime/...` (export type)

**Если есть:**
```typescript
export interface ExportRuntime {
    requestExport: (payload: unknown) => void
    requestClipExport?: (payload: unknown) => void  // ← УДАЛИТЬ
}
```

**Стало:**
```typescript
export interface ExportRuntime {
    requestExport: (payload: unknown) => void
    // requestClipExport: УДАЛЁН
}
```

### Шаг 5: Удалить dead code из Clip model (если есть)

**Файл:** `src/video-editor/models/Clip.ts`

Если Clip содержит `requestClipExport` action (мертвая), удалить:

```typescript
// lines ~523-558
requestClipExport: [
    // ... УДАЛИТЬ ВЕСЬ БЛОК
]
```

### Шаг 6: Tests

```bash
npm run test:video-editor -- export
npm run tsc --noEmit
```

## Валидация

```bash
# Проверка: requestClipExport удален из interfaces
grep -n "requestClipExport" src/video-editor/dkt/runtime/createMiniCutDktRuntime.ts
# Результат: ничего или только в comments

# Проверка: нет call sites (или только в migration commits)
grep -rn "\.requestClipExport\(" src/ test/ --include="*.ts" --include="*.tsx"
# Результат: ничего (clean) или только в tests that we're keeping
```

---

# P1-2: Упростить subscribeToResourceScopes до события

## Текущее состояние (Было)

**Файл:** `src/video-editor/app/createVideoEditorHarness.ts`

```typescript
// ~L365-390
const subscribeToResourceScopes = () => {
    const handleResourceScopes = (scopes: unknown) => {
        // subscribe to resource lifecycle
    }

    // ⚠️ PROBLEM: startup retry with setTimeout
    const startupRetryTimeout = setTimeout(() => {
        const activeProjectScope = runtime.readOne(rootScope, 'activeProject')
        if (activeProjectScope) {
            const resourceScopes = runtime.readMany(activeProjectScope, 'resources')
            handleResourceScopes(resourceScopes)
        }
    }, 500)  // Wait 500ms for init

    // ⚠️ PROBLEM: setInterval for periodic sync
    const refreshResourceInterval = setInterval(() => {
        const activeProjectScope = runtime.readOne(rootScope, 'activeProject')
        if (activeProjectScope) {
            const resourceScopes = runtime.readMany(activeProjectScope, 'resources')
            handleResourceScopes(resourceScopes)
        }
    }, 2000)  // Poll every 2s

    // ⚠️ PROBLEM: subscribe to rel but only use fallback
    const unsubscribeActiveProject = runtime.subscribeOne(
        rootScope,
        'activeProject',
        (activeProjectScope) => {
            handleResourceScopes(runtime.readMany(activeProjectScope, 'resources'))
        }
    ) ?? EMPTY_CLEANUP

    return () => {
        clearTimeout(startupRetryTimeout)
        clearInterval(refreshResourceInterval)
        unsubscribeActiveProject()
    }
}
```

### Проблемы

1. **setTimeout retry** — временная связь, хрупкая (могла завершиться раньше, могла позже)
2. **setInterval polling** — 2 сек непрерывно, нагрузка + задержка
3. **Fallback traversal** — ручное readMany вместо declarative rel
4. **Mixed strategies** — одновременно subscribe + setTimeout + setInterval = confusion

## Целевое состояние (Стало)

```typescript
// Pure event-driven
const subscribeToResourceScopes = () => {
    // Subscribe ONLY to activeProject rel change
    const unsubscribeActiveProject = runtime.subscribeOne(
        rootScope,
        'activeProject',
        (activeProjectScope) => {
            if (!activeProjectScope) return
            
            // On activeProject change → subscribe to its resources rel
            handleResourceScopes(runtime.readMany(activeProjectScope, 'resources'))
        }
    ) ?? EMPTY_CLEANUP

    // If activeProject already exists → init immediately
    const activeProjectScope = runtime.readOne(rootScope, 'activeProject')
    if (activeProjectScope) {
        handleResourceScopes(runtime.readMany(activeProjectScope, 'resources'))
    }

    return () => {
        unsubscribeActiveProject()
    }
}
```

### Принцип

- **No timers** — events only
- **Declarative** — rel changes trigger updates
- **Immediate initialization** — no delay, check current state first then subscribe

## Flow: Был vs Стал

### ДО (with retry and polling)

```
App startup
    │
    ├─ setTimeout 500ms
    │      ↓
    │  readOne(root, 'activeProject')  ← MIGHT NOT EXIST YET
    │      ↓
    │  [if exists] handleResourceScopes()
    │
    └─ setInterval every 2s
           ↓
       readMany(resources)
           ↓
       handleResourceScopes()  ← REDUNDANT, might be same data
    
    + subscribeOne('activeProject')
           ↓
       handleResourceScopes()  ← WORKS, but lost race with timeout

⚠️ PROBLEM: race condition, wasted polling, delay
```

### ПОСЛЕ (pure event)

```
App startup
    │
    ├─ Check current state
    │      ↓
    │  readOne(root, 'activeProject')
    │      ↓
    │  [if exists] handleResourceScopes() ← IMMEDIATE
    │
    └─ Subscribe to rel change
           ↓
       activeProject changes
           ↓
       readMany(resources) ONCE  ← ON CHANGE ONLY
           ↓
       handleResourceScopes()

✅ Clean: immediate + event-driven
```

## Step-by-Step изменения

### Шаг 1: Удалить setTimeout/setInterval

**Файл:** `src/video-editor/app/createVideoEditorHarness.ts`

**Было:**
```typescript
const subscribeToResourceScopes = () => {
    const handleResourceScopes = (scopes: unknown) => {
        // ...
    }

    const startupRetryTimeout = setTimeout(() => {
        const activeProjectScope = runtime.readOne(rootScope, 'activeProject')
        if (activeProjectScope) {
            const resourceScopes = runtime.readMany(activeProjectScope, 'resources')
            handleResourceScopes(resourceScopes)
        }
    }, 500)

    const refreshResourceInterval = setInterval(() => {
        const activeProjectScope = runtime.readOne(rootScope, 'activeProject')
        if (activeProjectScope) {
            const resourceScopes = runtime.readMany(activeProjectScope, 'resources')
            handleResourceScopes(resourceScopes)
        }
    }, 2000)

    const unsubscribeActiveProject = runtime.subscribeOne(
        rootScope,
        'activeProject',
        (activeProjectScope) => {
            handleResourceScopes(runtime.readMany(activeProjectScope, 'resources'))
        }
    ) ?? EMPTY_CLEANUP

    return () => {
        clearTimeout(startupRetryTimeout)
        clearInterval(refreshResourceInterval)
        unsubscribeActiveProject()
    }
}
```

**Стало:**
```typescript
const subscribeToResourceScopes = () => {
    const handleResourceScopes = (scopes: unknown) => {
        // ...
    }

    // Initialize from current state immediately
    const activeProjectScope = runtime.readOne(rootScope, 'activeProject')
    if (activeProjectScope) {
        const resourceScopes = runtime.readMany(activeProjectScope, 'resources')
        handleResourceScopes(resourceScopes)
    }

    // Subscribe to future changes
    const unsubscribeActiveProject = runtime.subscribeOne(
        rootScope,
        'activeProject',
        (activeProjectScope) => {
            if (!activeProjectScope) return
            const resourceScopes = runtime.readMany(activeProjectScope, 'resources')
            handleResourceScopes(resourceScopes)
        }
    ) ?? EMPTY_CLEANUP

    return () => {
        unsubscribeActiveProject()
    }
}
```

### Шаг 2: Проверить handleResourceScopes logic

Убедиться что `handleResourceScopes` работает правильно с `null`:

**Было:**
```typescript
const handleResourceScopes = (scopes: unknown) => {
    const resourceScopes = Array.isArray(scopes) ? scopes : []
    for (const scope of resourceScopes) {
        // ...
    }
}
```

**Стало (if needed):**
```typescript
const handleResourceScopes = (scopes: unknown) => {
    if (!scopes) return  // Early exit if no scopes
    const resourceScopes = Array.isArray(scopes) ? scopes : []
    for (const scope of resourceScopes) {
        // ...
    }
}
```

### Шаг 3: Run tests

```bash
npm run test:video-editor -- resource
npm run repl:run
```

Убедиться что resources синхронизируются сразу при создании проекта (без delay).

## Валидация

```bash
# Проверка: нет setTimeout в subscribeToResourceScopes
grep -n "setTimeout\|setInterval" src/video-editor/app/createVideoEditorHarness.ts | grep -i resource
# Результат: ничего (или другие timers, не resource-related)

# Проверка: subscribeOne используется
grep -n "subscribeOne.*activeProject" src/video-editor/app/createVideoEditorHarness.ts
# Результат: one line with pure event subscribe
```

---

# P2-1: Изолировать debug graph traversal

## Текущее состояние (Было)

**Файл:** `src/video-editor/app/VideoEditorHarnessApp.tsx`

```typescript
// ~L180-250 (debug методы)
const dispatchCreateProject = async () => {
    // Polling loop for debug
    let attempts = 0
    while (attempts < 100) {
        const root = runtime.readOne(undefined, '@root')
        const state = runtime.readAttrs(root, '*')
        if (state?.activeProjectId) {
            console.log('Project created:', state.activeProjectId)
            break
        }
        await new Promise(resolve => setTimeout(resolve, 50))
        attempts++
    }
}

const debugDumpGraph = (nodeId?: string) => {
    const node = nodeId ? runtime.readOne(undefined, nodeId) : runtime.readOne(undefined, '@root')
    const attrs = runtime.readAttrs(node, '*')
    const rels = runtime.readAttrs(node, '<<')
    console.log('DEBUG DUMP:', { nodeId, attrs, rels })
}

const debugSelectClip = () => {
    // Manual traversal to find clip
    const root = runtime.readOne(undefined, '@root')
    const project = runtime.readOne(root, 'activeProject')
    const tracks = runtime.readMany(project, 'tracks')
    // ... nested loops ...
}

// These live in component production tree 
// mixed with actual harness wiring
```

### Проблемы

1. **Mixed concerns** — debug методы в production component
2. **Polling loops** — setTimeout in debug function leaks into component lifecycle
3. **Imperative traversal** — manual graph searches for testing purposes
4. **Not testable** — код который должен быть в тестах живет в production

## Целевое состояние (Стало)

```typescript
// VideoEditorHarnessApp.tsx — PRODUCTION ONLY
export const VideoEditorHarnessApp = (props) => {
    // Only harness wiring, no debug
    return (
        <div>
            <Toolbar actions={actions} />
            <Timeline />
            <Inspector />
        </div>
    )
}

// test/harness/harness.testing.ts — DEBUG HELPERS ONLY
export const createTestingHarness = (runtime) => ({
    waitForProjectCreation: async (timeoutMs = 5000) => {
        // Event-based waiter, not polling
    },
    
    dumpGraph: (nodeId?: string) => {
        // Debug dump
    },
    
    findClipBySourceId: (sourceId: string) => {
        // Traversal for testing only
    },
})
```

## Flow: Был vs Стал

### ДО (debug in production)

```
src/video-editor/app/VideoEditorHarnessApp.tsx (production file)
    │
    ├─ Production wiring
    │   ├─ <Toolbar />
    │   ├─ <Timeline />
    │   └─ <Inspector />
    │
    └─ 🔴 Debug functions (60+ lines)
        ├─ dispatchCreateProject() — polling loop
        ├─ debugDumpGraph() — manual traversal
        ├─ debugSelectClip() — nested loops
        └─ ...

⚠️ PROBLEM: 40-50% of file is debug code
```

### ПОСЛЕ (clean separation)

```
src/video-editor/app/VideoEditorHarnessApp.tsx (production ONLY)
    │
    └─ Production wiring
        ├─ <Toolbar />
        ├─ <Timeline />
        └─ <Inspector />
    (30 lines, clean)

test/harness/harness.testing.ts (testing file)
    │
    └─ 🟢 Debug helpers
        ├─ createTestingHarness()
        ├─ waitForProjectCreation() — event-based
        ├─ dumpGraph() — traversal
        └─ ...
    (60+ lines, test-only)

✅ Clean: production file ~30 lines, tests ~60 lines
```

## Step-by-Step изменения

### Шаг 1: Создать testing harness helper file

**Файл:** `test/harness/harness.testing.ts` (новый)

```typescript
/**
 * Testing helpers for harness debugging and waits.
 * NOT FOR PRODUCTION USE.
 */

import type { PageSyncRuntime } from '../../src/video-editor/dkt/runtime/createMiniCutPageSyncRuntime'

export interface TestingHarness {
    waitForProjectCreation: (timeoutMs?: number) => Promise<string | null>
    dumpGraph: (nodeId?: string) => unknown
    findClipBySourceId: (sourceId: string) => unknown
}

export const createTestingHarness = (runtime: PageSyncRuntime): TestingHarness => {
    return {
        // Event-based wait instead of polling loop
        waitForProjectCreation: async (timeoutMs = 5000) => {
            return new Promise((resolve) => {
                const timeout = setTimeout(() => resolve(null), timeoutMs)
                
                const unsubscribe = runtime.subscribeRootAttrs(['activeProjectId'], (activeProjectId) => {
                    if (activeProjectId) {
                        clearTimeout(timeout)
                        unsubscribe()
                        resolve(activeProjectId as string)
                    }
                }) ?? (() => {})
                
                // Check current state immediately
                const currentProjectId = runtime.readAttrs?.(
                    runtime.readOne?.(undefined, '@root'),
                    ['activeProjectId']
                )?.activeProjectId
                if (currentProjectId) {
                    clearTimeout(timeout)
                    unsubscribe()
                    resolve(currentProjectId as string)
                }
            })
        },
        
        // Debug dump (production code should not call this)
        dumpGraph: (nodeId?: string) => {
            const node = nodeId 
                ? runtime.readOne?.(undefined, nodeId) 
                : runtime.readOne?.(undefined, '@root')
            const attrs = runtime.readAttrs?.(node, '*')
            const rels = runtime.readAttrs?.(node, '<<')
            return { nodeId, attrs, rels }
        },
        
        // Manual traversal for testing
        findClipBySourceId: (sourceId: string) => {
            const root = runtime.readOne?.(undefined, '@root')
            const project = runtime.readOne?.(root, 'activeProject')
            if (!project) return null
            
            const tracks = runtime.readMany?.(project, 'tracks') || []
            for (const track of tracks) {
                const clips = runtime.readMany?.(track, 'clips') || []
                for (const clip of clips) {
                    const id = runtime.readOne?.(clip, 'sourceClipId')
                    if (id === sourceId) return clip
                }
            }
            return null
        },
    }
}
```

### Шаг 2: Удалить debug функции из VideoEditorHarnessApp

**Файл:** `src/video-editor/app/VideoEditorHarnessApp.tsx`

**Было:**
```typescript
// Lines 180-250: debug functions
const dispatchCreateProject = async () => { ... }
const debugDumpGraph = (nodeId?: string) => { ... }
const debugSelectClip = () => { ... }

export const VideoEditorHarnessApp = () => {
    // component
}
```

**Стало:**
```typescript
export const VideoEditorHarnessApp = () => {
    // ONLY production wiring, no debug
    return (
        <div>
            <Toolbar actions={actions} />
            <Timeline />
            <Inspector />
        </div>
    )
}
```

### Шаг 3: Экспортировать testing harness для tests

**Файл:** `test/harness/index.ts` (новый или обновить)

```typescript
export { createTestingHarness, type TestingHarness } from './harness.testing'
```

### Шаг 4: Обновить старые tests использовать новый helper

**Файл:** `test/video-editor/harness.test.ts` (пример)

**Было:**
```typescript
import { VideoEditorHarnessApp } from '../../src/video-editor/app/VideoEditorHarnessApp'

describe('harness debug', () => {
    it('should create project', async () => {
        const { dispatchCreateProject } = VideoEditorHarnessApp
        await dispatchCreateProject()
        // ...
    })
})
```

**Стало:**
```typescript
import { createTestingHarness } from '../harness/harness.testing'

describe('harness', () => {
    it('should create project', async () => {
        const testingHarness = createTestingHarness(runtime)
        const projectId = await testingHarness.waitForProjectCreation()
        expect(projectId).toBeTruthy()
    })
})
```

### Шаг 5: Run tests

```bash
npm run test:video-editor
npm run tsc --noEmit
```

## Валидация

```bash
# Проверка: нет debug функций в VideoEditorHarnessApp
grep -n "dispatchCreateProject\|debugDumpGraph\|debugSelectClip" src/video-editor/app/VideoEditorHarnessApp.tsx
# Результат: ничего

# Проверка: testing helpers exist
ls -la test/harness/harness.testing.ts
# Результат: file exists

# Проверка: no setTimeout in production component
grep -n "setTimeout" src/video-editor/app/VideoEditorHarnessApp.tsx
# Результат: ничего
```

---

# P2-2: Event/subscription completion helpers вместо setTimeout

## Текущее состояние (Было)

**Файлы:** различные test файлы

```typescript
// Test 1: polling with setTimeout
describe('export', () => {
    it('should complete export', async () => {
        actions.requestProjectExport({...})
        
        // Wait for completion (ugh)
        await new Promise(resolve => setTimeout(resolve, 1000))
        
        const cachedUrl = actions.getCachedExportUrl(exportId)
        expect(cachedUrl).toBeTruthy()
    })
})

// Test 2: busy-wait loop
describe('resource import', () => {
    it('should import resource', async () => {
        actions.importFiles([file])
        
        // Polling loop
        let attempts = 0
        while (!resourceImported && attempts < 50) {
            await new Promise(resolve => setTimeout(resolve, 100))
            const resources = runtime.readMany(project, 'resources')
            resourceImported = resources.length > 0
            attempts++
        }
        
        expect(resourceImported).toBe(true)
    })
})

// Test 3: manual state check
describe('project creation', () => {
    it('should create project', async () => {
        actions.createProject({...})
        
        // Manual polling
        let project = null
        for (let i = 0; i < 100; i++) {
            const root = runtime.readOne(undefined, '@root')
            project = runtime.readOne(root, 'activeProject')
            if (project) break
            await new Promise(resolve => setTimeout(resolve, 50))
        }
        
        expect(project).toBeTruthy()
    })
})
```

### Проблемы

1. **Flaky tests** — sleep times arbitrary (1000ms? 100ms? 50ms?)
2. **Slow tests** — even if action completes in 10ms, test waits full timeout
3. **Race conditions** — action might complete between loop iterations
4. **Not explicit** — test doesn't express what it's waiting for

## Целевое состояние (Стало)

```typescript
// Event-based completions

export const waitForExportCompletion = (runtime, exportId, timeoutMs = 5000) => {
    return new Promise<boolean>((resolve) => {
        const timeout = setTimeout(() => resolve(false), timeoutMs)
        
        // Subscribe to export progress changes
        const unsubscribe = runtime.subscribeRootAttrs(['exportProgress'], (progress) => {
            if (progress?.stage === 'done' && progress?.id === exportId) {
                clearTimeout(timeout)
                unsubscribe()
                resolve(true)
            }
        }) ?? (() => {})
    })
}

export const waitForResourceImport = (runtime, projectNodeId, initialCount = 0, timeoutMs = 5000) => {
    return new Promise<boolean>((resolve) => {
        const timeout = setTimeout(() => resolve(false), timeoutMs)
        
        // Subscribe to resources rel change
        const unsubscribe = runtime.subscribeMany(projectNodeId, 'resources', (resources) => {
            if (Array.isArray(resources) && resources.length > initialCount) {
                clearTimeout(timeout)
                unsubscribe()
                resolve(true)
            }
        }) ?? (() => {})
    })
}

export const waitForProjectCreation = (runtime, timeoutMs = 5000) => {
    return new Promise<boolean>((resolve) => {
        const timeout = setTimeout(() => resolve(false), timeoutMs)
        
        // Subscribe to activeProject rel
        const unsubscribe = runtime.subscribeOne(
            runtime.readOne(undefined, '@root'),
            'activeProject',
            (project) => {
                if (project) {
                    clearTimeout(timeout)
                    unsubscribe()
                    resolve(true)
                }
            }
        ) ?? (() => {})
        
        // Check current state
        const root = runtime.readOne(undefined, '@root')
        const activeProject = runtime.readOne(root, 'activeProject')
        if (activeProject) {
            clearTimeout(timeout)
            unsubscribe()
            resolve(true)
        }
    })
}
```

## Flow: Был vs Стал

### ДО (setTimeout polling)

```
Test: export
    │
    ├─ actions.requestProjectExport()
    │      ↓
    │   [dispatch sent]
    │
    └─ setTimeout 1000ms
           ↓
       [sleep 1000ms — even if done in 10ms!]
           ↓
       getCachedExportUrl(id)
           ↓
       expect()

⚠️ PROBLEM: slow, arbitrary timeout, flaky
```

### ПОСЛЕ (event-driven)

```
Test: export
    │
    ├─ actions.requestProjectExport()
    │      ↓
    │   [dispatch sent]
    │
    ├─ waitForExportCompletion(exportId)
    │      │
    │      ├─ Subscribe to exportProgress changes
    │      │
    │      └─ When exportProgress.stage === 'done'
    │             ↓
    │          [resolve immediately, no sleep]
    │
    ▼  getCachedExportUrl(id)
       │
       ▼  expect()

✅ FAST: completes as soon as event fires, no arbitrary sleep
```

## Step-by-Step изменения

### Шаг 1: Создать test/helpers/completion.testing.ts

**Файл:** `test/helpers/completion.testing.ts` (новый)

```typescript
/**
 * Event-based completion helpers for tests.
 * Use these instead of setTimeout/polling loops.
 */

import type { PageSyncRuntime } from '../../src/video-editor/dkt/runtime/createMiniCutPageSyncRuntime'

/**
 * Wait for export to complete.
 */
export const waitForExportCompletion = (
    runtime: PageSyncRuntime,
    exportId: string,
    timeoutMs: number = 5000
): Promise<boolean> => {
    return new Promise<boolean>((resolve) => {
        const timeout = setTimeout(() => {
            unsubscribe()
            resolve(false)
        }, timeoutMs)
        
        const unsubscribe = runtime.subscribeRootAttrs?.(
            ['exportProgress'],
            (progress: any) => {
                if (progress?.stage === 'done' && progress?.id === exportId) {
                    clearTimeout(timeout)
                    unsubscribe()
                    resolve(true)
                }
            }
        ) ?? (() => {})
    })
}

/**
 * Wait for resource to be imported (rel grows).
 */
export const waitForResourceImport = (
    runtime: PageSyncRuntime,
    projectNodeId: unknown,
    minResourceCount: number = 1,
    timeoutMs: number = 5000
): Promise<boolean> => {
    return new Promise<boolean>((resolve) => {
        const timeout = setTimeout(() => {
            unsubscribe()
            resolve(false)
        }, timeoutMs)
        
        const unsubscribe = runtime.subscribeMany?.(
            projectNodeId,
            'resources',
            (resources: any[]) => {
                if (Array.isArray(resources) && resources.length >= minResourceCount) {
                    clearTimeout(timeout)
                    unsubscribe()
                    resolve(true)
                }
            }
        ) ?? (() => {})
        
        // Check current state
        const currentResources = runtime.readMany?.(projectNodeId, 'resources') || []
        if (currentResources.length >= minResourceCount) {
            clearTimeout(timeout)
            unsubscribe()
            resolve(true)
        }
    })
}

/**
 * Wait for project creation.
 */
export const waitForProjectCreation = (
    runtime: PageSyncRuntime,
    timeoutMs: number = 5000
): Promise<boolean> => {
    return new Promise<boolean>((resolve) => {
        const timeout = setTimeout(() => {
            unsubscribe()
            resolve(false)
        }, timeoutMs)
        
        const root = runtime.readOne?.(undefined, '@root')
        if (!root) {
            clearTimeout(timeout)
            resolve(false)
            return
        }
        
        const unsubscribe = runtime.subscribeOne?.(
            root,
            'activeProject',
            (project: unknown) => {
                if (project) {
                    clearTimeout(timeout)
                    unsubscribe()
                    resolve(true)
                }
            }
        ) ?? (() => {})
        
        // Check current state
        const activeProject = runtime.readOne?.(root, 'activeProject')
        if (activeProject) {
            clearTimeout(timeout)
            unsubscribe()
            resolve(true)
        }
    })
}

/**
 * Wait for clip selection.
 */
export const waitForClipSelection = (
    runtime: PageSyncRuntime,
    expectedSourceClipId: string,
    timeoutMs: number = 5000
): Promise<boolean> => {
    return new Promise<boolean>((resolve) => {
        const timeout = setTimeout(() => {
            unsubscribe()
            resolve(false)
        }, timeoutMs)
        
        const root = runtime.readOne?.(undefined, '@root')
        if (!root) {
            clearTimeout(timeout)
            resolve(false)
            return
        }
        
        const unsubscribe = runtime.subscribeOne?.(
            root,
            'selectedClip',
            (clipScope: unknown) => {
                if (clipScope) {
                    const sourceClipId = runtime.readOne?.(clipScope, 'sourceClipId')
                    if (sourceClipId === expectedSourceClipId) {
                        clearTimeout(timeout)
                        unsubscribe()
                        resolve(true)
                    }
                }
            }
        ) ?? (() => {})
        
        // Check current state
        const selectedClip = runtime.readOne?.(root, 'selectedClip')
        if (selectedClip) {
            const sourceClipId = runtime.readOne?.(selectedClip, 'sourceClipId')
            if (sourceClipId === expectedSourceClipId) {
                clearTimeout(timeout)
                unsubscribe()
                resolve(true)
            }
        }
    })
}
```

### Шаг 2: Обновить существующие tests

**Пример 1: Export test**

**Было:**
```typescript
it('should complete export', async () => {
    actions.requestProjectExport({...})
    
    await new Promise(resolve => setTimeout(resolve, 1000))
    
    const cachedUrl = actions.getCachedExportUrl(exportId)
    expect(cachedUrl).toBeTruthy()
})
```

**Стало:**
```typescript
import { waitForExportCompletion } from '../helpers/completion.testing'

it('should complete export', async () => {
    actions.requestProjectExport({...})
    
    const completed = await waitForExportCompletion(runtime, exportId, 5000)
    expect(completed).toBe(true)
    
    const cachedUrl = actions.getCachedExportUrl(exportId)
    expect(cachedUrl).toBeTruthy()
})
```

**Пример 2: Resource import test**

**Было:**
```typescript
it('should import resource', async () => {
    const initialResources = runtime.readMany(project, 'resources')
    const initialCount = Array.isArray(initialResources) ? initialResources.length : 0
    
    actions.importFiles([file])
    
    let attempts = 0
    while (attempts < 50) {
        const resources = runtime.readMany(project, 'resources')
        if (resources.length > initialCount) break
        await new Promise(resolve => setTimeout(resolve, 100))
        attempts++
    }
    
    const resources = runtime.readMany(project, 'resources')
    expect(resources.length).toBeGreaterThan(initialCount)
})
```

**Стало:**
```typescript
import { waitForResourceImport } from '../helpers/completion.testing'

it('should import resource', async () => {
    const initialResources = runtime.readMany(project, 'resources')
    const initialCount = Array.isArray(initialResources) ? initialResources.length : 0
    
    actions.importFiles([file])
    
    const imported = await waitForResourceImport(runtime, project, initialCount + 1, 5000)
    expect(imported).toBe(true)
})
```

**Пример 3: Project creation test**

**Было:**
```typescript
it('should create project', async () => {
    actions.createProject({...})
    
    let project = null
    for (let i = 0; i < 100; i++) {
        const root = runtime.readOne(undefined, '@root')
        project = runtime.readOne(root, 'activeProject')
        if (project) break
        await new Promise(resolve => setTimeout(resolve, 50))
    }
    
    expect(project).toBeTruthy()
})
```

**Стало:**
```typescript
import { waitForProjectCreation } from '../helpers/completion.testing'

it('should create project', async () => {
    actions.createProject({...})
    
    const created = await waitForProjectCreation(runtime, 5000)
    expect(created).toBe(true)
    
    const root = runtime.readOne(undefined, '@root')
    const project = runtime.readOne(root, 'activeProject')
    expect(project).toBeTruthy()
})
```

### Шаг 3: Search and replace all test files

```bash
# Find all setTimeout in test files
grep -rn "setTimeout.*resolve\|new Promise.*resolve.*setTimeout" test/ --include="*.ts" --include="*.tsx"

# For each, replace with appropriate completion helper
```

### Шаг 4: Run all tests

```bash
npm run test:video-editor
npm run test:video-editor:playwright
```

Tests should be:
- ✅ Faster (no arbitrary sleeps)
- ✅ More reliable (events instead of timing races)
- ✅ More readable (explicit wait names)

## Валидация

```bash
# Проверка: completion helpers файл существует
ls -la test/helpers/completion.testing.ts
# Результат: file exists

# Проверка: старые setTimeout patterns удалены из tests
grep -rn "new Promise.*setTimeout.*resolve" test/ --include="*.test.ts" --include="*.test.tsx"
# Результат: ничего (или только в completion helpers themselves)

# Проверка: completion helpers используются
grep -rn "waitForExportCompletion\|waitForResourceImport\|waitForProjectCreation" test/ --include="*.test.ts" --include="*.test.tsx"
# Результат: multiple matches (tests using helpers)
```

---

# Итоговый Summary: все 6 пунктов

| Пункт | Файлы | Changes | Complexity | Status |
|-------|-------|---------|-----------|--------|
| **P0-1** | Inspector.tsx | -20 lines (fallback removal) | Very Low | 📋 Ready |
| **P0-2** | SessionRoot.ts, createMiniCutDktRuntime.ts, createVideoEditorHarness.ts | +90 lines (action + handler) | Low | 📋 Ready (see EXPORT_DELIVERY_KONTRACT.md) |
| **P1-1** | SessionRoot/actions.ts, createMiniCutDktRuntime.ts, Clip.ts | -50 lines (dead code) | Low | 📋 Ready |
| **P1-2** | createVideoEditorHarness.ts | -30 lines (timers removed) | Very Low | 📋 Ready |
| **P2-1** | VideoEditorHarnessApp.tsx, test/harness/harness.testing.ts | -60 lines (prod), +60 lines (test) | Low | 📋 Ready |
| **P2-2** | test/helpers/completion.testing.ts, all test files | +80 lines (helpers), -150 lines (old polls) | Low | 📋 Ready |
| **Total** | ~12 files | -270 lines + 230 lines = -40 lines | Low | ✅ Implementable |

## Rollout Sequence

1. **P0-1** first (smallest, lowest risk) → Inspector cleanup
2. **P0-2** next (foundation for reliable export) → Add export kontract
3. **P1-1** and **P1-2** in parallel → Simplify resource sync, remove legacy export hook
4. **P2-1** → Isolate debug code
5. **P2-2** last (test infra cleanup) → Replace setTimeout with event helpers

---

# Приложение: Ссылки на документы

- [EXPORT_DELIVERY_KONTRACT.md](EXPORT_DELIVERY_KONTRACT.md) — P0-2 detailed spec
- [phase3-export-cleanup-plan-2026-05-09-ru.md](docs/phase3-export-cleanup-plan-2026-05-09-ru.md) — Export model cleanup
- [dkt-editorHarnessAdapter-pure-migration-plan-2026-05-08-ru.md](docs/dkt-editorHarnessAdapter-pure-migration-plan-2026-05-08-ru.md) — Full adapter audit

