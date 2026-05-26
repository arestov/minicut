# Откуда UI берет clipId? (Практический UX-кейс)

## Краткий ответ

**UI знает `clipId` (он же `sourceClipId`) потому что это атрибут объекта Clip в DKT runtime state.**

Когда пользователь видит клип на timeline - это не просто DOM элемент, это React компонент (`ClipItem`) который:
1. Рендерится **в контексте scope объекта Clip** (через ScopeContext)
2. Читает `sourceClipId` атрибут через `useAttrs()`
3. Использует этот ID для диспатча действий

---

## Полная цепь: From State to UI Actions

### 1️⃣ Clip создается в DKT state

**Когда?** UI создает новый текстовый клип:

```typescript
// editorHarnessAdapter.ts:648-649
addTextClip(content?: string): void {
  const sourceTextId = createSourceId('text')     // Генерируем новый ID
  const sourceClipId = createSourceId('clip')     // ← Генерируем новый ID
  
  dispatchRoot(env, 'addTextClipToTimeline', {
    sourceClipId,      // ← Передаем в DKT
    sourceTextId,
    name: 'Text',
    start: 0,
    duration: 3,
    // ...
  })
}

// Где createSourceId:
const createSourceId = (prefix: string): string => 
  `${prefix}:${Date.now().toString(36)}:${Math.random().toString(36).slice(2, 7)}`
// Результат: "clip:1jh9a8f:abc3d"
```

### 2️⃣ Clip структурируется в Track

**Когда?** DKT action `addTextClipToTimeline` выполняется:

```typescript
// Project.ts - action handleInit
tracks.forEach(track => {
  // Действие попадает на Track с sourceClipId в payload
  track.dispatch('addClip', { 
    sourceClipId: 'clip:1jh9a8f:abc3d',
    name: 'Text',
    start: 0,
    // ...
  })
})

// Track.ts - action addClip (line 79)
addClip: {
  to: {
    clip: ['<< clip << #', { can_create: true }],  // ← Создаем новый Clip объект
    clips: ['<< clips', { method: 'at_end' }],     // ← Добавляем в массив clips
  },
  fn: [
    ['<<<<'],
    (payload: unknown) => {
      const attrs = normalizeClipCreationAttrs(payload)  // ← sourceClipId входит сюда
      return {
        clip: { attrs, rels: { track: self } },   // ← sourceClipId сохраняется как input attr
        clips: { use_ref_id: 'newClip' }
      }
    }
  ]
}
```

### 3️⃣ Clip структура в DKT

**В Clip.ts (line 33):**

```typescript
export const Clip = model({
  model_name: 'minicut_clip',
  attrs: {
    sourceClipId: ['input', null],    // ← Это обычный input field
    sourceResourceId: ['input', null],
    name: ['input', 'Clip'],
    // ... еще 20 атрибутов
  },
  rels: { /* ... */ },
  actions: { /* ... */ }
})
```

### 4️⃣ React component читает из state

**Когда?** Component `ClipItem` рендерится:

```typescript
// ClipItem.tsx (line 50-52)
export const ClipItem = ({ timelineZoom, activeTool, selectedEntityId }: ClipItemProps) => {
  const dispatch = useActions()                      // ← Dispatch на этот Clip scope
  const clipAttrs = useAttrs([
    'sourceClipId',    // ← Читаем это из runtime state
    'name', 'start', 'duration', 'in', 'opacity', 'color'
  ])
  
  const clipId = typeof clipAttrs.sourceClipId === 'string' 
    ? clipAttrs.sourceClipId 
    : null
  
  // ← Теперь у нас есть 'clip:1jh9a8f:abc3d'
```

### 5️⃣ UI dispatcher использует clipId

**Когда?** Пользователь взаимодействует с клипом:

```typescript
// ClipItem.tsx - onclick handler (line 147)
onClick={(event) => {
  if (activeTool === 'split') {
    splitAtPointer(event.clientX, event.currentTarget)
    return
  }
  
  if (activeTool !== 'hand') {
    selectClip()    // ← Используем clipId
  }
}}

const selectClip = (): void => {
  if (clipId) {
    sessionDispatch('selectEntity', clipId)   // ← 'clip:1jh9a8f:abc3d'
  }
}

// Или при перемещении:
const finishPointerDrag = (...) => {
  // ...
  if (state.kind === 'move' && activeTool === 'select') {
    dispatch('moveBy', { delta: deltaSeconds })   // ← Действие на Clip scope
  }
}
```

---

## Почему это закрывает UX-кейс?

### Без `dispatchClipActionById`:

```typescript
// UI видит клип, но как его найти?
const selectClip = (): void => {
  if (clipId) {
    // ❌ Нужно искать clip scope по ID в дереве
    // ❌ Нужно читать activeProject -> tracks -> clips -> найти по sourceClipId
    // ❌ Медленно, сложно, много traversals
    const clipScope = getActiveProjectScope() // ← traverse
      .readMany('tracks')                     // ← traverse
      .flatMap(t => t.readMany('clips'))      // ← traverse
      .find(c => readAttrs(c, ['sourceClipId']).sourceClipId === clipId)
    
    sessionDispatch('selectEntity', clipId)
  }
}
```

### С `dispatchClipActionById`:

```typescript
// UI знает clipId, adapter знает как его найти один раз
renameClipById(clipId: string, name: string): void {
  dispatchClipActionById(env, clipId, 'rename', { name })
}

// adapter делает:
const findClipScopeById = (clipId: string): Scope | null => {
  // ← traverse один раз, найдем scope
  // ← потом все действия диспатчатся на этот scope напрямую
}
```

### Итоговый UX-кейс:

1. **User действие** (click on timeline) → `clipId` из state
2. **Adapter функция** (`renameClipById('clip:xxx', 'New Name')`)
3. **Один traverse** - найти scope по ID
4. **N действий** - все диспатчатся на найденный scope

**Это "закрывает UX-кейс"** потому что:
- ✅ UI имеет идентификатор клипа (из state)
- ✅ Adapter имеет функцию чтобы использовать этот идентификатор
- ✅ Не нужны сложные traversals в UI коде
- ✅ Действия диспатчатся правильно на нужный Clip scope

---

## Альтернативные подходы (почему они сложнее)

### Вариант A: "Всегда использовать selectedClip"

```typescript
// ✅ Работает для выбранного клипа
renameSelectedClip(name: string): void {
  dispatchSelectedClipAction(env, 'rename', { name })
}

// ❌ Не работает если нужно отредактировать НЕ выбранный клип
renameClipById(clipId: string, name: string): void {
  // Что делать если это не selectedClip?
  // Нужны fallback логики
}
```

### Вариант B: "Передавать scope в UI"

```typescript
// ❌ Scope не сериализуется через JSON
// ❌ Scope может стать invalid если структура изменится
// ❌ UI компонент становится привязан к runtime реализации

interface ClipItemProps {
  clipScope: ReactSyncScopeHandle  // ← Тесная связь UI и runtime
}
```

### Вариант C: "Использовать clipId через adapter" ✅ (Текущий подход)

```typescript
// ✅ UI работает с простым string ID
// ✅ Adapter абстрагирует traversal логику
// ✅ UI не нужно знать как устроена структура
// ✅ Легко тестировать (mockить findClipScopeById)

// UI:
renameClipById(clipId, name)

// Adapter:
dispatchClipActionById(env, clipId, 'rename', { name })
```

---

## Как это используется в реальном коде

### Из MediaBin (контекст меню):

```typescript
// User right-click на клип в timeline → контекст меню → "Rename"
<button onClick={() => actions.renameClipById(clipId, newName)}>
  Rename
</button>
```

### Из ClipItem (inline editing):

```typescript
// User double-click на клип → inline editor появляется → User вводит имя
const onNameChange = (name: string) => {
  // clipId доступен в контексте компонента
  actions.renameClipById(clipId, name)
}
```

### Из EditorHarnessAdapter (programmatic):

```typescript
// Например при импорте файла
const sourceClipId = createSourceId('clip')
dispatchTrackClip(env, primaryVideoTrack, {
  sourceClipId,              // ← Мы сами создали ID
  sourceResourceId,
  name: file.name,
  start: 0,
  duration,
})
```

---

## Заключение

**"UI часто знает clipId"** означает:

| Компонент | Где знает | Как использует |
|-----------|-----------|-----------------|
| **ClipItem** | Из `useAttrs()` (читает из state) | `dispatch()` на свой scope |
| **MediaBin** | Из пользовательского выбора | `actions.renameClipById(clipId)` |
| **Adapter** | Генерирует при создании или ищет по ID | `dispatchClipActionById()` |
| **Runtime** | Хранит в модели Clip | Использует для идентификации |

Это стройная система где каждый уровень знает что ему нужно и может действовать без лишних traversals.
