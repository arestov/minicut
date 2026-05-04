export type LookParam = 'exposure' | 'contrast' | 'saturation' | 'temperature' | 'hue' | 'gamma'

export interface LookPreset {
	id: string
	label: string
	description: string
	preview: string
	params: Record<LookParam, number>
}

const neutralLookParams: Record<LookParam, number> = {
	exposure: 0,
	contrast: 1,
	saturation: 1,
	temperature: 0,
	hue: 0,
	gamma: 1,
}

export const lookPresets: LookPreset[] = [
	{
		id: 'clean',
		label: 'Clean',
		description: 'Balanced color with a neutral base.',
		preview: 'linear-gradient(135deg, #0f172a 0%, #94a3b8 55%, #f8fafc 100%)',
		params: neutralLookParams,
	},
	{
		id: 'cinema',
		label: 'Cinema',
		description: 'Lower exposure, firmer contrast, cooler hue.',
		preview: 'linear-gradient(135deg, #0b1120 0%, #355070 50%, #f2cc8f 100%)',
		params: { exposure: -0.04, contrast: 1.18, saturation: 0.94, temperature: 0, hue: -4, gamma: 0.98 },
	},
	{
		id: 'golden',
		label: 'Golden',
		description: 'Warm lift with richer saturation.',
		preview: 'linear-gradient(135deg, #1f2937 0%, #d97706 52%, #fef3c7 100%)',
		params: { exposure: 0.08, contrast: 1.08, saturation: 1.18, temperature: 0.35, hue: 5, gamma: 1 },
	},
	{
		id: 'cool',
		label: 'Cool',
		description: 'Crisp blue bias with controlled saturation.',
		preview: 'linear-gradient(135deg, #082f49 0%, #38bdf8 48%, #ecfeff 100%)',
		params: { exposure: 0.02, contrast: 1.1, saturation: 0.9, temperature: -0.4, hue: -12, gamma: 1 },
	},
	{
		id: 'mono',
		label: 'Mono',
		description: 'High-contrast monochrome look.',
		preview: 'linear-gradient(135deg, #09090b 0%, #71717a 52%, #fafafa 100%)',
		params: { exposure: 0, contrast: 1.22, saturation: 0, temperature: 0, hue: 0, gamma: 1.02 },
	},
]

export const getLookPreset = (lookId: string | null | undefined): LookPreset =>
	lookPresets.find((preset) => preset.id === lookId) ?? lookPresets[0]

export const buildLookColorCorrectionParams = (
	lookId: string,
	intensity: number,
): Record<LookParam, number> & { lookId: string; lookIntensity: number } => {
	const preset = getLookPreset(lookId)
	const clampedIntensity = Math.min(1, Math.max(0, intensity))
	return {
		lookId: preset.id,
		lookIntensity: clampedIntensity,
		exposure: neutralLookParams.exposure + (preset.params.exposure - neutralLookParams.exposure) * clampedIntensity,
		contrast: neutralLookParams.contrast + (preset.params.contrast - neutralLookParams.contrast) * clampedIntensity,
		saturation: neutralLookParams.saturation + (preset.params.saturation - neutralLookParams.saturation) * clampedIntensity,
		temperature: neutralLookParams.temperature + (preset.params.temperature - neutralLookParams.temperature) * clampedIntensity,
		hue: neutralLookParams.hue + (preset.params.hue - neutralLookParams.hue) * clampedIntensity,
		gamma: neutralLookParams.gamma + (preset.params.gamma - neutralLookParams.gamma) * clampedIntensity,
	}
}
