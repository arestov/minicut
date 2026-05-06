import type { MiniCutDktResourceSeed, MiniCutDktTrackSeed } from '../../dkt/runtime/createMiniCutDktRuntime'

export type ProjectAddTrackPayload = MiniCutDktTrackSeed
export type ProjectImportResourcePayload = MiniCutDktResourceSeed

const asString = (value: unknown): string | null => typeof value === 'string' ? value : null
const asNumber = (value: unknown): number | null => typeof value === 'number' ? value : null
const asBoolean = (value: unknown): boolean | null => typeof value === 'boolean' ? value : null
const asObject = <Value extends object>(value: unknown): Value | null =>
	value && typeof value === 'object' ? value as Value : null

export const normalizeTrackCreationAttrs = (payload: unknown) => {
	const value = payload as ProjectAddTrackPayload | null
	const sourceTrackId = asString(value?.sourceTrackId)
	if (!sourceTrackId) {
		return null
	}

	return {
		sourceTrackId,
		kind: value.kind === 'audio' ? 'audio' : 'video',
		name: asString(value?.name) ?? 'Track',
		muted: asBoolean(value?.muted) ?? false,
		locked: asBoolean(value?.locked) ?? false,
		height: asNumber(value?.height) ?? 84,
	}
}

export const normalizeResourceCreationAttrs = (payload: unknown) => {
	const value = payload as ProjectImportResourcePayload | null
	const sourceResourceId = asString(value?.sourceResourceId)
	if (!sourceResourceId) {
		return null
	}

	return {
		sourceResourceId,
		sourceProjectId: asString((payload as { sourceProjectId?: unknown } | null)?.sourceProjectId),
		name: asString(value?.name) ?? 'Resource',
		kind: asString(value?.kind) ?? 'video',
		url: asString(value?.url) ?? '',
		mime: asString(value?.mime) ?? 'application/octet-stream',
		duration: asNumber(value?.duration) ?? 0,
		width: asNumber(value?.width),
		height: asNumber(value?.height),
		size: asNumber(value?.size),
		source: asObject(value?.source) ?? { kind: 'local' },
		status: asString(value?.status) ?? 'missing',
		data: asObject(value?.data),
	}
}
