import { defaultTextBox, defaultTextStyle } from '../Text/defaults'

export const reduceCreateProjectModel = (payload: unknown) => {
	const value = payload as {
		sourceProjectId?: unknown
		title?: unknown
		fps?: unknown
		width?: unknown
		height?: unknown
		duration?: unknown
		createdAt?: unknown
		updatedAt?: unknown
		tracks?: unknown
		autoCreateDefaultTracks?: unknown
	} | null
	if (typeof value?.sourceProjectId !== 'string' || !value.sourceProjectId) {
		return '$noop'
	}

	const tracks = Array.isArray(value.tracks)
		? value.tracks.map((track) => {
			const item = track as { sourceTrackId?: unknown; kind?: unknown; name?: unknown; muted?: unknown; locked?: unknown; height?: unknown } | null
			return typeof item?.sourceTrackId === 'string' && item.sourceTrackId
				? {
					attrs: {
						sourceTrackId: item.sourceTrackId,
						kind: item.kind === 'audio' ? 'audio' : 'video',
						name: typeof item.name === 'string' ? item.name : 'Track',
						muted: typeof item.muted === 'boolean' ? item.muted : false,
						locked: typeof item.locked === 'boolean' ? item.locked : false,
						height: typeof item.height === 'number' ? item.height : 84,
					},
				}
				: null
		}).filter((track): track is { attrs: { sourceTrackId: string; kind: 'audio' | 'video'; name: string; muted: boolean; locked: boolean; height: number } } => Boolean(track))
		: []

	return {
		attrs: {
			sourceProjectId: value.sourceProjectId,
			title: typeof value.title === 'string' ? value.title : 'Untitled project',
			fps: typeof value.fps === 'number' ? value.fps : 30,
			width: typeof value.width === 'number' ? value.width : 1920,
			height: typeof value.height === 'number' ? value.height : 1080,
			duration: typeof value.duration === 'number' ? value.duration : 0,
			createdAt: typeof value.createdAt === 'number' ? value.createdAt : 0,
			updatedAt: typeof value.updatedAt === 'number' ? value.updatedAt : 0,
			autoCreateDefaultTracks: value.autoCreateDefaultTracks === true,
		},
		rels: tracks.length > 0 ? { tracks } : undefined,
	}
}

export const reduceCreateTrackModel = (payload: unknown) => {
	const value = payload as { sourceTrackId?: unknown; kind?: unknown; name?: unknown; muted?: unknown; locked?: unknown; height?: unknown } | null
	if (typeof value?.sourceTrackId !== 'string' || !value.sourceTrackId) {
		return '$noop'
	}

	return {
		attrs: {
			sourceTrackId: value.sourceTrackId,
			kind: value.kind === 'audio' ? 'audio' : 'video',
			name: typeof value.name === 'string' ? value.name : 'Track',
			muted: typeof value.muted === 'boolean' ? value.muted : false,
			locked: typeof value.locked === 'boolean' ? value.locked : false,
			height: typeof value.height === 'number' ? value.height : 84,
		},
	}
}

export const reduceCreateResourceModel = (payload: unknown) => {
	const value = payload as {
		sourceResourceId?: unknown
		name?: unknown
		kind?: unknown
		url?: unknown
		mime?: unknown
		duration?: unknown
		width?: unknown
		height?: unknown
		size?: unknown
		source?: unknown
		status?: unknown
		data?: unknown
	} | null
	if (typeof value?.sourceResourceId !== 'string' || !value.sourceResourceId) {
		return '$noop'
	}

	return {
		attrs: {
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
		},
	}
}

export const reduceCreateTextModel = (payload: unknown) => {
	const value = payload as { sourceTextId?: unknown; content?: unknown; style?: unknown; box?: unknown } | null
	if (typeof value?.sourceTextId !== 'string' || !value.sourceTextId) {
		return '$noop'
	}

	return {
		attrs: {
			sourceTextId: value.sourceTextId,
			content: typeof value.content === 'string' ? value.content : 'Text',
			style: value.style && typeof value.style === 'object' ? value.style : defaultTextStyle,
			box: value.box && typeof value.box === 'object' ? value.box : defaultTextBox,
		},
	}
}

export const reduceCreateEffectModel = (payload: unknown) => {
	const value = payload as {
		sourceEffectId?: unknown
		name?: unknown
		kind?: unknown
		enabled?: unknown
		amount?: unknown
		params?: unknown
		color?: unknown
	} | null
	if (typeof value?.sourceEffectId !== 'string' || !value.sourceEffectId) {
		return '$noop'
	}

	return {
		attrs: {
			sourceEffectId: value.sourceEffectId,
			name: typeof value.name === 'string' ? value.name : 'Effect',
			kind: typeof value.kind === 'string' ? value.kind : 'blur',
			enabled: typeof value.enabled === 'boolean' ? value.enabled : true,
			amount: typeof value.amount === 'number' ? value.amount : null,
			params: value.params && typeof value.params === 'object' ? value.params : null,
			color: value.color && typeof value.color === 'object' ? value.color : null,
		},
	}
}

export const reduceCreateClipModel = (payload: unknown) => {
	const value = payload as {
		sourceClipId?: unknown
		sourceResourceId?: unknown
		sourceTextId?: unknown
		name?: unknown
		color?: unknown
		mediaKind?: unknown
		start?: unknown
		in?: unknown
		duration?: unknown
		fadeIn?: unknown
		fadeOut?: unknown
		audio?: unknown
		opacity?: unknown
		transform?: unknown
	} | null
	if (typeof value?.sourceClipId !== 'string' || !value.sourceClipId) {
		return '$noop'
	}

	return {
		attrs: {
			sourceClipId: value.sourceClipId,
			sourceResourceId: typeof value.sourceResourceId === 'string' ? value.sourceResourceId : null,
			sourceTextId: typeof value.sourceTextId === 'string' ? value.sourceTextId : null,
			name: typeof value.name === 'string' ? value.name : 'Clip',
			color: typeof value.color === 'string' ? value.color : '#2563eb',
			mediaKind: typeof value.mediaKind === 'string' ? value.mediaKind : null,
			start: typeof value.start === 'number' ? value.start : 0,
			in: typeof value.in === 'number' ? value.in : 0,
			duration: typeof value.duration === 'number' ? value.duration : 0,
			fadeIn: typeof value.fadeIn === 'number' ? value.fadeIn : 0,
			fadeOut: typeof value.fadeOut === 'number' ? value.fadeOut : 0,
			audio: value.audio && typeof value.audio === 'object' ? value.audio : { gain: 1, pan: 0 },
			opacity: value.opacity && typeof value.opacity === 'object' ? value.opacity : { value: 1 },
			transform: value.transform && typeof value.transform === 'object'
				? value.transform
				: {
					x: { value: 0 },
					y: { value: 0 },
					scale: { value: 1 },
					rotation: { value: 0 },
				},
		},
	}
}

export const reduceSetActiveProjectHint = (payload: unknown) => ({
	activeProjectHint: typeof payload === 'string' && payload ? payload : null,
})
