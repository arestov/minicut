# OKLCH Color Interface Plan

## Context

This plan is based on the Evil Martians article "Exploring the OKLCH ecosystem and its tools" and the current minicut color toolset: primary correction sliders, grade presets, split compare, and live scopes.

The article's useful interface lesson is not simply "use OKLCH strings". The stronger pattern is to expose color as predictable perceptual controls: lightness, chroma, and hue, with accessibility and gamut feedback close to the controls that create the color.

## Product Goal

Make minicut color controls feel more predictable for users who are not color scientists, while giving advanced users a path toward more precise look creation.

The color UI should help users answer four questions quickly:

1. Is this look brighter or darker?
2. Is this look more or less colorful?
3. Which hue direction am I pushing?
4. Is this color choice safe for readable overlays and UI-like text?

## Recommended Patterns From The OKLCH Ecosystem

### 1. Perceptual Controls Instead Of Raw HEX-First Editing

OKLCH makes lightness, chroma, and hue independently adjustable in a way users can reason about. For minicut, this maps well to:

- `Lightness` for text, background, and generated look chips.
- `Chroma` for vividness of a color swatch or look accent.
- `Hue` for controlled color direction changes.

Do not replace familiar video controls like Exposure, Contrast, Saturation, and Temperature. Instead, use OKLCH for color selection surfaces: text color, text background, clip label color, look accent color, and future theme/look generation.

### 2. Gamut-Safe Feedback

OKLCH can describe colors outside sRGB. The UI should show when a selected color is clipped or out of the export target gamut.

Recommended interface pattern:

- Show a small `sRGB safe` / `clipped` status beside OKLCH swatches.
- If clipped, offer a one-click `Fit chroma` action that preserves hue and lightness while reducing chroma.
- Keep the user on the same hue instead of silently shifting color.

### 3. APCA-Aware Contrast Near Text Controls

The article highlights APCA-focused tools like Harmonizer, apcach, and Polychrom. For minicut, this is most relevant to text overlays.

Recommended interface pattern:

- In the Text inspector, show contrast between text color and background color.
- Use a simple status: `Readable`, `Low contrast`, `Unsafe`.
- Add `Fix contrast` suggestions that adjust OKLCH lightness first, then chroma if needed.
- Preserve hue unless the user explicitly chooses a different hue.

This is more valuable than a detached accessibility report because the feedback appears at the moment the user chooses overlay colors.

### 4. Harmonized Palettes For Looks And Text Overlays

The Harmonizer pattern is useful for generated palettes with consistent chroma and contrast. In minicut, this can power:

- Matching text/background pairs for captions.
- Look accent palettes derived from the current frame.
- Project-level color themes for titles, labels, and overlays.

Recommended interface pattern:

- `Generate from frame` button in Color/Text tools.
- Extract dominant colors from the current preview frame.
- Convert to OKLCH.
- Normalize lightness/chroma into readable swatches.
- Provide 4-6 swatches: text, background, accent, muted, warning, highlight.

### 5. Educational UI Without Getting In The Way

OKLCH tooling often teaches through interaction: users see what lightness/chroma/hue do. For minicut, avoid long explanations in the app, but make controls self-evident.

Recommended interface pattern:

- Use three compact controls labeled `Light`, `Color`, and `Hue` in simple mode.
- Show exact `oklch(...)` only in an advanced disclosure.
- Keep HEX copy available because users still expect it.

## Proposed Minicut Features

### Phase 1: OKLCH Text Color Controls

Scope:

- Add OKLCH-backed text color and background color editor.
- Keep existing color input as a fallback/simple picker.
- Add contrast status and `Fix contrast` action.
- Add gamut status for selected colors.

Why first:

- It directly improves the current Text inspector.
- It is easier to test than video LUT processing.
- It demonstrates OKLCH value where users feel pain: readable overlays.

Tests:

- Unit tests for OKLCH conversion and gamut fitting.
- Unit tests for contrast suggestions preserving hue.
- Integration test: changing text/background shows contrast status and updates preview text.

### Phase 2: Look Browser With OKLCH-Guided Thumbnails

Scope:

- Add a `Looks` strip to the Color inspector.
- Each look has a live thumbnail generated from the current preview frame.
- Each look exposes `Intensity`.
- OKLCH is used for accent/chip generation and perceptual ordering, not necessarily as the full video grade math yet.

Why second:

- This is the most visually effective color UX improvement.
- The current scopes and split compare already support the workflow.
- The shared preview frame sampler can support thumbnail generation.

Tests:

- Integration test: selecting a look updates preview filter/effect state.
- Integration test: intensity changes the rendered filter output.
- Performance profile: thumbnail generation does not reduce playback scope cadence below target.

### Phase 3: Frame-Derived Palette Suggestions

Scope:

- Add `Generate palette from frame` in Text and Color tools.
- Use the currently displayed preview frame as the source of truth.
- Convert sampled colors to OKLCH and harmonize lightness/chroma.
- Offer text/background/accent pairs.

Why third:

- It uses the same architectural idea as shared preview-video sampling.
- It makes overlays feel integrated with footage.
- It keeps palette suggestions stable and explainable.

Tests:

- Unit tests for palette normalization.
- Integration test: generated text/background pair updates overlay preview and passes contrast threshold.

### Phase 4: Advanced OKLCH Panel

Scope:

- Add advanced disclosure for exact OKLCH values.
- Add copy buttons for OKLCH, HEX, RGB.
- Add gamut target selector: sRGB first, Display-P3 later.

Why later:

- Most users need predictable controls before exact color notation.
- This avoids making the UI feel like a developer tool too early.

## Non-Goals

- Do not replace video-grade controls with OKLCH terminology.
- Do not make users understand APCA math.
- Do not introduce full color management before export/render paths can preserve it correctly.
- Do not use OKLCH as a hidden excuse to make the UI more complex.

## Implementation Notes

- Prefer a small color module under `src/video-editor/color` or `src/video-editor/render` for OKLCH conversion and gamut helpers.
- Keep UI components small: `OklchColorField`, `ContrastBadge`, `GamutBadge`, `PaletteSuggestionStrip`.
- Use the shared preview media/frame sampling path for frame-derived palettes and look thumbnails.
- Cache generated thumbnails by `(clipId, displayedFrameTime, lookId, intensity)`.
- Keep all expensive frame analysis opt-in and inactive unless the relevant inspector panel is visible.

## Recommended Next Step

Implement Phase 1 first: OKLCH-backed text color/background controls with contrast and gamut feedback.

It is the smallest high-value change that uses the article's strongest interface ideas, improves an existing minicut workflow, and creates reusable color infrastructure for the later Look Browser and frame-derived palettes.
