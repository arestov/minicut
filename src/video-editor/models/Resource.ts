import { model } from 'dkt/model.js'

export const RESOURCE_CREATION_SHAPE = {
	attrs: ['sourceResourceId', 'sourceProjectId', 'name', 'kind', 'url', 'mime', 'duration', 'width', 'height', 'size', 'source', 'status', 'data'],
} as const

export const Resource = model({
	model_name: 'minicut_resource',
	attrs: {
		sourceResourceId: ['input', ''],
		sourceProjectId: ['input', null],
		name: ['input', 'Resource'],
		kind: ['input', 'video'],
		url: ['input', ''],
		mime: ['input', 'application/octet-stream'],
		duration: ['input', 0],
		width: ['input', null],
		height: ['input', null],
		size: ['input', null],
		source: ['input', { kind: 'local' }],
		status: ['input', 'missing'],
		data: ['input', null],
		timelineAddRequest: ['input', null],
		isReady: ['comp', ['status'], (status: unknown) => status === 'ready'],
		timelineClipSource: ['comp', ['sourceResourceId', 'name', 'kind', 'duration'] as const,
			(sourceResourceId: unknown, name: unknown, kind: unknown, duration: unknown) => ({
				sourceResourceId: typeof sourceResourceId === 'string' ? sourceResourceId : '',
				name: typeof name === 'string' ? name : 'Resource',
				kind: typeof kind === 'string' ? kind : 'video',
				duration: typeof duration === 'number' && Number.isFinite(duration) ? duration : 0,
			})],
		renderSummary: ['comp', ['name', 'kind', 'url', 'mime', 'duration'] as const,
			(name: unknown, kind: unknown, url: unknown, mime: unknown, duration: unknown) => ({
				name: typeof name === 'string' ? name : 'Resource',
				kind: typeof kind === 'string' ? kind : 'video',
				url: typeof url === 'string' ? url : '',
				mime: typeof mime === 'string' ? mime : 'application/octet-stream',
				duration: typeof duration === 'number' && Number.isFinite(duration) ? duration : 0,
			})],
	},
	rels: {
		project: ['input', { linking: '<< project << #' }],
		clips: ['input', { many: true, linking: '<< clip << #' }],
	},
	actions: {
		renameResource: {
			to: {
				name: ['name'],
			},
			fn: (payload: unknown) => {
				const name = typeof payload === 'string'
					? payload
					: (payload as { name?: unknown } | null)?.name
				return typeof name === 'string' && name ? { name } : '$noop'
			},
		},
		setResourceStatus: {
			to: {
				status: ['status'],
			},
			fn: (payload: unknown) => {
				const status = typeof payload === 'string'
					? payload
					: (payload as { status?: unknown } | null)?.status
				return status === 'missing' || status === 'partial' || status === 'ready' || status === 'loading' || status === 'error'
					? { status }
					: '$noop'
			},
		},
		setResourceAttrs: {
			to: {
				sourceResourceId: ['sourceResourceId'],
				sourceProjectId: ['sourceProjectId'],
				name: ['name'],
				kind: ['kind'],
				url: ['url'],
				mime: ['mime'],
				duration: ['duration'],
				width: ['width'],
				height: ['height'],
				size: ['size'],
				source: ['source'],
				status: ['status'],
				data: ['data'],
			},
			fn: (payload: unknown) => {
				const value = payload as Record<string, unknown> | null
				if (!value || typeof value !== 'object') {
					return '$noop'
				}

				return {
					sourceResourceId: typeof value.sourceResourceId === 'string' ? value.sourceResourceId : '',
					sourceProjectId: typeof value.sourceProjectId === 'string' ? value.sourceProjectId : null,
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
			},
		},
		requestAddToTimeline: {
			to: {
				timelineAddRequest: ['timelineAddRequest'],
			},
			fn: (payload: unknown) => ({
				timelineAddRequest: {
					resourceId: typeof (payload as { resourceId?: unknown } | null)?.resourceId === 'string'
						? (payload as { resourceId: string }).resourceId
						: null,
					requestedAt: Date.now(),
				},
			}),
		},
		setProject: {
			to: {
				project: ['<< project', { method: 'set_one' }],
			},
			fn: (payload: unknown) => ({
				project: (payload as { project?: unknown } | null)?.project ?? null,
			}),
		},
		setClips: {
			to: {
				clips: ['<< clips', { method: 'set_many' }],
			},
			fn: (payload: unknown) => ({
				clips: Array.isArray((payload as { clips?: unknown } | null)?.clips)
					? (payload as { clips: unknown[] }).clips
					: [],
			}),
		},
	},
})
