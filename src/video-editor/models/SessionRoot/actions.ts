import type { EditorSessionState } from '../../domain/types'

export type DktSessionActionName =
	| 'selectEntity'
	| 'setActiveProject'
	| 'syncActiveProjectRel'
	| 'syncPreviewModel'
	| 'syncSelectedClipTrackPosition'
	| 'syncSelectedClipSummary'
	| 'setActiveInspectorTab'
	| 'setCursor'
	| 'setPlaying'
	| 'setTimelineZoom'
	| 'tickPlayback'
	| 'syncSelectedClipRel'
	| 'togglePlayback'
	| 'zoomTimeline'

export type DktSessionActionPatch = Partial<Pick<EditorSessionState,
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
		| readonly [readonly string[], (payload: unknown, ...deps: unknown[]) => DktSessionActionPatch | '$noop']
		| ((payload: unknown) => Record<string, unknown> | '$noop')
}

export const roundToHundredths = (value: number): number => Math.round(value * 100) / 100
export const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value))

const finiteNumber = (payload: unknown): number | null => {
	const value = typeof payload === 'number' ? payload : Number(payload)
	return Number.isFinite(value) ? value : null
}

export const reduceSessionSelectEntityAction = (payload: unknown): Pick<EditorSessionState, 'selectedEntityId'> => ({
	selectedEntityId: typeof payload === 'string' ? payload : null,
})

export const reduceSessionSetActiveProjectAction = (payload: unknown): Pick<EditorSessionState, 'activeProjectId' | 'selectedEntityId' | 'cursor'> => ({
	activeProjectId: typeof payload === 'string' ? payload : null,
	selectedEntityId: null,
	cursor: 0,
})

export const reduceSessionSetCursorAction = (payload: unknown): Pick<EditorSessionState, 'cursor'> | null => {
	const value = finiteNumber(payload)
	return value === null ? null : { cursor: Math.max(0, roundToHundredths(value)) }
}

export const reduceSessionSetActiveInspectorTabAction = (payload: unknown): Pick<EditorSessionState, 'activeInspectorTab'> | null => {
	return payload === 'edit' || payload === 'color' || payload === 'audio' || payload === 'export'
		? { activeInspectorTab: payload }
		: null
}

export const reduceSessionSetPlayingAction = (payload: unknown): Pick<EditorSessionState, 'isPlaying'> | null => {
	return typeof payload === 'boolean' ? { isPlaying: payload } : null
}

export const reduceSessionSetTimelineZoomAction = (payload: unknown): Pick<EditorSessionState, 'timelineZoom'> | null => {
	const value = finiteNumber(payload)
	return value === null ? null : { timelineZoom: clamp(value, 8, 96) }
}

export const reduceSessionTogglePlaybackAction = (
	state: Pick<EditorSessionState, 'isPlaying'>,
): Pick<EditorSessionState, 'isPlaying'> => ({
	isPlaying: !state.isPlaying,
})

export const reduceSessionTickPlaybackAction = (
	payload: unknown,
	state: Pick<EditorSessionState, 'cursor' | 'isPlaying'>,
): Pick<EditorSessionState, 'cursor'> | null => {
	if (!state.isPlaying) {
		return null
	}

	const deltaSeconds = finiteNumber((payload as { deltaSeconds?: unknown } | null)?.deltaSeconds)
	return deltaSeconds === null ? null : { cursor: Math.max(0, roundToHundredths(state.cursor + deltaSeconds)) }
}

export const reduceSessionZoomTimelineAction = (
	payload: unknown,
	state: Pick<EditorSessionState, 'timelineZoom'>,
): Pick<EditorSessionState, 'timelineZoom'> | null => {
	const delta = finiteNumber(payload)
	return delta === null ? null : { timelineZoom: clamp(state.timelineZoom + delta, 8, 96) }
}

export const sessionSelectEntityAction = {
	to: {
		selectedEntityId: ['selectedEntityId'],
	},
	fn: reduceSessionSelectEntityAction,
} as const satisfies DktActionDescriptor

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

export const sessionSyncPreviewModelAction = {
	to: {
		previewStructure: ['previewStructure'],
		previewFrame: ['previewFrame'],
	},
	fn: (payload: unknown) => ({
		previewStructure: (payload as { structure?: unknown } | null)?.structure ?? { clipSources: [] },
		previewFrame: (payload as { frame?: unknown } | null)?.frame ?? { cursor: 0, renderedClips: [], visualRenderedClips: [], audioRenderedClips: [], activeClipNames: [] },
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

export const dktSessionActions = {
	selectEntity: sessionSelectEntityAction,
	setActiveProject: sessionSetActiveProjectAction,
	syncActiveProjectRel: sessionSyncActiveProjectRelAction,
	syncPreviewModel: sessionSyncPreviewModelAction,
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
} as const satisfies Record<DktSessionActionName, DktActionDescriptor>
