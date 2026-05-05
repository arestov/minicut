import type { MiniCutDktResourceProxyInput, MiniCutDktTrackProxyInput } from '../../dkt/runtime/createMiniCutDktRuntime'

export type ProjectAddTrackPayload = MiniCutDktTrackProxyInput
export type ProjectImportResourcePayload = MiniCutDktResourceProxyInput

export const normalizeTrackCreationAttrs = (payload: unknown) => {
	const value = payload as ProjectAddTrackPayload | null
	if (typeof value?.sourceTrackId !== 'string' || !value.sourceTrackId) {
		return null
	}

	return {
		sourceTrackId: value.sourceTrackId,
		kind: value.kind === 'audio' ? 'audio' : 'video',
		name: typeof value.name === 'string' ? value.name : 'Track',
		muted: typeof value.muted === 'boolean' ? value.muted : false,
		locked: typeof value.locked === 'boolean' ? value.locked : false,
		height: typeof value.height === 'number' ? value.height : 84,
	}
}

export const normalizeResourceCreationAttrs = (payload: unknown) => {
	const value = payload as ProjectImportResourcePayload | null
	if (typeof value?.sourceResourceId !== 'string' || !value.sourceResourceId) {
		return null
	}

	return {
		sourceResourceId: value.sourceResourceId,
		name: typeof value.name === 'string' ? value.name : 'Resource',
		kind: typeof value.kind === 'string' ? value.kind : 'video',
		url: typeof value.url === 'string' ? value.url : '',
		mime: typeof value.mime === 'string' ? value.mime : 'application/octet-stream',
		duration: typeof value.duration === 'number' ? value.duration : 0,
		width: typeof value.width === 'number' ? value.width : null,
		height: typeof value.height === 'number' ? value.height : null,
		size: typeof value.size === 'number' ? value.size : null,
		source: value.source && typeof value.source === 'object' ? value.source : { kind: 'local' },
		status: typeof value.status === 'string' ? value.status : 'missing',
		data: value.data && typeof value.data === 'object' ? value.data : null,
	}
}
