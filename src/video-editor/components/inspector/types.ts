import type { ColorCorrectionAttrs, EditorSessionState, ResourceAttrs, TextAttrs, TransformAttrs, AnimatedScalar } from '../../domain/types'
import type { ExportProgressEvent, ExportRenderResult } from '../../render/exportRenderer'
import type { LookParam } from '../../color/looks'

export type InspectorTab = EditorSessionState['activeInspectorTab']

export type ExportStatus =
	| { state: 'idle' }
	| { state: 'rendering'; progress: ExportProgressEvent }
	| { state: 'ready'; result: ExportRenderResult }
	| { state: 'error'; message: string }

const exportStageLabel: Record<ExportProgressEvent['stage'], string> = {
	queued: 'queued',
	rendering: 'rendering',
	finalizing: 'finalizing',
	done: 'done',
}

export const formatExportProgress = (event: ExportProgressEvent): string => {
	const progressPercent = Math.round(Math.max(0, Math.min(1, event.progress)) * 100)
	return `${exportStageLabel[event.stage]} ${progressPercent}%`
}

export const inspectorTabs: Array<{ id: InspectorTab, label: string }> = [
	{ id: 'edit', label: 'Edit' },
	{ id: 'color', label: 'Color' },
	{ id: 'audio', label: 'Audio' },
	{ id: 'export', label: 'Export' },
]

export type PrimaryColorParam = keyof Pick<ColorCorrectionAttrs, 'exposure' | 'contrast' | 'saturation' | 'temperature'>
export type ColorParamKey = PrimaryColorParam | LookParam

export const defaultColorCorrectionParams: Record<PrimaryColorParam, AnimatedScalar> = {
	exposure: { value: 0 },
	contrast: { value: 1 },
	saturation: { value: 1 },
	temperature: { value: 0 },
}

export const colorGradePresets: Array<{ id: string, label: string, params: Partial<Record<PrimaryColorParam, number>> }> = [
	{ id: 'neutral', label: 'Neutral', params: { exposure: 0, contrast: 1, saturation: 1, temperature: 0 } },
	{ id: 'warm', label: 'Warm', params: { exposure: 0.12, contrast: 1.08, saturation: 1.15, temperature: 0.22 } },
	{ id: 'cool', label: 'Cool', params: { exposure: 0.05, contrast: 1.04, saturation: 0.92, temperature: -0.2 } },
	{ id: 'punch', label: 'Punch', params: { exposure: 0.08, contrast: 1.2, saturation: 1.35, temperature: 0 } },
]

export interface ClipRenderAttrs {
	name?: unknown
	color?: unknown
	start?: unknown
	duration?: unknown
	in?: unknown
	fadeIn?: unknown
	fadeOut?: unknown
	opacity?: AnimatedScalar
	transform?: TransformAttrs
	audio?: { gain: number; pan: number }
	mediaKind?: ResourceAttrs['kind']
}

export interface ResourceRenderAttrs {
	kind?: ResourceAttrs['kind']
	url?: unknown
	name?: unknown
}

export interface TextRenderAttrs {
	content?: TextAttrs['content']
	style?: TextAttrs['style']
	box?: TextAttrs['box']
}

export const getTextAttrs = (attrs: TextRenderAttrs): TextAttrs | null => {
	if (typeof attrs.content !== 'string' || !attrs.style || !attrs.box) {
		return null
	}

	return {
		content: attrs.content,
		style: attrs.style,
		box: attrs.box,
	}
}
