export const reduceRenameResource = (payload: unknown) => {
	const name = typeof payload === 'string'
		? payload
		: (payload as { name?: unknown } | null)?.name
	return typeof name === 'string' && name ? { name } : '$noop'
}

export const reduceSetResourceStatus = (payload: unknown) => {
	const status = typeof payload === 'string'
		? payload
		: (payload as { status?: unknown } | null)?.status
	return status === 'missing' || status === 'partial' || status === 'ready' || status === 'loading' || status === 'error'
		? { status }
		: '$noop'
}

export const reduceSetResourceAttrs = (payload: unknown) => {
	const value = payload as Record<string, unknown> | null
	if (!value || typeof value !== 'object') {
		return '$noop'
	}

	return {
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

export const reduceRequestAddToTimeline = (payload: unknown) => ({
	timelineAddRequest: {
		resourceId: typeof (payload as { resourceId?: unknown } | null)?.resourceId === 'string'
			? (payload as { resourceId: string }).resourceId
			: null,
		requestedAt: Date.now(),
	},
})

export const reduceSetProjectRef = (payload: unknown) => ({
	project: (payload as { project?: unknown } | null)?.project ?? null,
})

export const reduceSetClipsRef = (payload: unknown) => ({
	clips: Array.isArray((payload as { clips?: unknown } | null)?.clips)
		? (payload as { clips: unknown[] }).clips
		: [],
})
