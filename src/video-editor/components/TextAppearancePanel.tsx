import type { TextAttrs } from '../models/Text/types'
import { getContrastResult, suggestReadableTextColor } from '../color/oklch'
import { Button } from './ControlPrimitives'
import { FramePaletteAction, type FramePaletteStatus } from './FramePaletteAction'
import { OklchColorField, cssColorToHex, transparentBackgroundFallback } from './OklchColorField'

export const TextAppearancePanel = ({
	text,
	paletteStatus,
	onContentChange,
	onStyleChange,
	onGenerateFramePalette,
}: {
	text: TextAttrs
	paletteStatus: FramePaletteStatus
	onContentChange: (content: string) => void
	onStyleChange: (style: Partial<TextAttrs['style']>) => void
	onGenerateFramePalette: () => void
}) => {
	const textColor = cssColorToHex(text.style.color, '#ffffff')
	const textBackgroundColor = cssColorToHex(text.style.backgroundColor, transparentBackgroundFallback)
	const textContrast = getContrastResult(textColor, textBackgroundColor)

	return (
		<>
			<label className="ve-text-field">
				<span>Content</span>
				<textarea aria-label="Text content" value={text.content} rows={3} onChange={(event) => onContentChange(event.currentTarget.value)} />
			</label>
			<div className="ve-field-grid">
				<label><span>Size</span><input type="number" min="8" max="320" value={text.style.fontSize} onChange={(event) => onStyleChange({ fontSize: Number(event.currentTarget.value) })} /></label>
				<label><span>Weight</span><input type="number" min="100" max="900" step="100" value={text.style.fontWeight} onChange={(event) => onStyleChange({ fontWeight: Number(event.currentTarget.value) })} /></label>
				<label><span>Color</span><input type="color" aria-label="Text color" value={textColor} onChange={(event) => onStyleChange({ color: event.currentTarget.value })} /></label>
				<label><span>Background</span><input type="color" aria-label="Text background color" value={textBackgroundColor} onChange={(event) => onStyleChange({ backgroundColor: event.currentTarget.value })} /></label>
				<label><span>Align</span><select aria-label="Text align" value={text.style.align} onChange={(event) => onStyleChange({ align: event.currentTarget.value as TextAttrs['style']['align'] })}>
					<option value="left">Left</option>
					<option value="center">Center</option>
					<option value="right">Right</option>
				</select></label>
			</div>
			<div className="ve-text-color-feedback" aria-label="Text color feedback">
				<span className={`ve-status-pill ve-status-pill--${textContrast.status}`}>Contrast {textContrast.ratio}:1</span>
				<Button type="button" variant="outline" onClick={() => onStyleChange({ color: suggestReadableTextColor(textColor, textBackgroundColor) })}>Fix contrast</Button>
			</div>
			<FramePaletteAction status={paletteStatus} onGenerate={onGenerateFramePalette} />
			<div className="ve-oklch-panel" aria-label="Advanced OKLCH controls">
				<div className="ve-oklch-panel__header">
					<strong>Advanced OKLCH controls</strong>
					<span>Lightness, chroma, hue</span>
				</div>
				<OklchColorField label="Text color" value={textColor} onChange={(value) => onStyleChange({ color: value })} />
				<OklchColorField label="Text background" value={textBackgroundColor} onChange={(value) => onStyleChange({ backgroundColor: value })} />
			</div>
		</>
	)
}

