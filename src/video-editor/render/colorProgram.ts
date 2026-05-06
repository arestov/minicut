import type { ColorCorrectionAttrs } from './registryTypes'
import type { EffectRenderInstruction } from './colorPipeline'

export type ColorProgramOperation =
	| { type: 'brightness'; value: number }
	| { type: 'contrast'; value: number }
	| { type: 'saturate'; value: number }
	| { type: 'hue-rotate'; value: number }
	| { type: 'sepia'; value: number }
	| { type: 'blur'; value: number }

export interface ColorProgram {
	effectKind: EffectRenderInstruction['kind']
	enabled: boolean
	operations: ColorProgramOperation[]
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
const round = (value: number, precision = 4): number => Number(value.toFixed(precision))

export const compileEffectColorProgram = (effect: EffectRenderInstruction): ColorProgram => {
	if (!effect.enabled) {
		return { effectKind: effect.kind, enabled: false, operations: [] }
	}

	const amount = clamp(effect.amount ?? 1, 0, 1)
	if (effect.kind === 'blur') {
		return { effectKind: effect.kind, enabled: true, operations: [{ type: 'blur', value: Math.round(amount * 24) / 4 }] }
	}
	if (effect.kind === 'sharpen') {
		return {
			effectKind: effect.kind,
			enabled: true,
			operations: [
				{ type: 'contrast', value: 1 + amount },
				{ type: 'saturate', value: 1 + amount * 0.5 },
			],
		}
	}
	if (effect.kind === 'tint') {
		return {
			effectKind: effect.kind,
			enabled: true,
			operations: [
				{ type: 'sepia', value: amount },
				{ type: 'saturate', value: 1 + amount },
			],
		}
	}
	if (effect.kind === 'vignette') {
		return {
			effectKind: effect.kind,
			enabled: true,
			operations: [
				{ type: 'brightness', value: round(1 - amount * 0.15) },
				{ type: 'contrast', value: round(1 + amount * 0.15) },
			],
		}
	}
	if (effect.kind === 'color-correction') {
		const params = (effect.params ?? {}) as Partial<ColorCorrectionAttrs>
		const exposure = scalarValue(params.exposure, 0)
		const contrast = scalarValue(params.contrast, 1)
		const saturation = scalarValue(params.saturation, 1)
		const hue = scalarValue(params.hue, 0)
		const gamma = scalarValue(params.gamma, 1)
		const temperature = scalarValue(params.temperature, 0)
		const brightness = clamp(1 + exposure, 0, 3)
		const contrastValue = clamp(contrast * gamma, 0, 4)
		const saturationValue = clamp(saturation + Math.max(0, temperature) * 0.08, 0, 4)
		const hueValue = hue + Math.min(0, temperature) * 18
		const sepiaValue = clamp(Math.max(0, temperature) * 0.25, 0, 1)
		return {
			effectKind: effect.kind,
			enabled: true,
			operations: [
				{ type: 'brightness', value: round(brightness) },
				{ type: 'contrast', value: round(contrastValue) },
				{ type: 'saturate', value: round(saturationValue) },
				...(sepiaValue > 0 ? [{ type: 'sepia' as const, value: round(sepiaValue) }] : []),
				{ type: 'hue-rotate', value: round(hueValue, 2) },
			],
		}
	}

	return { effectKind: effect.kind, enabled: true, operations: [] }
}

export const colorProgramOperationToCss = (operation: ColorProgramOperation): string => {
	if (operation.type === 'hue-rotate') {
		return `hue-rotate(${operation.value}deg)`
	}
	if (operation.type === 'blur') {
		return `blur(${operation.value}px)`
	}
	return `${operation.type}(${operation.value})`
}

export const colorProgramToCssFilter = (program: ColorProgram): string =>
	program.enabled ? program.operations.map(colorProgramOperationToCss).filter(Boolean).join(' ') : ''

export const mergeColorProgramCssFilters = (programs: ColorProgram[]): string =>
	programs.map(colorProgramToCssFilter).filter(Boolean).join(' ')
