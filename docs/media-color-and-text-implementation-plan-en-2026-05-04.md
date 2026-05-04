# Media Color Correction and Text Editing Implementation Plan - 2026-05-04

## Scope

This document proposes a production-grade implementation plan for two feature families:

1. Media color correction and media transformation, including preview/export rendering.
2. Text clips, text editing, and text rendering.

For each family the plan covers:
- UI/UX.
- Correct data model.
- Non-basic implementation strategy.
- React/Legend performance preservation.
- Extensive unit and E2E test coverage.

The implementation is intentionally split into two parts per feature:
- **Part A:** data model, render semantics, and extensive tests.
- **Part B:** UI/UX, interaction design, and React performance.

## Current Baseline

Existing strengths:
- The domain model is already graph-shaped: `Entity { id, type, attrs, rels }`.
- Clips already have animated `opacity` and `transform` scalars.
- Effects already exist as `effect` entities attached through `clip.rels.effects`.
- Render/export already compiles frame operations through `renderPlan.ts` and draws through `frameRenderer.ts` / `exportRenderer.ts`.
- Inspector already has `Edit`, `Color`, `Audio`, and `Export` tabs.
- Export already has deterministic manifest rendering plus WebCodecs/MediaRecorder browser paths.

Existing limitations:
- Effects are currently simple named effects (`blur`, `sharpen`, `tint`) rather than typed, parameterized, animatable effect models.
- Color correction is not yet a first-class render operation with shared preview/export semantics.
- Text is not a first-class entity type or generated media type.
- There is no text layout/shaping model, font lifecycle, or text-specific export test suite.

## Recommendation Summary

### Color Correction

Build color correction as typed, animatable effect entities, not as ad hoc clip fields.

Use OKLCH for:
- UI controls.
- User-facing color pickers.
- Design tokens.
- Presets and palette generation.
- Accessibility-friendly color ramps.

Use linear RGB / Canvas / shader-ready values for:
- Pixel processing.
- Frame rendering.
- Export determinism.

Useful ecosystem/tools:
- Evil Martians OKLCH guidance: predictable lightness, better palette generation, P3 support, better accessibility.
- OKLCH Color Picker: https://oklch.com/
- `stylelint-gamut`: detects out-of-gamut colors and P3 handling issues.
- `convert-to-oklch`: useful for design-system migration.
- `Color.js` or `culori`: recommended for JS color conversion, gamut mapping, and preview conversion.

### Text Editing

Build text as a first-class generated timeline object:
- Add `text` entity type for content and style.
- Add text clips to tracks as normal timeline clips.
- `clip.rels.text` points to the text entity.
- Do not model text as imported `resource`; text is generated media, not external binary input.

Rendering should use a single shared layout engine for preview/export:
- Measure and layout text deterministically.
- Cache font metrics and layout per style/content/box.
- Render through Canvas2D initially, with clean boundaries for future worker/OffscreenCanvas or WebGL acceleration.

## 1. Media Color Correction and Transformation

## 1.1 Best UI/UX

The Color tab should feel like a real editor control surface, not a form.

Recommended UI structure:
- **Preset strip:** None, Warm, Cool, Cinema, B&W, Punch, Soft Skin, Night.
- **Primary correction group:** Exposure, Contrast, Highlights, Shadows, Saturation, Temperature, Tint.
- **Creative color group:** Hue rotate, Vibrance, Sepia, Fade, Vignette.
- **Color wheels later:** Lift/Gamma/Gain or Shadows/Midtones/Highlights wheels.
- **Before/after toggle:** hold-to-preview original.
- **Reset buttons:** per group and per property.
- **Keyframe buttons:** per animatable scalar where existing `AnimatedScalar` semantics apply.

OKLCH UX recommendation:
- Use OKLCH for user-facing color pickers and palette controls because `L` maps to perceived lightness.
- For clip colors, labels, tint color, text fill/stroke, and theme tokens, expose controls as `L`, `C`, `H`, `alpha`.
- Show a small gamut warning when a selected OKLCH color is outside sRGB.
- Store user color values as normalized OKLCH strings or structured OKLCH objects, then compile to render-space values.

Important boundary:
- OKLCH is excellent for choosing colors, palette generation, and accessibility.
- Color correction math should still operate in a render-oriented color model. Do not apply video correction by directly manipulating OKLCH per pixel in the first implementation.

## 1.2 Correct Data Model

Extend effect attrs from loosely named effects to typed effect attrs.

Recommended types:

```ts
export type EffectKind =
  | 'blur'
  | 'sharpen'
  | 'tint'
  | 'color-correction'
  | 'vignette'
  | 'lut'

export interface ColorCorrectionAttrs {
  exposure: AnimatedScalar
  contrast: AnimatedScalar
  highlights: AnimatedScalar
  shadows: AnimatedScalar
  saturation: AnimatedScalar
  vibrance: AnimatedScalar
  temperature: AnimatedScalar
  tint: AnimatedScalar
  hue: AnimatedScalar
  gamma: AnimatedScalar
}

export interface TintEffectAttrs {
  color: OklchColor
  strength: AnimatedScalar
  blendMode: 'normal' | 'multiply' | 'screen' | 'overlay' | 'soft-light'
}

export interface OklchColor {
  l: number
  c: number
  h: number
  alpha: number
  gamut?: 'srgb' | 'p3'
}
```

Recommended entity shape:

```ts
{
  id: 'effect:123',
  type: 'effect',
  attrs: {
    kind: 'color-correction',
    name: 'Primary Correction',
    enabled: true,
    params: ColorCorrectionAttrs
  },
  rels: { clip: 'clip:123' }
}
```

Why this is better:
- Effects remain graph nodes and can be reordered, copied, disabled, removed, and keyframed.
- Clip attrs stay focused on timeline and transform concerns.
- Render/export can compile an ordered effect stack.
- Future LUTs and masks fit the same model.

Transformation model:
- Existing `ClipAttrs.transform` is good for position/scale/rotation.
- Add missing advanced transform fields only when needed: `anchor`, `crop`, `fit`, `flipX`, `flipY`.
- Keep transform as clip attrs because it defines timeline placement, not an effect stack item.

## 1.3 Correct Non-Basic Rendering Strategy

Phase 1:
- Keep the existing frame operation compiler.
- Replace string effect operations with typed effect operations.
- Implement deterministic Canvas2D filters where possible.
- For unsupported operations, implement pixel-level `ImageData` fallback in isolated helpers for manifest/unit tests.

Phase 2:
- Add a `ColorPipeline` module that compiles effect stacks into render instructions.
- Use the same pipeline for preview and export.
- Cache compiled effect stacks by `clipId + effectVersion + frameTimeBucket`.

Phase 3:
- Move heavy per-pixel color operations to WebGL/WebGPU or OffscreenCanvas worker.
- Keep Canvas2D fallback for tests and unsupported browsers.

Recommended files:
- `src/video-editor/domain/types.ts`
- `src/video-editor/domain/applyCommand.ts`
- `src/video-editor/domain/validateCommand.ts`
- `src/video-editor/render/renderPlan.ts`
- `src/video-editor/render/frameRenderer.ts`
- `src/video-editor/render/exportRenderer.ts`
- `src/video-editor/render/colorPipeline.ts` (new)
- `src/video-editor/render/colorPipeline.test.ts` (new)

## 1.4 React/Legend Performance

Rules:
- Do not put all color controls in one broad observer.
- Use leaf observer components per group or per property row.
- Read only the selected effect attrs needed by a control.
- Keep drag UI local until commit, or throttle command dispatch during slider drags.
- Use preview-local transient state for live scrub/slider feedback when necessary.
- Commit final domain command on pointer up for high-frequency sliders.

Recommended pattern:
- `ColorPanel` chooses selected clip and effect ids.
- `ColorEffectStackPanel` observes only `clip.rels.effects`.
- `ColorCorrectionRow` observes one `effect.params.exposure.value` style path.
- Sliders maintain local draft state and dispatch `EFFECT_UPDATE_ATTRS` on debounce/commit.

## 1.5 Extensive Tests

Unit tests:
- Domain command validation for color effect creation/update/remove/reorder.
- Patch generation for `EFFECT_ADD`, `EFFECT_UPDATE_ATTRS`, `EFFECT_REORDER`.
- Color parameter clamping and default creation.
- OKLCH parse/serialize/gamut conversion helpers.
- Render plan compiles ordered typed effects.
- Color pipeline maps params to deterministic operations.
- Manifest export includes color operations and diagnostics.

Property/random tests:
- Random effect stacks preserve graph integrity.
- Random color params never produce `NaN` or invalid render operations.
- Random animated color params evaluate deterministically at frame time.

E2E tests:
- Add a video/image clip, apply color preset, verify inspector values and preview state.
- Drag exposure/saturation sliders and verify no layout jumps.
- Export a color-corrected image/video and sample pixels with ffmpeg/Playwright where feasible.
- Verify before/after toggle does not mutate domain state.

## 2. Text Editing and Text Rendering

## 2.1 Best UI/UX

Text should behave like a real timeline object:
- Toolbar button: Add Text.
- Text appears as a timeline clip on a video track.
- Double-click preview text to edit inline.
- Inspector text tab for typography and layout.
- Canvas overlay handles for move/resize/rotate.
- Keyboard shortcuts: Enter commit, Esc cancel, Cmd/Ctrl+B/I, arrow nudge, Shift-arrow larger nudge.

Recommended Inspector UI:
- Content: multiline text field with inline preview focus.
- Typography: font family, size, weight, style, line height, letter spacing.
- Layout: align, vertical align, box width/height, padding.
- Appearance: fill color, stroke, shadow, background, opacity.
- Motion: reuse transform controls.
- Presets: Lower third, Title, Subtitle, Caption, Callout, Watermark.

OKLCH usage:
- Text fill/stroke/background colors should use OKLCH controls.
- Provide contrast hints: text color vs background/underlying fill.
- Use OKLCH lightness to generate safe default text/background pairs.

## 2.2 Correct Data Model

Add a first-class `text` entity type.

Recommended extension:

```ts
export type EntityType =
  | 'project'
  | 'timeline'
  | 'track'
  | 'resource'
  | 'clip'
  | 'effect'
  | 'keyframe'
  | 'text'

export interface TextAttrs {
  content: string
  plainText: string
  runs: TextRun[]
  box: TextBoxAttrs
  style: TextStyleAttrs
  background?: TextBackgroundAttrs
  shadow?: TextShadowAttrs
}

export interface TextRun {
  start: number
  end: number
  style: Partial<TextStyleAttrs>
}

export interface TextStyleAttrs {
  fontFamily: string
  fontSize: AnimatedScalar
  fontWeight: number
  italic: boolean
  lineHeight: number
  letterSpacing: number
  fill: OklchColor
  stroke?: { color: OklchColor; width: number }
  align: 'left' | 'center' | 'right'
  verticalAlign: 'top' | 'middle' | 'bottom'
}

export interface TextBoxAttrs {
  width: number
  height: number
  padding: number
  overflow: 'clip' | 'fit' | 'wrap'
}
```

Recommended graph relation:

```ts
{
  id: 'clip:text-1',
  type: 'clip',
  attrs: {
    mediaKind: 'text',
    start: 0,
    duration: 5,
    transform: ...,
    opacity: ...
  },
  rels: { text: 'text:1', effects: [] }
}
```

Why not model text as `resource`:
- It is generated media, not imported binary media.
- It has rich editable structure.
- It should render even without a file URL.
- It needs semantic editing operations independent from resource transfer.

## 2.3 Correct Non-Basic Rendering Strategy

Text rendering pipeline:
1. `compileFrameOperations` emits text operations when a text clip is visible.
2. `textLayoutEngine` computes lines, glyph/range boxes, baseline positions, and overflow.
3. `frameRenderer` draws text using the same layout result in preview/export.
4. Export uses the same layout engine to avoid preview/export drift.

Recommended new modules:
- `src/video-editor/render/textLayout.ts`
- `src/video-editor/render/textRenderer.ts`
- `src/video-editor/ui/TextOverlayEditor.tsx`
- `src/video-editor/ui/TextInspectorPanel.tsx`

Font strategy:
- Phase 1: system fonts and CSS font family names.
- Phase 2: project font registry and font loading status.
- Phase 3: optional embedded font assets for portable project export.

Layout correctness:
- Use Canvas `measureText` for initial implementation.
- Cache layout by `content + style + box + fontLoadVersion`.
- Always include deterministic fallback fonts.
- Keep rich text runs in model even if UI initially edits plain text only.

## 2.4 React/Legend Performance

Rules:
- Inline text editing should use local draft state, not dispatch on every keystroke unless debounced.
- Commit text changes on blur/Enter or after short debounce for autosave.
- Separate overlay editing state from shared project state.
- Keep text layout measurement outside React render.
- Memoize text layout per text entity/version.
- Do not let the whole preview tree observe all text attrs.

Recommended pattern:
- `TextOverlayEditor` owns draft text while editing.
- `TextInspectorPanel` is split into leaf observer rows.
- `TextStyleRow` observes one field.
- `TextLayoutPreview` subscribes to selected text only.

## 2.5 Extensive Tests

Unit tests:
- `TEXT_ADD` creates clip + text entity + track relation.
- `TEXT_UPDATE_CONTENT` updates only text attrs.
- `TEXT_UPDATE_STYLE` validates font size, line height, colors, stroke width.
- Text deletion removes clip and text entity.
- Undo/redo restores text entity and clip relation.
- Render plan emits text operations at correct time.
- Text layout wraps, aligns, and clips deterministically.
- Export manifest includes text operations.

Property/random tests:
- Random text content and box sizes never produce invalid layout numbers.
- Random style changes preserve graph integrity.
- Random timeline operations with text clips maintain rel consistency.

E2E tests:
- Add text clip, edit inline, commit, reload/snapshot, verify content persists.
- Change font size/fill/stroke/alignment in inspector.
- Move/resize text overlay and verify transform updates.
- Export text overlay and sample output frame for expected text-colored pixels.
- Verify typing into overlay does not rerender unrelated timeline clips excessively where measurable.

## 3. Implementation Table

| Stage | Area | UX/UI | Data Model | Files | Tests | Commit |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | Color model | No UI | Add typed effect attrs, defaults, validation | `domain/types.ts`, `domain/applyCommand.ts`, `domain/validateCommand.ts` | Unit + random command invariants | `feat(color): add typed color correction effect model` |
| 2 | Color render | No UI | Compile typed color effect stack | `render/renderPlan.ts`, `render/frameRenderer.ts`, `render/colorPipeline.ts` | Unit render pipeline + manifest export | `feat(render): compile color correction operations` |
| 3 | Color export | Minimal UI hooks | Same model | `render/exportRenderer.ts`, `render/debugRenderer.ts` | ffmpeg/manifest/pixel tests | `test(render): cover color corrected export frames` |
| 4 | Color UI | Color tab panels, presets, sliders, OKLCH tint picker | No schema changes | `ui/Inspector.tsx`, new color panel components, CSS | Component/E2E slider and preset tests | `feat(ui): add color correction inspector controls` |
| 5 | Color perf | Draft sliders, leaf observers | No schema changes | `legend/observableSelectors.ts`, UI panels | Render count/regression tests | `perf(ui): isolate color correction control reads` |
| 6 | Text model | No UI | Add `text` entity, text commands, validation | `domain/types.ts`, `domain/applyCommand.ts`, `domain/validateCommand.ts`, selectors | Unit + random graph invariants | `feat(text): add text entity and timeline commands` |
| 7 | Text render | No UI | Compile text frame operations | `render/renderPlan.ts`, `render/textLayout.ts`, `render/textRenderer.ts`, `frameRenderer.ts` | Unit layout/render plan/manifest tests | `feat(render): add deterministic text layout rendering` |
| 8 | Text export | No UI | Same model | `render/exportRenderer.ts`, debug renderer | Export artifact pixel tests | `test(export): cover text overlay rendering artifacts` |
| 9 | Text UI | Add Text button, inline editor, inspector | No schema changes | `ui/*`, `app/createVideoEditorHarness.ts`, CSS | E2E add/edit/style/export | `feat(ui): add text clip editing experience` |
| 10 | Text perf | Draft editing, layout cache, leaf observers | Optional font status | UI/render cache modules | React perf + typing regression tests | `perf(text): cache layout and isolate editor state` |

## 4. Suggested Conventional Commit Plan

Color correction Part A:
1. `feat(color): add typed color correction effect model`
2. `test(color): cover color effect validation and patch generation`
3. `feat(render): compile color correction operations`
4. `test(render): cover color pipeline and export manifests`

Color correction Part B:
5. `feat(ui): add color correction inspector controls`
6. `feat(ui): add oklch color picker controls for tint and labels`
7. `perf(ui): isolate color correction observer reads`
8. `test(e2e): cover color preset editing and export`

Text Part A:
9. `feat(text): add text entity and timeline commands`
10. `test(text): cover text graph invariants and command patches`
11. `feat(render): add deterministic text layout rendering`
12. `test(render): cover text layout and export manifests`

Text Part B:
13. `feat(ui): add text clip creation and inline editing`
14. `feat(ui): add text typography inspector`
15. `perf(text): cache layout and isolate draft editing state`
16. `test(e2e): cover text editing styling and export artifact`

## 5. Test Matrix

| Feature | Unit | Property/Random | Component | E2E | Artifact |
| --- | --- | --- | --- | --- | --- |
| Color defaults | yes | yes | no | no | no |
| Color validation | yes | yes | no | no | no |
| Effect stack order | yes | yes | no | yes | yes |
| OKLCH conversion | yes | yes | yes | yes | no |
| Color preview | yes | no | yes | yes | screenshot/pixel |
| Color export | yes | no | no | yes | ffmpeg/pixel |
| Text commands | yes | yes | no | no | no |
| Text layout | yes | yes | no | no | pixel optional |
| Text inline editing | no | no | yes | yes | no |
| Text typography | yes | no | yes | yes | screenshot/pixel |
| Text export | yes | no | no | yes | ffmpeg/pixel |

## 6. Design Notes and Guardrails

Do:
- Keep domain model explicit and typed.
- Keep effects as graph entities.
- Keep text as generated media, not imported resource.
- Use OKLCH for user-facing colors and design-system tokens.
- Use shared render pipeline for preview and export.
- Keep high-frequency UI interactions local or debounced.
- Add tests before UI for both feature families.

Avoid:
- CSS-only color correction that diverges from export.
- Text as a magic overlay outside the timeline graph.
- Dispatching a command on every slider pixel or every keystroke.
- Storing DOM layout measurements in shared project state.
- Introducing a UI before command/patch/render semantics are tested.

## 7. Recommended First Slice

Best first slice for color:
1. Add typed `color-correction` effect with exposure/contrast/saturation/temperature.
2. Compile it into manifest frame operations.
3. Add deterministic color pipeline tests.
4. Add Inspector Color tab controls only after tests are stable.

Best first slice for text:
1. Add `text` entity and `TEXT_ADD` / `TEXT_UPDATE_CONTENT` commands.
2. Render text into manifest/debug renderer first.
3. Add deterministic text layout tests.
4. Add inline editor and typography panel after model/render tests are stable.
