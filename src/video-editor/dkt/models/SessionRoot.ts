import { model } from 'dkt/model.js'
import { SessionRoot as BaseSessionRoot } from 'dkt-all/libs/provoda/bwlev/SessionRoot.js'

const roundToHundredths = (value: number): number => Math.round(value * 100) / 100
const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value))

export const EditorSessionRoot = model({
	extends: BaseSessionRoot,
	model_name: 'minicut_session_root',
	attrs: {
		tabId: ['input', null],
		activeProjectId: ['input', null],
		selectedEntityId: ['input', null],
		activeInspectorTab: ['input', 'edit'],
		cursor: ['input', 0],
		isPlaying: ['input', false],
		timelineZoom: ['input', 16],
		timelineTool: ['input', 'select'],
		snappingEnabled: ['input', true],
	},
	actions: {
		selectEntity: {
			to: {
				selectedEntityId: ['selectedEntityId'],
			},
			fn: (payload: unknown) => ({
				selectedEntityId: typeof payload === 'string' ? payload : null,
			}),
		},
		setActiveProject: {
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
		},
		setCursor: {
			to: {
				cursor: ['cursor'],
			},
			fn: (payload: unknown) => {
				const value = typeof payload === 'number' ? payload : Number(payload)
				return Number.isFinite(value) ? { cursor: Math.max(0, roundToHundredths(value)) } : '$noop'
			},
		},
		togglePlayback: {
			to: {
				isPlaying: ['isPlaying'],
			},
			fn: [
				['isPlaying'] as const,
				(_payload: unknown, isPlaying: unknown) => ({ isPlaying: !Boolean(isPlaying) }),
			],
		},
		zoomTimeline: {
			to: {
				timelineZoom: ['timelineZoom'],
			},
			fn: [
				['timelineZoom'] as const,
				(payload: unknown, timelineZoom: unknown) => {
					const delta = typeof payload === 'number' ? payload : Number(payload)
					const current = typeof timelineZoom === 'number' ? timelineZoom : 16
					return Number.isFinite(delta)
						? { timelineZoom: clamp(current + delta, 8, 96) }
						: '$noop'
				},
			],
		},
	},
})
