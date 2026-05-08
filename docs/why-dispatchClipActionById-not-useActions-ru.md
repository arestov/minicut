# Почему useActions() недостаточно? Когда нужен dispatchClipActionById

## TL;DR

`useActions()` работает только **внутри React компонента в контексте scope**.  
`dispatchClipActionById()` нужен когда действие вызывается **из другого контекста** (adapter, другой компонент вне scope, другой слой приложения).

---

## Сценарий 1: ✅ Можно использовать useActions() 

### ClipItem (находится ВНУТРи Clip scope):

```typescript
// ClipItem.tsx - компонент находится в контексте Clip scope
export const ClipItem = ({ timelineZoom, activeTool }: Props) => {
  const dispatch = useActions()  // ← Работает! Это dispatch на текущий Clip scope
  
  const handleSplit = (time: number) => {
    dispatch('splitSelfAt', { time })  // ← Действие на этот клип
  }
  
  const handleMove = (delta: number) => {
    dispatch('moveBy', { delta })  // ← Действие на этот клип
  }
  
  return <button onClick={() => handleSplit(5)}>Split</button>
}

// Как это работает:
// 1. ClipItem рендерится в контексте Track → clips[i] → Clip scope
// 2. useActions() автоматически получает текущий scope из ScopeContext
// 3. dispatch() работает прямо на этот scope
```

---

## Сценарий 2: ❌ useActions() НЕ работает

### InspectorClipHeader (находится в Inspector, НО не внутри Clip scope):

```typescript
// InspectorClipHeader.tsx - компонент находится в Inspector panel
export const InspectorClipHeader = ({ trackPosition }: Props) => {
  const { actions } = useVideoEditor()  // ← Достаем actions из context
  const attrs = useAttrs(['sourceClipId', 'name', 'color'])
  const sourceClipId = attrs.sourceClipId
  
  // ❌ Можем ли мы использовать useActions() здесь?
  // const dispatch = useActions()
  
  // Проблема: useActions() хочет использовать ScopeContext...
  // Но ScopeContext - это чей scope? Inspector panel не находится в контексте Clip!
  
  // Правильно:
  const handleNameChange = (name: string) => {
    // Нельзя: dispatch('rename', { name })
    // Потому что dispatch будет на InspectorPanel scope, а не на нужный Clip!
    
    // Правильно - использовать actions API:
    actions.renameClipById(sourceClipId, name)  // ← Это вызовет dispatchClipActionById
  }
  
  return (
    <input
      value={name}
      onChange={(e) => handleNameChange(e.target.value)}
    />
  )
}

// Почему это не работает с useActions():
// 1. InspectorClipHeader находится в Panel (другой scope)
// 2. useActions() вернет dispatch на Panel scope
// 3. dispatch('rename', ...) будет на Panel, не на Clip!
```

---

## Визуализация: Scope контекст иерархия

### Правильная иерархия для ClipItem:

```
Project scope
  └─ Track scope
      └─ Clip scope
          └─ ClipItem component
              └─ useActions() работает на Clip scope ✅
```

### Проблемная иерархия для InspectorClipHeader:

```
Project scope
  └─ Track scope
      ├─ Clip scope (где данные)
      │   └─ useAttrs() читает отсюда ✅
      │
      └─ Inspector Panel scope (где компонент)
          └─ InspectorClipHeader component
              └─ useActions() работает на Panel scope ❌
```

---

## Сценарий 3: Adapter (совсем вне React компонентов)

### EditorHarnessAdapter - это не React компонент:

```typescript
// editorHarnessAdapter.ts
export const createEditorHarnessAdapter = (env: EditorActionEnvironment) => ({
  // ← Это не React компонент, это обычные функции
  
  renameClipById(clipId: string, name: string): void {
    // ❌ Нельзя использовать useActions() - это не hook!
    // const dispatch = useActions()  // ← Error: invalid hook call
    
    // ✅ Нужно использовать dispatchClipActionById:
    dispatchClipActionById(env, clipId, 'rename', { name })
  },
  
  deleteClipById(clipId: string): void {
    // ❌ Нельзя: useActions()
    
    // ✅ Правильно:
    dispatchClipActionById(env, clipId, 'removeSelf')
  },
})

// Почему:
// 1. Adapter - это функция, не React компонент
// 2. Нет ScopeContext (это React feature)
// 3. Нет способа узнать какой scope нужен
// 4. dispatchClipActionById нужен чтобы найти scope по ID
```

---

## Архитектурные слои:

```
┌─────────────────────────────────────────────┐
│ React Components (Timeline, Inspector)      │
├─────────────────────────────────────────────┤
│ useAttrs(), useActions(), useMany()         │
│ ← Работают внутри ScopeContext              │
├─────────────────────────────────────────────┤
│ VideoEditorContext.actions API              │
│ (createEditorHarnessAdapter)                │
├─────────────────────────────────────────────┤
│ dispatchClipActionById, dispatchProject...  │
│ ← Работают с IDs, ищут scopes               │
├─────────────────────────────────────────────┤
│ DKT Runtime (dispatch, readAttrs)           │
│ ← Работают со Scope объектами               │
└─────────────────────────────────────────────┘
```

---

## Почему бы не пробросить scope в props?

### ❌ Плохой подход:

```typescript
interface InspectorClipHeaderProps {
  clipScope: ReactSyncScopeHandle  // ← Тесная связь
  trackPosition: { trackName: string; ordinal: number } | null
}

export const InspectorClipHeader = ({ clipScope, trackPosition }: Props) => {
  // Проблемы:
  // 1. React component получает runtime объект (ScopeHandle)
  // 2. Scope может стать невалидным если структура изменится
  // 3. Component привязан к runtime реализации DKT
  // 4. Сложнее тестировать (нужно мокировать ScopeHandle)
  // 5. API становится нестабильным если DKT изменится
}
```

### ✅ Правильный подход:

```typescript
interface InspectorClipHeaderProps {
  sourceClipId: string  // ← Просто ID, полностью decoupled
  trackPosition: { trackName: string; ordinal: number } | null
}

export const InspectorClipHeader = ({ sourceClipId, trackPosition }: Props) => {
  const { actions } = useVideoEditor()  // ← Actions знают как найти scope
  
  const handleNameChange = (name: string) => {
    actions.renameClipById(sourceClipId, name)  // ← Adapter найдет scope
  }
}

// Преимущества:
// 1. Component не знает о runtime деталях
// 2. Component не привязан к DKT
// 3. Легко мокировать в тестах (actions API простой)
// 4. Стабильное API даже если DKT изменится
```

---

## Реальный пример: Почему InspectorClipHeader используется dispatchClipActionById

```typescript
// InspectorClipHeader.tsx (line 68)
export const InspectorClipHeader = ({ trackPosition }: Props) => {
  const { actions } = useVideoEditor()  // ← Получаем actions API
  const attrs = useAttrs(['sourceClipId', 'name', 'color'])
  const sourceClipId = attrs.sourceClipId
  
  // ✅ Используем actions API, которая использует dispatchClipActionById внутри
  const handleNameChange = (name: string) => {
    actions.renameClipById(sourceClipId, name)
  }
  
  return (
    <input
      value={name}
      onChange={(e) => handleNameChange(e.currentTarget.value)}
    />
  )
}

// Цепь вызовов:
// 1. handleNameChange вызывает actions.renameClipById(sourceClipId, name)
// 2. renameClipById (в adapter) вызывает dispatchClipActionById()
// 3. dispatchClipActionById находит Clip scope по sourceClipId
// 4. dispatch('rename', {name}) выполняется на найденном scope
```

---

## Сравнительная таблица

| Метод | Где использовать | Пример | Преимущества |
|-------|-----------------|--------|--------------|
| **useActions()** | Внутри компонента в scope | `<ClipItem />` внутри Track | Простой API, автоматический scope |
| **actions.methodById()** | UI компонент вне scope | `<InspectorClipHeader />` | Decoupled от runtime, типизированный API |
| **dispatchClipActionById()** | Adapter функции | `renameClipById()` в adapter | Гибкий, работает везде |
| **runtime.dispatch()** | Низкий уровень | Внутри DKT моделей | Полный контроль, но сложный |

---

## Заключение

**useActions() недостаточно потому что:**

1. **React hook** - может использоваться только в компонентах
2. **Привязан к ScopeContext** - работает только на текущий scope
3. **Требует быть в контексте** - компонент должен быть отрендерен внутри scope
4. **Не масштабируется** - нельзя вызвать действие на другой scope

**dispatchClipActionById нужен потому что:**

1. **Универсален** - может использоваться везде (компоненты, adapter, другие функции)
2. **Decoupled** - работает с IDs, не требует runtime объектов
3. **Находит scope** - может найти нужный scope по ID и выполнить действие
4. **Масштабируется** - обрабатывает случаи когда компонент не в контексте нужного scope
5. **Стабильный API** - не привязан к React или DKT деталям
