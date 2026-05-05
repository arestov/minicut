import type { EditorSessionState } from '../domain/types'

export type DktSessionActionName =
	| 'selectEntity'
	| 'setActiveProject'
	| 'setCursor'
	| 'togglePlayback'
	| 'zoomTimeline'

export type DktSessionActionPatch = Partial<Pick<EditorSessionState,
	| 'activeProjectId'
	| 'selectedEntityId'
	| 'cursor'
	| 'isPlaying'
	| 'timelineZoom'
>>

type DktActionDescriptor = {
	to: Record<string, readonly [string]>
	fn: ((payload: unknown) => DktSessionActionPatch | '$noop')
		| readonly [readonly string[], (payload: unknown, ...deps: unknown[]) => DktSessionActionPatch | '$noop']
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

export const reduceSessionTogglePlaybackAction = (
	state: Pick<EditorSessionState, 'isPlaying'>,
): Pick<EditorSessionState, 'isPlaying'> => ({
	isPlaying: !state.isPlaying,
})

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

export const sessionSetCursorAction = {
	to: {
		cursor: ['cursor'],
	},
	fn: (payload: unknown) => reduceSessionSetCursorAction(payload) ?? '$noop',
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
	setCursor: sessionSetCursorAction,
	togglePlayback: sessionTogglePlaybackAction,
	zoomTimeline: sessionZoomTimelineAction,
} as const satisfies Record<DktSessionActionName, DktActionDescriptor>
