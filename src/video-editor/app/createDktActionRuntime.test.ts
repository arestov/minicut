import { observable } from '@legendapp/state'
import { describe, expect, it, vi } from 'vitest'
import { createProjectGraph } from '../domain/createProject'
import { CMD, type EditorSessionState, type Entity } from '../domain/types'
import { createDktActionRuntime } from './createDktActionRuntime'
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
	const text: Entity = {
		id: 'text:dkt-runtime-caption',
		type: 'text',
		attrs: {
			content: 'Before',
			style: {
				fontFamily: 'Inter, Segoe UI, sans-serif',
				fontSize: 64,
				fontWeight: 700,
				lineHeight: 1.1,
				letterSpacing: 0,
				color: '#ffffff',
				backgroundColor: 'rgba(0, 0, 0, 0)',
				align: 'center',
			},
			box: { width: 760, height: 220 },
		},
		rels: {},
	}
	const effect: Entity = {
		id: 'effect:dkt-runtime-tint',
		type: 'effect',
		attrs: {
			name: 'Tint',
			kind: 'tint',
			enabled: true,
			amount: 0.25,
		},
		rels: { clip: clip.id },
	}
	videoTrack.rels = { ...videoTrack.rels, clips: [clip.id] }
	clip.rels = { ...clip.rels, text: text.id, effects: [effect.id] }

	return {
		activeProjectId: project.id,
		projects: { [project.id]: project },
		entitiesById: Object.fromEntries([...entities, clip, text, effect].map((entity) => [entity.id, entity])),
	}
}

const createEnv = () => {
	const registry = createRegistryWithClip()
	const dispatchClipAction = vi.fn()
	const dispatchTextAction = vi.fn()
	const dispatchEffectAction = vi.fn()
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
			getRegistry: () => registry,
			applySnapshot: vi.fn(),
			applyPatchEnvelope: vi.fn(),
		},
		authority: {
			dispatch,
			getSnapshot: vi.fn(() => registry),
			subscribe: vi.fn(() => () => undefined),
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
			dispatchTextAction,
			dispatchEffectAction,
		},
		media: {},
		export: {},
		transfers: {},
		lifecycle: {},
		tasks: {},
		platform: {},
	} as unknown as EditorActionEnvironment

	return { env, registry, dispatchClipAction, dispatchTextAction, dispatchEffectAction, dispatch }
}

describe('createDktActionRuntime DKT clip wiring', () => {
	it('dispatches opacity edits to DKT clip action before mirroring through the current authority path', () => {
		const { env, dispatchClipAction } = createEnv()
		const actions = createDktActionRuntime(env, {
			playbackDuration$: { get: () => 10 } as never,
			resourceChunkSize: 1024,
		})

		actions.updateClipOpacityById('clip:dkt-runtime-opacity', 37)

		expect(dispatchClipAction).toHaveBeenCalledWith({
			sourceClipId: 'clip:dkt-runtime-opacity',
			name: 'Runtime opacity clip',
			color: '#ef4444',
			start: 0,
			in: 0,
			duration: 4,
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
		}, 'updateOpacity', { opacityPercent: 37 })
	})

	it('dispatches timeline-safe clip attrs to DKT before structural authority mirror', () => {
		const { env, dispatchClipAction } = createEnv()
		const actions = createDktActionRuntime(env, {
			playbackDuration$: { get: () => 10 } as never,
			resourceChunkSize: 1024,
		})

		actions.trimClipById('clip:dkt-runtime-opacity', 'start', 0.5)
		actions.resizeClipById('clip:dkt-runtime-opacity', 'end', -0.5)
		actions.moveClipById('clip:dkt-runtime-opacity', 1)
		actions.splitClipByIdAt('clip:dkt-runtime-opacity', 2)

		expect(dispatchClipAction).toHaveBeenCalledWith(expect.objectContaining({
			sourceClipId: 'clip:dkt-runtime-opacity',
			start: 0,
			in: 0,
			duration: 4,
		}), 'trim', { edge: 'start', delta: 0.5 })
		expect(dispatchClipAction).toHaveBeenCalledWith(expect.any(Object), 'resize', { edge: 'end', delta: -0.5 })
		expect(dispatchClipAction).toHaveBeenCalledWith(expect.any(Object), 'moveBy', { delta: 1 })
		expect(dispatchClipAction).toHaveBeenCalledWith(expect.any(Object), 'splitAt', { time: 2 })
	})

	it('mirrors text through model commands and effect attrs through DKT proxy actions', async () => {
		const { env, dispatchTextAction, dispatchEffectAction } = createEnv()
		const actions = createDktActionRuntime(env, {
			playbackDuration$: { get: () => 10 } as never,
			resourceChunkSize: 1024,
		})

		actions.updateTextById('text:dkt-runtime-caption', { content: 'After', style: { color: '#111827' } as never })
		actions.updateEffectAttrs('effect:dkt-runtime-tint', { amount: 0.8 })
		await Promise.resolve()

		expect(dispatchTextAction).not.toHaveBeenCalled()
		expect(env.authority.dispatch).toHaveBeenCalledWith({
			c: CMD.TEXT_UPDATE_ATTRS,
			p: {
				id: 'text:dkt-runtime-caption',
				attrs: { content: 'After', style: { color: '#111827' } },
			},
		})
		expect(dispatchEffectAction).toHaveBeenCalledWith(expect.objectContaining({
			sourceEffectId: 'effect:dkt-runtime-tint',
			name: 'Tint',
			kind: 'tint',
			amount: 0.25,
		}), 'setEffectAmount', { amount: 0.8 })
	})
})
