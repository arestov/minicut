# MiniCut Color Grading Implementation Plan

Date: 2026-05-04
Branch: `split`

## Plan Review

The requested color grading surface is a real NLE/DI-style feature set, not a small UI extension. The existing MiniCut implementation already has a useful primary correction model, preview/export filter parity for CSS-compatible operations, and basic grading UX controls. The next work should avoid mixing UI widgets directly with render math. The main risk is preview/export drift: if scopes, split compare, LUTs, curves, and secondary corrections each invent their own interpretation of a grade, the editor will become difficult to test and users will stop trusting preview.

The safest strategy is an incremental color engine architecture:

1. Keep the current `effect` graph as the public domain surface.
2. Compile effects into a normalized color program.
3. Use the same color program for preview, export, scopes, and tests.
4. Add GPU-backed processing only behind a stable software-testable interface.

## Product UX Goals

The color UX should communicate that grading is applied intentionally, can be audited, and can be compared.

Core UX:

- A timeline `Grade` badge when a clip has an enabled color correction.
- A persistent split-view compare in Preview, separate from press-and-hold before/after.
- A scopes panel next to Preview with Waveform, RGB Parade, and Vectorscope tabs.
- A Primary panel with reset, bypass, presets, and clear numeric feedback.
- Later: wheels, curves, LUT, and secondary correction panels as separate grade modules, not one giant panel.

Good interaction details:

- Split compare should be visible in the preview, with a center divider and labels `Before` / `After`.
- Scopes should update from the current playhead frame and show an explicit empty state when no visual clip is active.
- Grade controls should never hide the active media controls or transport.
- Presets should be low-friction and reversible via undo.
- Bypass should remove both preview filters and the timeline grade badge.

## Architecture

### Domain Layer

Keep `EffectAttrs` as the command/patch model. Extend only when a feature needs durable project state.

Recommended future shape:

```ts
interface ColorProgram {
  passes: ColorPass[]
}

type ColorPass =
  | { type: 'primary'; enabled: boolean; params: PrimaryParams }
  | { type: 'curves'; enabled: boolean; curves: RGBCurves }
  | { type: 'wheels'; enabled: boolean; wheels: LiftGammaGain }
  | { type: 'lut'; enabled: boolean; lutId: string; amount: number }
  | { type: 'secondary'; enabled: boolean; qualifier: HslQualifier; correction: PrimaryParams }
```

### Render Layer

Add a dedicated color engine module over time:

- `render/colorPipeline.ts`: current compile-to-filter path.
- `render/colorProgram.ts`: future normalized program compiler.
- `render/colorMath.ts`: pure math helpers for curves, wheels, tonal ranges, LUT sampling.
- `render/colorScopes.ts`: preview-frame scope data derived from the same compiled program.
- `render/gpuColorEngine.ts`: later WebGL/WebGPU backend.

Preview and export should call the same compile functions. The UI should never construct CSS filters or shader uniforms by itself.

### UI Layer

Use focused panels:

- `InspectorColorTabPanel`: primary correction, presets, bypass, compare controls.
- `PreviewPanel`: split compare and scope mode controls.
- `RendererStage`: visual rendering and split compare clipping.
- `ColorScopesPanel`: waveform / parade / vectorscope visualization.
- `ClipItem`: grade state badge only.

## Math Plan

### Current Primary Correction

The current CSS-compatible model maps:

- `exposure -> brightness(1 + exposure)`
- `contrast -> contrast(contrast)`
- `saturation -> saturate(saturation)`
- `hue -> hue-rotate(hue)`
- `gamma -> contrast multiplier` as a temporary approximation

This is acceptable for a CSS preview/export baseline but not enough for professional grading.

### Scopes

Step 1 uses deterministic lightweight scope data from the active preview frame and compiled grade state. It is testable and gives users immediate feedback. Later GPU scopes should sample the actual post-render frame buffer.

Waveform:

- Bucket luma into 0..1 bins.
- Luma approximation: `Y = 0.2126R + 0.7152G + 0.0722B`.
- In Step 1, synthesize channel values from active clip grade/filter state.
- In Step 2+, sample downscaled pixels from the final rendered frame.

RGB Parade:

- Separate R/G/B intensity buckets.
- Use the same sampled frame source as waveform.

Vectorscope:

- Convert sampled RGB to chroma coordinates.
- Simple approximation: `x = R - Y`, `y = B - Y`.
- Normalize into [-1, 1].

### Curves

Use monotonic control-point interpolation per channel:

- Input domain: `[0, 1]`.
- Output range: `[0, 1]`.
- Store points as sorted `{ x, y }`.
- Start with linear interpolation.
- Later switch to monotone cubic interpolation if needed.

### Wheels

Lift/gamma/gain should operate in normalized RGB:

- `lift`: additive offset strongest in shadows.
- `gamma`: power curve around midtones.
- `gain`: multiplicative scale strongest in highlights.

Use tonal weighting functions:

- shadows: `1 - smoothstep(0.15, 0.55, luma)`
- midtones: triangular/smooth band around `0.5`
- highlights: `smoothstep(0.45, 0.85, luma)`

### LUT

Start with `.cube` parsing:

- Support `TITLE`, `LUT_3D_SIZE`, `DOMAIN_MIN`, `DOMAIN_MAX`.
- Store LUT resources as project resources or dedicated LUT entities.
- Apply trilinear interpolation.
- Blend with original color via `amount`.

### Secondary Corrections

Use HSL qualifiers with soft ranges:

- Hue center/range/softness.
- Saturation min/max/softness.
- Luma min/max/softness.
- Mask = product of range weights.
- Apply correction only where mask > 0.

This should come after scopes and curves because it needs strong visual feedback.

## Step-by-Step Implementation

### Step 1: Preview Compare and Scope Foundation

Commit: `feat(color): add preview scopes and split compare`

Files:

- `src/video-editor/render/colorScopes.ts`
- `src/video-editor/ui/PreviewPanel.tsx`
- `src/video-editor/ui/RendererStage.tsx`
- `src/video-editor/ui/styles.css`
- `src/video-editor/tests/video-editor.happy-path.test.tsx`
- `src/video-editor/render/colorScopes.test.ts`

Implementation:

- Add pure scope data generation for the active preview frame.
- Add Waveform / RGB Parade / Vectorscope UI modes.
- Add Preview split compare toggle.
- Render before/after split by duplicating visual preview layers with filters disabled on the left side.
- Keep audio rendering unchanged.

Tests:

- Unit: scope data returns empty state without visual clips.
- Unit: scope data changes when color correction changes exposure/saturation.
- UI: preview exposes split compare toggle and scope mode buttons.
- UI: enabling split compare shows before/after labels and keeps renderer visible.

E2E:

- Extend one lightweight Playwright editor scenario to open Color tab, add correction, enable split compare, and verify scope panel renders.

### Step 2: Curves and Wheels Data Model

Commit: `feat(color): add curves and wheel grade model`

Implementation:

- Extend color effect params with curves/wheels data.
- Add validation for curve points and wheel vectors.
- Add pure math helpers in `render/colorMath.ts`.

Tests:

- Domain validation for curve point ordering and value ranges.
- Math unit tests for identity curves, lifted shadows, and gamma response.

### Step 3: Curves and Wheels UI

Commit: `feat(color): add curves and wheel controls`

Implementation:

- Add compact RGB curve editor.
- Add lift/gamma/gain wheel controls with numeric reset.
- Compile to preview/export color program.

Tests:

- UI tests for reset and param updates.
- Render tests for deterministic filter/program output.

### Step 4: LUT Pipeline

Commit: `feat(color): add lut import and blending`

Implementation:

- Parse `.cube` LUT files.
- Store LUT resources.
- Add amount and bypass per clip.
- Apply in software first; later GPU.

Tests:

- Parser unit tests for small `.cube` fixtures.
- Math tests for trilinear interpolation.
- UI tests for LUT import, amount, bypass.

### Step 5: Secondary Corrections

Commit: `feat(color): add hsl secondary corrections`

Implementation:

- Add HSL qualifier data model.
- Add softness/range math.
- Add secondary panel with mask preview toggle.

Tests:

- Qualifier math tests.
- UI tests for range/softness changes.
- E2E for mask preview toggle and export parity.

## Test Strategy

Unit tests should carry most of the load:

- Domain validation for durable project state.
- Pure color math tests for curves, wheels, LUT, qualifiers.
- Color pipeline tests for deterministic program compilation.
- Scope tests for deterministic visualization data.

React tests should verify contracts, not pixels:

- Control appears when clip is selected.
- Control updates project graph.
- Preview receives derived state.
- Badge and bypass reflect enabled state.

Playwright E2E should stay focused:

- Open editor, import media, add correction.
- Enable split compare.
- Switch scopes.
- Verify preview remains active and export still produces media.

Avoid fragile visual pixel expectations for scopes until the renderer exposes a stable frame sampling API.

## Completion Criteria

For each step:

- Conventional commit exists with the planned name.
- Changed files are listed in the final report.
- New tests are listed in the final report.
- `npx tsc --noEmit -p tsconfig.video-editor.json` passes.
- Focused tests pass.
- Full `npm test` passes before final handoff.
- Playwright integration runs for steps that touch browser preview/export behavior.