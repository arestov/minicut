import { useId } from 'react'
import { hexToOklch, isOklchInSrgbGamut, oklchToHex, parseHexColor, type OklchValue } from '../color/oklch'

export const transparentBackgroundFallback = '#111827'

export const cssColorToHex = (value: unknown, fallback: string): string => {
	if (typeof value !== 'string') {
		return fallback
	}
	if (parseHexColor(value)) {
		return value.length === 4
			? `#${value[1]}${value[1]}${value[2]}${value[2]}${value[3]}${value[3]}`.toLowerCase()
			: value.toLowerCase()
	}
	return fallback
}

export const OklchColorField = ({
	label,
	value,
	onChange,
	defaultOpen = true,
}: {
	label: string
	value: string
	onChange: (value: string) => void
	defaultOpen?: boolean
}) => {
	const fieldId = useId()
	const oklch = hexToOklch(value) ?? { l: 1, c: 0, h: 0 }
	const updateOklch = (partial: Partial<OklchValue>): void => {
		onChange(oklchToHex({ ...oklch, ...partial }))
	}
	const gamutStatus = isOklchInSrgbGamut(oklch) ? 'Gamut safe' : 'Gamut fitted'

	return (
		<details className="ve-oklch-controls" aria-label={`${label} OKLCH controls`} open={defaultOpen}>
			<summary className="ve-oklch-controls__header">
				<strong>{label} OKLCH</strong>
				<span className="ve-status-pill">{gamutStatus}</span>
			</summary>
			<label className="ve-slider-field" htmlFor={`${fieldId}-lightness`}>
				<span>L {Math.round(oklch.l * 100)}</span>
				<input id={`${fieldId}-lightness`} type="range" aria-label={`${label} lightness`} min="0" max="100" value={Math.round(oklch.l * 100)} onChange={(event) => updateOklch({ l: Number(event.currentTarget.value) / 100 })} />
			</label>
			<label className="ve-slider-field" htmlFor={`${fieldId}-chroma`}>
				<span>C {Math.round(oklch.c * 1000)}</span>
				<input id={`${fieldId}-chroma`} type="range" aria-label={`${label} chroma`} min="0" max="40" value={Math.round(oklch.c * 100)} onChange={(event) => updateOklch({ c: Number(event.currentTarget.value) / 100 })} />
			</label>
			<label className="ve-slider-field" htmlFor={`${fieldId}-hue`}>
				<span>H {Math.round(oklch.h)}</span>
				<input id={`${fieldId}-hue`} type="range" aria-label={`${label} hue`} min="0" max="360" value={Math.round(oklch.h)} onChange={(event) => updateOklch({ h: Number(event.currentTarget.value) })} />
			</label>
		</details>
	)
}
