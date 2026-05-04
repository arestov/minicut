# MiniCut Color Grading Architecture and Performance Review

Date: 2026-05-04
Scope: current color grading implementation after preview scopes and split compare foundation.

## Executive Summary

MiniCut now has a coherent first color grading workflow: primary correction in the inspector, preview/export filter parity for the current CSS-compatible path, a timeline grade badge, bypass/reset/presets, hold-to-compare, persistent split compare, and lightweight preview scopes.

The architecture is moving in the right direction because render interpretation is centralized in `render/colorPipeline.ts` and scope interpretation is isolated in `render/colorScopes.ts`. The biggest remaining limitation is that color grading is still mostly CSS-filter based. That gives fast parity for preview/export today, but it is not a professional color engine for temperature/tint/highlights/shadows/vibrance, curves, wheels, LUTs, or secondary corrections.

## Current Stack

### Domain

Files:

- `src/video-editor/domain/types.ts`
- `src/video-editor/domain/applyCommand.ts`
- `src/video-editor/domain/validateCommand.ts`

The domain model represents grading as an `effect` entity with `kind: 'color-correction'`. Primary correction params are stored as `AnimatedScalar` values. This is a reasonable foundation because it fits the existing command/patch/history model and leaves room for keyframes.

Strengths:

- Grade state is durable project data.
- Updates go through commands and validation.
- Undo/redo compatibility is preserved.
- Timeline clips can detect active grade state through effect relations.

Risks:

- `EffectAttrs.params` is currently broad: `Partial<ColorCorrectionAttrs> | Record<string, unknown>`. That is flexible, but it allows future grading data to become loosely typed unless stricter discriminated schemas are added.
- Advanced tools will need richer nested data than the current primary scalar set.
- Validation currently protects basic text/effect shape, but future curves/LUT/secondary data needs explicit validation ranges.

Recommendation:

- Keep `EffectAttrs` as the persistence boundary.
- Add typed helpers such as `isColorCorrectionParams`, `normalizeColorCorrectionParams`, and future `ColorProgram` compile output.
- Add validation per module before introducing curves/LUT/secondary state.

## Render Architecture

Files:

- `src/video-editor/render/colorPipeline.ts`
- `src/video-editor/render/colorScopes.ts`
- `src/video-editor/render/renderPlan.ts`
- `src/video-editor/render/frameRenderer.ts`
- `src/video-editor/ui/RendererStage.tsx`

The current render path compiles effect attrs into render instructions and then into CSS/canvas filter strings. Live preview uses the same compiled filter strings as export, which is the correct baseline.

Strengths:

- Preview/export parity is centralized enough for current effects.
- Disabled effects compile to no filter.
- Split compare uses the same rendered clip data and only disables filters for the left half.
- Scope data generation is pure and testable.

Limitations:

- CSS filters are not a complete grading math model.
- `temperature`, `tint`, `highlights`, `shadows`, and `vibrance` are modeled but not meaningfully rendered yet.
- `gamma` is approximated as a contrast multiplier, not a real transfer function.
- Lightweight scopes are derived from active preview clip color/filter state, not sampled pixels from the actual composited frame buffer.
- Split compare duplicates visual DOM/video layers, which is acceptable for small projects but can become expensive with many simultaneous video layers.

Recommendations:

1. Introduce a `ColorProgram` compiler before adding advanced controls.
2. Add pure `colorMath` functions for tone curves, wheels, LUT interpolation, and qualifiers.
3. Keep CSS filters as the fallback/basic engine.
4. Add a future frame sampling API so scopes can consume actual rendered pixels.
5. Move heavy preview processing to OffscreenCanvas/WebGL/WebGPU once LUTs and secondaries are implemented.

## UI and UX Architecture

Files:

- `src/video-editor/ui/Inspector.tsx`
- `src/video-editor/ui/PreviewPanel.tsx`
- `src/video-editor/ui/RendererStage.tsx`
- `src/video-editor/ui/ClipItem.tsx`
- `src/video-editor/ui/styles.css`

The UX now gives users several important color editing affordances:

- Add primary correction.
- Adjust exposure/contrast/saturation/temperature.
- Apply presets.
- Reset and bypass grade.
- Press-and-hold before compare.
- Persistent split compare.
- Waveform / RGB Parade / Vectorscope panels.
- Timeline grade badge.

Strengths:

- The inspector is consistent with the existing panel layout.
- Split compare is placed in Preview where users naturally look for before/after output.
- Scopes are colocated with Preview, which reduces cognitive travel between controls and result.
- Existing buttons and tab primitives are reused.

Risks:

- `PreviewPanel.tsx` now owns local compare/scope state. That is fine for ephemeral UI, but if users expect compare mode to persist with project/session restore, it should move into `EditorSessionState`.
- `Inspector.tsx` is already large. Adding curves, wheels, LUTs, and secondaries directly there will make it hard to maintain.
- The scope visualizations are DOM-heavy enough for current bucket counts, but future pixel scopes should draw to canvas.

Recommendations:

- Extract `ColorScopesPanel.tsx` if the scope UI grows beyond the current simple panel.
- Extract `InspectorColorTabPanel` to its own file before adding curves/wheels.
- Keep split compare as Preview state unless persistence is explicitly required.
- Draw future dense scopes in `<canvas>` instead of hundreds/thousands of DOM nodes.

## React and Legend Performance

Current behavior:

- `PreviewPanel` creates computed preview structure/frame observables and observes frame state.
- `RendererStage` receives a fully derived frame and maps visual clips to DOM/media layers.
- `InspectorColorTabPanel` reads selected clip attrs/effect attrs through Legend selectors.
- Scope data is derived with `useMemo` from `frame.visualRenderedClips`.

Strengths:

- The current scope calculation is cheap: small bucket arrays and one point per active visual clip.
- React state for compare/scope mode is local and does not trigger project graph writes.
- Legend selectors already avoid broad manual prop drilling.

Risks:

- `frame.visualRenderedClips` may be a new array on every computed update, so `useMemo` can recalculate scopes frequently. This is acceptable now because the calculation is tiny.
- Split compare doubles visual DOM layers while enabled. With many visible clips or multiple videos, this can increase layout/media work.
- Video elements duplicated for split compare are not playback-synced on the before side. This is acceptable for the current overlay because the after side remains authoritative, but a pixel-accurate compare needs a renderer-level compositing solution.
- Long inspector files can make accidental broad observer reads more likely.

Recommendations:

- Keep scope math O(active visual clips) until real frame sampling lands.
- When real scopes land, sample a downscaled frame at a fixed max resolution, for example 160x90 or 256x144.
- Throttle real scope sampling during playback to 10-15 Hz.
- Use canvas/WebGL for split compare once grading moves beyond CSS filters.
- Add render-count/profiling tests only after introducing heavier controls; current unit/UI tests are enough.

## Test Review

Current useful coverage:

- `src/video-editor/render/colorScopes.test.ts` covers empty visual state, audio exclusion, and grade-sensitive scope changes.
- `src/video-editor/tests/video-editor.happy-path.test.tsx` covers primary correction, preview filter application, timeline grade badge, presets, reset, bypass, hold compare, scopes UI, and split compare.
- Existing render/export tests cover the broader render plan behavior.

Remaining gaps:

- No Playwright scenario specifically verifies split compare/scopes in a real browser.
- No pixel-level preview/export parity test for actual color math.
- No tests for temperature/tint/highlights/shadows/vibrance rendering because those parameters are not implemented as real math yet.

Recommended next tests:

1. Add a Playwright scenario for add grade -> enable split compare -> switch scopes -> verify preview remains active.
2. Add pure math tests before implementing curves/wheels/LUTs.
3. Add small fixture-based LUT parser tests before supporting `.cube` import.
4. Add export parity tests only after the engine can expose deterministic sampled frames.

## Performance Outlook

Short term:

- Current implementation is safe for the existing editor scale.
- Split compare has an opt-in cost and is easy to turn off.
- Scopes are lightweight DOM visualizations and should not affect timeline editing.

Medium term:

- Curves and wheels should still be cheap if compiled to CSS-like or software math over small samples.
- UI state should be split into smaller components to avoid unnecessary observer work.

Long term:

- LUTs and secondary corrections should not be implemented as repeated CPU per-pixel loops on full-size frames in React lifecycle code.
- A GPU-backed color engine should own final preview/export color transforms.
- Scopes should sample downscaled rendered output from the renderer, not from React data structures.

## Final Assessment

The current implementation is a good first advanced grading slice. It improves user trust with compare and scopes while keeping the code testable and contained. The next architectural milestone should be a normalized `ColorProgram` and pure color math layer. Without that, adding curves, wheels, LUTs, and secondary corrections will overfit the UI and make preview/export parity fragile.