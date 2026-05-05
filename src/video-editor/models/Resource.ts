import { model } from 'dkt/model.js'

export const RESOURCE_PROXY_CREATION_SHAPE = {
	attrs: ['sourceResourceId', 'name', 'kind', 'url', 'mime', 'duration', 'width', 'height', 'size', 'source', 'status', 'data'],
} as const

export const Resource = model({
	model_name: 'minicut_resource',
	attrs: {
		sourceResourceId: ['input', ''],
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
		isReady: ['comp', ['status'], (status: unknown) => status === 'ready'],
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
	},
})