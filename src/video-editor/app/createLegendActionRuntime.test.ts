import { observable } from '@legendapp/state'
import { describe, expect, it, vi } from 'vitest'
import { createProjectGraph } from '../domain/createProject'
import type { EditorSessionState, Entity, HistoryState } from '../domain/types'
import { createLegendActionRuntime } from './createLegendActionRuntime'
import type { EditorActionEnvironment } from './editorActionEnvironment'

const createRegistryWithClip = () => {
	const { project, entities } = createProjectGraph('DKT opacity runtime', 1)
	const videoTrack = entities.find((entity) => entity.type === 'track' && entity.attrs.kind === 'video')!
	const clip: Entity = {
		id: 'clip:dkt-runtime-opacity',
		type: 'clip',
		attrs: {
			name: 'Runtime opacity clip',
			color: '#ef4444',
			start: 0,
			duration: 4,
			in: 0,
			fadeIn: 0,
			fadeOut: 0,
			audio: { gain: 1, pan: 0 },
			opacity: { value: 1 },
			transform: {
				x: { value: 0 },
				y: { value: 0 },
				scale: { value: 1 },
				rotation: { value: 0 },
			},
		},
		rels: { effects: [] },
	}
	videoTrack.rels = { ...videoTrack.rels, clips: [clip.id] }

	return {
		activeProjectId: project.id,
		projects: { [project.id]: project },
		entitiesById: Object.fromEntries([...entities, clip].map((entity) => [entity.id, entity])),
	}
}

const createEnv = () => {
	const registry = createRegistryWithClip()
	const dispatchClipAction = vi.fn()
	const dispatch = vi.fn(async () => ({ envelope: { projectId: registry.activeProjectId, version: 2, patches: [] } }))
	const sessionState: EditorSessionState = {
		tabId: 'test-tab',
		activeProjectId: registry.activeProjectId,
		selectedEntityId: null,
		activeInspectorTab: 'edit',
		cursor: 0,
		isPlaying: false,
		timelineZoom: 16,
	}

	const env = {
		stores: {
			projects$: observable(registry),
			history$: observable<HistoryState>({ canUndo: false, canRedo: false }),
			getRegistry: () => registry,
			applySnapshot: vi.fn(),
			applyPatchEnvelope: vi.fn(),
		},
		authority: {
			dispatch,
			undo: vi.fn(),
			redo: vi.fn(),
			getSnapshot: vi.fn(() => registry),
			getHistoryState: vi.fn(() => ({ canUndo: false, canRedo: false })),
			subscribe: vi.fn(() => () => undefined),
			syncHistoryState: vi.fn(),
		},
		session: {
			session$: observable(sessionState),
			get: () => sessionState,
			setActiveProject: vi.fn(),
			selectEntity: vi.fn(),
			setCursor: vi.fn(),
			setPlaying: vi.fn(),
			setTimelineZoom: vi.fn(),
			setActiveInspectorTab: vi.fn(),
		},
		dkt: {
			dispatchSessionAction: vi.fn(),
			dispatchClipAction,
		},
		media: {},
		export: {},
		transfers: {},
		lifecycle: {},
		tasks: {},
		platform: {},
	} as unknown as EditorActionEnvironment

	return { env, registry, dispatchClipAction, dispatch }
}

describe('createLegendActionRuntime DKT clip wiring', () => {
	it('dispatches opacity edits to DKT clip action before mirroring through the current authority path', () => {
		const { env, dispatchClipAction } = createEnv()
		const actions = createLegendActionRuntime(env, {
			playbackDuration$: { get: () => 10 } as never,
			resourceChunkSize: 1024,
		})

		actions.updateClipOpacityById('clip:dkt-runtime-opacity', 37)

		expect(dispatchClipAction).toHaveBeenCalledWith({
			sourceClipId: 'clip:dkt-runtime-opacity',
			name: 'Runtime opacity clip',
			color: '#ef4444',
			opacity: { value: 1 },
		}, 'updateOpacity', { opacityPercent: 37 })
	})
})
