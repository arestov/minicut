/**
 * Local type declarations for the Effect model.
 * Migrated from domain/types.ts in the DKT hard rewrite.
 */

export interface OklchColor {
	l: number
	c: number
	h: number
	alpha: number
	gamut?: 'srgb' | 'p3'
}

export interface ColorCorrectionAttrs {
	exposure: { value: number; keyframes?: string[] }
	contrast: { value: number; keyframes?: string[] }
	highlights: { value: number; keyframes?: string[] }
	shadows: { value: number; keyframes?: string[] }
	saturation: { value: number; keyframes?: string[] }
	vibrance: { value: number; keyframes?: string[] }
	temperature: { value: number; keyframes?: string[] }
	tint: { value: number; keyframes?: string[] }
	hue: { value: number; keyframes?: string[] }
	gamma: { value: number; keyframes?: string[] }
}

export type EffectKind = 'blur' | 'sharpen' | 'tint' | 'color-correction' | 'vignette' | 'lut'

export interface EffectAttrs {
	name: string
	kind: EffectKind
	enabled: boolean
	amount?: number
	params?: Partial<ColorCorrectionAttrs> | Record<string, unknown>
	color?: OklchColor
}
