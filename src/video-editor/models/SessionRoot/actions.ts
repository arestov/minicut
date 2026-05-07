import { PROJECT_CREATION_SHAPE } from '../Project'

/** Inline session state patch type – replaces legacy EditorSessionState from domain/types. */
type SessionStateFields = {
	activeProjectId: string | null
	selectedEntityId: string | null
	cursor: number
	isPlaying: boolean
	timelineZoom: number
	activeInspectorTab: 'edit' | 'color' | 'audio' | 'export'
}

type CreateProjectPayload = {
	sourceProjectId?: unknown
	title?: unknown
	fps?: unknown
	width?: unknown
	height?: unknown
	duration?: unknown
	createdAt?: unknown
	updatedAt?: unknown
	tracks?: unknown
}

export type DktSessionActionName =
	| 'createProject'
	| 'selectEntity'
	| 'setActiveProject'
	| 'syncActiveProjectRel'
	| 'syncSelectedClipTrackPosition'
	| 'syncSelectedClipSummary'
	| 'setActiveInspectorTab'
	| 'setCursor'
	| 'setPlaying'
	| 'setTimelineZoom'
	| 'tickPlayback'
	| 'addTextClipToTimeline'
	| 'syncSelectedClipRel'
	| 'togglePlayback'
	| 'zoomTimeline'
	| 'deleteSelectedClip'
	| 'splitSelectedClip'

export type DktSessionActionPatch = Partial<Pick<SessionStateFields,
	| 'activeProjectId'
	| 'selectedEntityId'
	| 'cursor'
	| 'isPlaying'
	| 'timelineZoom'
	| 'activeInspectorTab'
>>

type DktActionDescriptor = {
	to: unknown
	fn: ((payload: unknown) => DktSessionActionPatch | '$noop')
		| readonly [readonly string[], (payload: unknown, ...deps: unknown[]) => DktSessionActionPatch | Record<string, unknown> | '$noop']
		| ((payload: unknown) => Record<string, unknown> | '$noop')
}

type DktActionDefinition = DktActionDescriptor | readonly DktActionDescriptor[]

export const roundToHundredths = (value: number): number => Math.round(value * 100) / 100
export const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value))

const finiteNumber = (payload: unknown): number | null => {
	const value = typeof payload === 'number' ? payload : Number(payload)
	return Number.isFinite(value) ? value : null
}

const asObject = (value: unknown): Record<string, unknown> | null =>
	value && typeof value === 'object' ? value as Record<string, unknown> : null

const asString = (value: unknown): string | null => typeof value === 'string' && value ? value : null
const asNumber = (value: unknown, fallback: number): number => typeof value === 'number' && Number.isFinite(value) ? value : fallback

const normalizeInitialTrack = (value: unknown) => {
	const track = asObject(value)
	const sourceTrackId = asString(track?.sourceTrackId)
	if (!sourceTrackId) {
		return null
	}

	const kind = track?.kind === 'audio' ? 'audio' : 'video'
	return {
		sourceTrackId,
		kind,
		name: asString(track?.name) ?? (kind === 'audio' ? 'A1' : 'V1'),
		muted: typeof track?.muted === 'boolean' ? track.muted : false,
		locked: typeof track?.locked === 'boolean' ? track.locked : false,
		height: asNumber(track?.height, kind === 'audio' ? 64 : 72),
	}
}

const createDefaultTracks = (projectId: string) => [
	{
		sourceTrackId: `${projectId}:track:video`,
		kind: 'video',
		name: 'V1',
		muted: false,
		locked: false,
		height: 72,
	},
	{
		sourceTrackId: `${projectId}:track:audio`,
		kind: 'audio',
		name: 'A1',
		muted: false,
		locked: false,
		height: 64,
	},
]

let createdProjectSequence = 0

const createProjectCreationResult = (payload: unknown) => {
	const value = asObject(payload) as CreateProjectPayload | null
	createdProjectSequence += 1
	const projectId = asString(value?.sourceProjectId) ?? `project:${Date.now().toString(36)}:${createdProjectSequence}:${Math.random().toString(36).slice(2, 7)}`

	const now = Date.now()

	return {
		activeProjectId: projectId,
		selectedEntityId: null,
		cursor: 0,
		createdProject: {
			attrs: {
				sourceProjectId: projectId,
				title: asString(value?.title) ?? `Project ${createdProjectSequence}`,
				fps: asNumber(value?.fps, 30),
				width: asNumber(value?.width, 1920),
				height: asNumber(value?.height, 1080),
				duration: asNumber(value?.duration, 0),
				createdAt: asNumber(value?.createdAt, now),
				updatedAt: asNumber(value?.updatedAt, now),
				autoCreateDefaultTracks: true,
			},
			hold_ref_id: 'createdProject',
		},
		activeProject: { use_ref_id: 'createdProject' },
	}
}

export const reduceSessionSelectEntityAction = (payload: unknown): Pick<SessionStateFields, 'selectedEntityId'> => ({
	selectedEntityId: typeof payload === 'string' ? payload : null,
})

export const reduceSessionSetActiveProjectAction = (payload: unknown): Pick<SessionStateFields, 'activeProjectId' | 'selectedEntityId' | 'cursor'> => ({
	activeProjectId: typeof payload === 'string' ? payload : null,
	selectedEntityId: null,
	cursor: 0,
})

export const reduceSessionSetCursorAction = (payload: unknown): Pick<SessionStateFields, 'cursor'> | null => {
	const value = finiteNumber(payload)
	return value === null ? null : { cursor: Math.max(0, roundToHundredths(value)) }
}

export const reduceSessionSetActiveInspectorTabAction = (payload: unknown): Pick<SessionStateFields, 'activeInspectorTab'> | null => {
	return payload === 'edit' || payload === 'color' || payload === 'audio' || payload === 'export'
		? { activeInspectorTab: payload }
		: null
}

export const reduceSessionSetPlayingAction = (payload: unknown): Pick<SessionStateFields, 'isPlaying'> | null => {
	return typeof payload === 'boolean' ? { isPlaying: payload } : null
}

export const reduceSessionSetTimelineZoomAction = (payload: unknown): Pick<SessionStateFields, 'timelineZoom'> | null => {
	const value = finiteNumber(payload)
	return value === null ? null : { timelineZoom: clamp(value, 8, 96) }
}

export const reduceSessionTogglePlaybackAction = (
	state: Pick<SessionStateFields, 'isPlaying'>,
): Pick<SessionStateFields, 'isPlaying'> => ({
	isPlaying: !state.isPlaying,
})

export const reduceSessionTickPlaybackAction = (
	payload: unknown,
	state: Pick<SessionStateFields, 'cursor' | 'isPlaying'>,
): Pick<SessionStateFields, 'cursor'> | null => {
	if (!state.isPlaying) {
		return null
	}

	const deltaSeconds = finiteNumber((payload as { deltaSeconds?: unknown } | null)?.deltaSeconds)
	return deltaSeconds === null ? null : { cursor: Math.max(0, roundToHundredths(state.cursor + deltaSeconds)) }
}

export const reduceSessionZoomTimelineAction = (
	payload: unknown,
	state: Pick<SessionStateFields, 'timelineZoom'>,
): Pick<SessionStateFields, 'timelineZoom'> | null => {
	const delta = finiteNumber(payload)
	return delta === null ? null : { timelineZoom: clamp(state.timelineZoom + delta, 8, 96) }
}

export const sessionSelectEntityAction = {
	to: {
		selectedEntityId: ['selectedEntityId'],
	},
	fn: reduceSessionSelectEntityAction,
} as const satisfies DktActionDescriptor

export const sessionCreateProjectAction = [
	{
		to: {
			activeProjectId: ['activeProjectId'],
			selectedEntityId: ['selectedEntityId'],
			cursor: ['cursor'],
			createdProject: ['<< $root.project << #', {
				method: 'at_end',
				can_create: true,
				can_hold_refs: true,
				creation_shape: PROJECT_CREATION_SHAPE,
			}],
			activeProject: ['<< activeProject', {
				method: 'set_one',
				can_use_refs: true,
			}],
		},
		fn: createProjectCreationResult,
	},
	{
		to: ['<< activeProject', { action: 'handleInit', inline_subwalker: true }],
		fn: () => ({}),
	},
] as const satisfies DktActionDefinition

export const sessionSetActiveProjectAction = {
	to: {
		activeProjectId: ['activeProjectId'],
		selectedEntityId: ['selectedEntityId'],
		cursor: ['cursor'],
	},
	fn: reduceSessionSetActiveProjectAction,
} as const satisfies DktActionDescriptor

export const sessionSyncActiveProjectRelAction = {
	to: {
		activeProject: ['<< activeProject', { method: 'set_one' }],
	},
	fn: (payload: unknown) => ({
		activeProject: (payload as { project?: unknown } | null)?.project ?? null,
	}),
} as const satisfies DktActionDescriptor

export const sessionSyncSelectedClipRelAction = {
	to: {
		selectedClip: ['<< selectedClip', { method: 'set_one' }],
	},
	fn: (payload: unknown) => ({
		selectedClip: (payload as { clip?: unknown } | null)?.clip ?? null,
	}),
} as const satisfies DktActionDescriptor

export const sessionSyncSelectedClipTrackPositionAction = {
	to: {
		selectedClipTrackPosition: ['selectedClipTrackPosition'],
	},
	fn: (payload: unknown) => ({
		selectedClipTrackPosition: (payload as { position?: unknown } | null)?.position ?? null,
	}),
} as const satisfies DktActionDescriptor

export const sessionSyncSelectedClipSummaryAction = {
	to: {
		selectedClipSummary: ['selectedClipSummary'],
	},
	fn: (payload: unknown) => ({
		selectedClipSummary: (payload as { summary?: unknown } | null)?.summary ?? null,
	}),
} as const satisfies DktActionDescriptor

export const sessionSetCursorAction = {
	to: {
		cursor: ['cursor'],
	},
	fn: (payload: unknown) => reduceSessionSetCursorAction(payload) ?? '$noop',
} as const satisfies DktActionDescriptor

export const sessionSetActiveInspectorTabAction = {
	to: {
		activeInspectorTab: ['activeInspectorTab'],
	},
	fn: (payload: unknown) => reduceSessionSetActiveInspectorTabAction(payload) ?? '$noop',
} as const satisfies DktActionDescriptor

export const sessionSetPlayingAction = {
	to: {
		isPlaying: ['isPlaying'],
	},
	fn: (payload: unknown) => reduceSessionSetPlayingAction(payload) ?? '$noop',
} as const satisfies DktActionDescriptor

export const sessionSetTimelineZoomAction = {
	to: {
		timelineZoom: ['timelineZoom'],
	},
	fn: (payload: unknown) => reduceSessionSetTimelineZoomAction(payload) ?? '$noop',
} as const satisfies DktActionDescriptor

export const sessionTogglePlaybackAction = {
	to: {
		isPlaying: ['isPlaying'],
	},
	fn: [
		['isPlaying'] as const,
		(_payload: unknown, isPlaying: unknown) => reduceSessionTogglePlaybackAction({ isPlaying: Boolean(isPlaying) }),
	],
} as const satisfies DktActionDescriptor

export const sessionTickPlaybackAction = {
	to: {
		cursor: ['cursor'],
	},
	fn: [
		['cursor', 'isPlaying'] as const,
		(payload: unknown, cursor: unknown, isPlaying: unknown) => reduceSessionTickPlaybackAction(payload, {
			cursor: typeof cursor === 'number' ? cursor : 0,
			isPlaying: Boolean(isPlaying),
		}) ?? '$noop',
	],
} as const satisfies DktActionDescriptor

export const sessionZoomTimelineAction = {
	to: {
		timelineZoom: ['timelineZoom'],
	},
	fn: [
		['timelineZoom'] as const,
		(payload: unknown, timelineZoom: unknown) => {
			const current = typeof timelineZoom === 'number' ? timelineZoom : 16
			return reduceSessionZoomTimelineAction(payload, { timelineZoom: current }) ?? '$noop'
		},
	],
} as const satisfies DktActionDescriptor

export const sessionDeleteSelectedClipAction = [
	{
		to: ['<< selectedClip', { action: 'removeSelf', inline_subwalker: true }],
		fn: () => ({}),
	},
	{
		to: {
			selectedEntityId: ['selectedEntityId'],
			selectedClip: ['<< selectedClip', { method: 'set_one' }],
		},
		fn: () => ({
			selectedEntityId: null,
			selectedClip: null,
		}),
	},
] as const satisfies DktActionDefinition

export const sessionSplitSelectedClipAction = [
	{
		to: ['<< selectedClip', { action: 'splitSelfAt', inline_subwalker: true }],
		fn: [
			['cursor'] as const,
			(_payload: unknown, cursor: unknown) => {
				const time = typeof cursor === 'number' && Number.isFinite(cursor) ? roundToHundredths(cursor) : null
				if (time === null) return '$noop'
				return { time }
			},
		],
	},
	{
		to: {
			selectedEntityId: ['selectedEntityId'],
		},
		fn: () => ({ selectedEntityId: null }),
	},
] as const satisfies DktActionDefinition

export const dktSessionActions = {
	createProject: sessionCreateProjectAction,
	selectEntity: sessionSelectEntityAction,
		addTextClipToTimeline: [
			{
				to: ['<< activeProject', { action: 'addTextClipToVideoTrack', inline_subwalker: true }],
				fn: (payload: unknown) => payload as Record<string, unknown>,
			},
			{
				to: {
					selectedEntityId: ['selectedEntityId'],
					selectedClip: ['<< selectedClip', { method: 'set_one', can_use_refs: true }],
				},
				fn: (payload: unknown) => ({
					selectedEntityId: (payload as { sourceClipId?: string } | null)?.sourceClipId ?? null,
					selectedClip: { use_ref_id: 'newTextClip' },
				}),
			},
		],
	setActiveProject: sessionSetActiveProjectAction,
	syncActiveProjectRel: sessionSyncActiveProjectRelAction,
	syncSelectedClipTrackPosition: sessionSyncSelectedClipTrackPositionAction,
	syncSelectedClipSummary: sessionSyncSelectedClipSummaryAction,
	setActiveInspectorTab: sessionSetActiveInspectorTabAction,
	setCursor: sessionSetCursorAction,
	setPlaying: sessionSetPlayingAction,
	setTimelineZoom: sessionSetTimelineZoomAction,
	syncSelectedClipRel: sessionSyncSelectedClipRelAction,
	tickPlayback: sessionTickPlaybackAction,
	togglePlayback: sessionTogglePlaybackAction,
	zoomTimeline: sessionZoomTimelineAction,
	deleteSelectedClip: sessionDeleteSelectedClipAction,
	splitSelectedClip: sessionSplitSelectedClipAction,
} as const satisfies Record<DktSessionActionName, DktActionDefinition>
