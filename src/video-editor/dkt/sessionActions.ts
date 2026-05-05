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

export const sessionSelectEntityAction = {
	to: {
		selectedEntityId: ['selectedEntityId'],
	},
	fn: (payload: unknown) => ({
		selectedEntityId: typeof payload === 'string' ? payload : null,
	}),
} as const satisfies DktActionDescriptor

export const sessionSetActiveProjectAction = {
	to: {
		activeProjectId: ['activeProjectId'],
		selectedEntityId: ['selectedEntityId'],
		cursor: ['cursor'],
	},
	fn: (payload: unknown) => ({
		activeProjectId: typeof payload === 'string' ? payload : null,
		selectedEntityId: null,
		cursor: 0,
	}),
} as const satisfies DktActionDescriptor

export const sessionSetCursorAction = {
	to: {
		cursor: ['cursor'],
	},
	fn: (payload: unknown) => {
		const value = finiteNumber(payload)
		return value === null ? '$noop' : { cursor: Math.max(0, roundToHundredths(value)) }
	},
} as const satisfies DktActionDescriptor

export const sessionTogglePlaybackAction = {
	to: {
		isPlaying: ['isPlaying'],
	},
	fn: [
		['isPlaying'] as const,
		(_payload: unknown, isPlaying: unknown) => ({ isPlaying: !Boolean(isPlaying) }),
	],
} as const satisfies DktActionDescriptor

export const sessionZoomTimelineAction = {
	to: {
		timelineZoom: ['timelineZoom'],
	},
	fn: [
		['timelineZoom'] as const,
		(payload: unknown, timelineZoom: unknown) => {
			const delta = finiteNumber(payload)
			const current = typeof timelineZoom === 'number' ? timelineZoom : 16
			return delta === null ? '$noop' : { timelineZoom: clamp(current + delta, 8, 96) }
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

const getDeps = (
	state: Pick<EditorSessionState, 'isPlaying' | 'timelineZoom'>,
	deps: readonly string[],
): unknown[] => deps.map((dep) => {
	switch (dep) {
		case 'isPlaying':
			return state.isPlaying
		case 'timelineZoom':
			return state.timelineZoom
		default:
			return undefined
	}
})

export const reduceDktSessionAction = (
	actionName: DktSessionActionName,
	payload: unknown,
	state: Pick<EditorSessionState, 'isPlaying' | 'timelineZoom'>,
): DktSessionActionPatch | null => {
	const action = dktSessionActions[actionName]
	const result = Array.isArray(action.fn)
		? action.fn[1](payload, ...getDeps(state, action.fn[0]))
		: action.fn(payload)

	return result === '$noop' ? null : result
}
