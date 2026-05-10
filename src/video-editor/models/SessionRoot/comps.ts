import { createPreviewFrame, lookupPreviewBufferFrame, type PreviewBuffer, type PreviewFrame, type PreviewStructure } from '../../read-model/previewComps'

const DEFAULT_PREVIEW_STRUCTURE: PreviewStructure = { clipSources: [] }

export const reducePreviewStructure = (previewClipSources: unknown): PreviewStructure => {
	if (previewClipSources && typeof previewClipSources === 'object' && Array.isArray((previewClipSources as PreviewStructure).clipSources)) {
		return previewClipSources as PreviewStructure
	}
	return DEFAULT_PREVIEW_STRUCTURE
}

export const reducePreviewFrame = (
	previewStructure: unknown,
	cursor: unknown,
	previewBuffer: unknown,
	isPlaying: unknown,
): PreviewFrame => {
	const time = typeof cursor === 'number' && Number.isFinite(cursor) ? cursor : 0
	if (isPlaying) {
		const buffered = lookupPreviewBufferFrame(previewBuffer as PreviewBuffer | null, time)
		if (buffered) return buffered
	}
	return createPreviewFrame(
		previewStructure && typeof previewStructure === 'object' && Array.isArray((previewStructure as { clipSources?: unknown }).clipSources)
			? previewStructure as PreviewStructure
			: DEFAULT_PREVIEW_STRUCTURE,
		time,
	)
}

export const reduceSelectedClip = (clips: unknown, selectedEntityId: unknown) => {
	if (typeof selectedEntityId !== 'string' || !selectedEntityId) return null
	const modelList = Array.isArray(clips) ? clips : []

	for (const clipModel of modelList) {
		if (!clipModel || typeof clipModel !== 'object') {
			continue
		}
		const nodeId = (clipModel as { _node_id?: unknown; _nodeId?: unknown })._node_id
		const nodeIdCamel = (clipModel as { _node_id?: unknown; _nodeId?: unknown })._nodeId
		if (
			(typeof nodeId === 'string' && nodeId === selectedEntityId)
			|| (typeof nodeIdCamel === 'string' && nodeIdCamel === selectedEntityId)
		) {
			return clipModel
		}
	}

	return null
}
