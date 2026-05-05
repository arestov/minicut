# DKT-style render migration plan

Дата: 2026-05-05

Цель: до полноценного перехода на DKT перевести React-рендер MiniCut на weather-like контракт: `scope -> attrs/rels -> scoped actions`. Legend State остается текущим backing store, но UI постепенно перестает импортировать `projects$`, `session$`, `observer`, `For` и `observableSelectors` напрямую.

## Completion criteria

- UI-компоненты читают состояние через render-sync hooks: `useEditorAttrs`, `useEditorOne`, `useEditorMany`, `useEditorActions`.
- Компоненты получают текущий узел через `EditorScopeProvider`, а не через глобальные store/id props, где это возможно.
- Actions вызываются от scope: `dispatch(scope, 'moveBy', payload)`, а adapter временно мапит их в существующий `harness.actions`.
- Legend usage остается разрешенным в adapter/derived layer, но постепенно исчезает из leaf UI.
- Каждый шаг имеет отдельный conventional commit и targeted tests.

## Step 1: document and lock migration direction

Commit: `docs: add dkt style render migration plan`

Files:

- `docs/dkt-style-render-migration-plan-2026-05-05.md`.

Tests:

- Не требуются, markdown-only.

Done when:

- План описывает этапы, файлы, тесты и критерии завершенности.

## Step 2: add render-sync runtime facade

Commit: `feat(video-editor): add dkt style render sync facade`

Files:

- Add `src/video-editor/render-sync/EditorScope.ts`.
- Add `src/video-editor/render-sync/EditorRenderRuntime.tsx`.
- Add `src/video-editor/render-sync/createLegendEditorRenderRuntime.ts`.
- Add `src/video-editor/render-sync/index.ts`.
- Update `src/video-editor/app/createVideoEditorHarness.ts` to expose `renderRuntime`.
- Update `src/video-editor/app/VideoEditorContext.tsx` only if provider helpers are needed.

Implementation notes:

- `EditorScope` is `{ nodeId, type }`, with reserved node ids `session` and `root`.
- `readAttrs(scope, fields)` reads explicit attrs from `session$`, `history$`, `projects$`, or entity attrs.
- `readOne/readMany` reads relations from graph entities and returns child scopes.
- `subscribeAttrs/subscribeOne/subscribeMany` use Legend subscriptions internally.
- `getDispatch(scope)` returns a scoped dispatcher that maps DKT-style action names to existing harness actions.

Tests:

- Add `src/video-editor/render-sync/createLegendEditorRenderRuntime.test.ts`.
- Run `npm run test:video-editor -- src/video-editor/render-sync/createLegendEditorRenderRuntime.test.ts`.

Done when:

- Runtime can read session attrs, entity attrs, one/many rels, and scoped clip/session actions.
- No UI code has to change yet.

## Step 3: migrate timeline/track/clip vertical slice

Commit: `refactor(video-editor): render timeline through scoped shapes`

Files:

- Update `src/video-editor/ui/TimelineView.tsx`.
- Update `src/video-editor/ui/TrackRow.tsx`.
- Update `src/video-editor/ui/ClipItem.tsx`.
- Optionally add small helpers in `src/video-editor/render-sync/timelineReadModels.ts` if selected clip summary or edit bounds needs an adapter-friendly reader.

Implementation notes:

- `TimelineView` reads session attrs (`cursor`, `timelineZoom`, `selectedEntityId`) through render-sync.
- Track lists use `useEditorMany('tracks')` from active timeline scope.
- Track labels read `name`, `kind`, `muted`, `locked` from current track scope.
- Clip items read `name`, `start`, `duration`, `in`, `opacity`, `color`, `mediaKind` from current clip scope.
- Clip actions call scoped dispatch: `select`, `moveBy`, `resize`, `splitAt`.

Tests:

- Run `npm run test:video-editor -- src/video-editor/render-sync/createLegendEditorRenderRuntime.test.ts src/video-editor/tests/video-editor.happy-path.test.tsx`.
- Run `npm run video-editor:build`.

Done when:

- Timeline renders without direct Legend imports in `TrackRow.tsx` and `ClipItem.tsx`.
- `TimelineView.tsx` uses render-sync for timeline hierarchy and key session reads.

## Step 4: migrate preview transport and stage boundary

Commit: `refactor(video-editor): render preview from session read models`

Files:

- Update `src/video-editor/ui/PreviewPanel.tsx`.
- Add render-sync read model support for `previewStructure`, `previewFrame`, `activeInspectorTab`, `isPlaying`.
- Keep `ColorScopesPanel` on the existing `PreviewFrame` observable until its own pass.

Tests:

- Run `npm run test:video-editor -- src/video-editor/tests/video-editor.happy-path.test.tsx src/video-editor/ui/RendererStage.test.tsx`.
- Run `npm run video-editor:build`.

Done when:

- Preview transport reads cursor/active clip names/isPlaying through render-sync.
- Preview stage receives plain frame/structure props rather than Legend observables where practical.

## Step 5: migrate command surfaces

Commit: `refactor(video-editor): scope toolbar media bin and project actions`

Files:

- Update `src/video-editor/ui/Toolbar.tsx`.
- Update `src/video-editor/ui/MediaBin.tsx`.
- Update `src/video-editor/ui/ProjectDropdown.tsx`.
- Extend render-sync actions for root/project/session actions.

Tests:

- Run `npm run test:video-editor -- src/video-editor/tests/video-editor.happy-path.test.tsx`.
- Run `npm run video-editor:build`.

Done when:

- Top-level commands dispatch through root/session/project scopes.
- Resource rows read attrs through resource scopes.

## Step 6: migrate inspector leaf panels

Commit: `refactor(video-editor): render inspector through scoped entities`

Files:

- Update `src/video-editor/ui/Inspector.tsx`.
- Extend render-sync actions for selected clip, text, effect and export commands.

Tests:

- Run `npm run test:video-editor -- src/video-editor/tests/video-editor.happy-path.test.tsx`.
- Run `npm run video-editor:build`.

Done when:

- Inspector panels read selected clip/text/effects through scopes.
- Effect/text updates use scoped actions where possible.

## Step 7: remove direct Legend UI imports

Commit: `refactor(video-editor): isolate legend from ui render layer`

Files:

- All `src/video-editor/ui/*.tsx` files as needed.
- `src/video-editor/render-sync/*`.

Tests:

- Run `rg -n "@legendapp/state|observer\(|<For|observableSelectors|\.get\(" src/video-editor/ui` and manually verify remaining matches are not Legend state reads.
- Run `npm run test:video-editor`.
- Run `npm run video-editor:build`.

Done when:

- UI package depends on render-sync contracts, not Legend implementation details.

## Need new tests?

Yes. The migration introduces a new architectural boundary, so unit tests should cover it directly rather than relying only on UI happy paths.

Required new tests:

- render-sync reads session/entity attrs and graph rels.
- render-sync subscriptions notify when a session attr, entity attr, or rel changes.
- scoped clip dispatch maps to current harness actions without leaking `projects$` into component code.

Optional later tests:

- React hook smoke test with `EditorRenderProvider` and `EditorScopeProvider`.
- Snapshot or accessibility smoke for timeline after removing Legend observers.
