import type { ColorCorrectionAttrs, EffectAttrs } from '../domain/types'

export interface EffectRenderInstruction {
	kind: EffectAttrs['kind']
	name: string
	enabled: boolean
	amount?: number
	params?: Record<string, unknown>
}

const finiteOr = (value: unknown, fallback: number): number =>
	typeof value === 'number' && Number.isFinite(value) ? value : fallback

const scalarValue = (value: unknown, fallback: number): number => {
	if (value && typeof value === 'object' && 'value' in value) {
		return finiteOr((value as { value?: unknown }).value, fallback)
	}

	return finiteOr(value, fallback)
}

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value))

export const toEffectRenderInstruction = (attrs: EffectAttrs): EffectRenderInstruction => ({
	kind: attrs.kind,
	name: attrs.name,
	enabled: attrs.enabled !== false,
	...(attrs.amount !== undefined ? { amount: attrs.amount } : {}),
	...(attrs.params ? { params: attrs.params as Record<string, unknown> } : {}),
})

export const getEffectInstructionFilter = (effect: EffectRenderInstruction): string => {
	if (!effect.enabled) {
		return ''
	}

	const amount = clamp(effect.amount ?? 1, 0, 1)
	if (effect.kind === 'blur') {
		return `blur(${Math.round(amount * 24) / 4}px)`
	}
	if (effect.kind === 'sharpen') {
		return `contrast(${1 + amount}) saturate(${1 + amount * 0.5})`
	}
	if (effect.kind === 'tint') {
		return `sepia(${amount}) saturate(${1 + amount})`
	}
	if (effect.kind === 'vignette') {
		return `brightness(${1 - amount * 0.15}) contrast(${1 + amount * 0.15})`
	}
	if (effect.kind === 'color-correction') {
		const params = (effect.params ?? {}) as Partial<ColorCorrectionAttrs>
		const exposure = scalarValue(params.exposure, 0)
		const contrast = scalarValue(params.contrast, 1)
		const saturation = scalarValue(params.saturation, 1)
		const hue = scalarValue(params.hue, 0)
		const gamma = scalarValue(params.gamma, 1)
		const brightness = clamp(1 + exposure, 0, 3)
		const contrastValue = clamp(contrast * gamma, 0, 4)
		const saturationValue = clamp(saturation, 0, 4)

		return `brightness(${brightness}) contrast(${contrastValue}) saturate(${saturationValue}) hue-rotate(${hue}deg)`
	}

	return ''
}

export const mergeEffectFilters = (effects: EffectRenderInstruction[]): string =>
	effects.map(getEffectInstructionFilter).filter(Boolean).join(' ')
