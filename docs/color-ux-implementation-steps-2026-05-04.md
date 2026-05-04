# Color UX Implementation Steps

## Goal

Implement three color UX improvements without turning preview/export into separate truths:

1. OKLCH-backed text color/background controls with contrast and gamut feedback.
2. Look Browser with preview chips and intensity.
3. Frame-derived palettes from the currently displayed preview frame.

The implementation should keep a testable JSON/data layer between app state and rendering. Preview and export should consume equivalent render-operation data so tests can validate data generation separately from DOM/canvas rendering.

## Step 1: Shared Preview/Export Render Data

### Implementation

- Add a small preview render plan module that converts `PreviewFrame` into serializable preview layer operations.
- Keep it derived-only and allocation-light: no DOM access, no media decoding.
- Use it in `RendererStage` for layer props where possible.
- Keep existing export `compileFrameOperations` as the export JSON source, but align tests around the same operation concepts: transform, text, effect, opacity, audio.

### Tests

- Unit test: preview render JSON contains text operation style values and effect filters.
- Unit test: preview render JSON changes when text color/background changes.
- Unit test: export frame operations include the same text style/effect values.
- Integration test remains responsible for DOM/canvas display.

### Completion Criteria

- Preview render data is independently testable.
- Preview UI consumes the data without performance regression.
- Export manifest still contains expected operations.

## Step 2: OKLCH Text Color Controls

### Implementation

- Add OKLCH conversion helpers for sRGB hex and CSS rgb values.
- Add gamut fitting that preserves hue/lightness and lowers chroma if needed.
- Add contrast helpers for text/background choices.
- Add text color and background OKLCH controls under the Text section.
- Keep native color inputs for familiar direct editing.
- Show status badges: contrast result and gamut result.
- Add `Fix contrast` to adjust text color lightness while preserving hue when possible.

### Tests

- Unit test: hex to OKLCH to hex round-trip stays close.
- Unit test: gamut fitting returns sRGB-safe color.
- Unit test: contrast suggestion improves contrast and preserves hue direction.
- Component/integration test: changing OKLCH text controls updates preview text style.
- Export test: manifest text operation contains updated text color/background.

### Completion Criteria

- Text color/background controls affect app state, preview DOM, preview render JSON, and export JSON.
- Contrast/gamut feedback is visible and deterministic.

## Step 3: Look Browser With Intensity

### Implementation

- Replace/extend simple grade preset buttons with a Look Browser strip.
- Each look has a preview chip and a color-correction recipe.
- Add `Look intensity` slider.
- Store selected look metadata inside the color-correction effect params.
- Apply intensity by blending each look recipe from neutral values.

### Tests

- Unit test: look recipe at 0%, 50%, 100% produces expected params.
- Integration test: selecting a look changes renderer filter.
- Integration test: changing intensity updates renderer filter and effect params.
- Export test: manifest frame operation includes the selected look params.

### Completion Criteria

- User can select a look and tune intensity.
- Preview and export JSON agree on the selected look params.

## Step 4: Frame-Derived Palettes

### Implementation

- Use the shared preview media registry read-only.
- Sample the displayed preview video frame when available.
- Generate a small palette from the average frame color using OKLCH helpers.
- Offer text/background/accent suggestions.
- For text clips, `Generate palette from frame` updates text color/background.
- Never seek preview video from this feature.

### Tests

- Unit test: palette generation produces readable text/background pair from sampled RGB data.
- Integration test: clicking `Generate palette from frame` updates text preview styles.
- Profile harness remains available to ensure scope sampling is not degraded.

### Completion Criteria

- Generated palette is based on the displayed frame when possible.
- The feature gracefully falls back when no preview video is ready.
- Text preview/export JSON reflect the generated palette.

## Step 5: Validation And Commit Strategy

### Test Commands

- `npx tsc --noEmit -p tsconfig.video-editor.json`
- `npm run test:video-editor -- <focused tests>`
- `npx playwright test tests/integration/video-editor.spec.ts -g "color grading preview exposes split compare and scopes"`
- `npm test`
- `npm run test:integration`

### Conventional Commits

- `test(render): add preview render operation schema coverage`
- `feat(color): add OKLCH text color controls`
- `feat(color): add look browser intensity controls`
- `feat(color): generate text palettes from preview frame`
