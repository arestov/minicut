import { describe, expect, it, vi } from 'vitest'
import { createSessionRootActions } from './sessionRootActions'
import type { EditorActionEnvironment } from './editorActionEnvironment'

const createEnv = (overrides?: { playbackDuration?: number; registryProjectId?: string }) => {
	const setActiveProject = vi.fn()
	const selectEntity = vi.fn()
	const setCursor = vi.fn()
	const setPlaying = vi.fn()
	const setTimelineZoom = vi.fn()
	const setActiveInspectorTab = vi.fn()
	const sessionGet = vi.fn(() => ({
		isPlaying: true,
		cursor: 2,
		timelineZoom: 16,
		activeInspectorTab: 'clip',
		activeProjectId: null,
		selectedEntityId: null,
	}))

	const env = {
		stores: {
			projects$: { activeProjectId: { set: vi.fn() } },
			getRegistry: vi.fn(() => ({
				entitiesById: overrides?.registryProjectId
					? { [overrides.registryProjectId]: { id: overrides.registryProjectId, type: 'project' } }
					: {},
			})),
		},
		authority: {
			dispatch: vi.fn(async () => ({ envelope: { projectId: 'project:1', version: 1, patches: [] } })),
			undo: vi.fn(),
			redo: vi.fn(),
			syncHistoryState: vi.fn(),
		},
		session: {
			get: sessionGet,
			setActiveProject,
			selectEntity,
			setCursor,
			setPlaying,
			setTimelineZoom,
			setActiveInspectorTab,
		},
	} as unknown as EditorActionEnvironment

	const actions = createSessionRootActions(
		env,
		{ playbackDuration$: { get: () => overrides?.playbackDuration ?? 10 } as never, resourceChunkSize: 1024 },
		() => undefined,
	)

	return { actions, env, setActiveProject, selectEntity, setCursor }
}

describe('createSessionRootActions', () => {
	it('ignores invalid project ids when setting active project', () => {
		const { actions, setActiveProject } = createEnv()
		actions.setActiveProject('project:missing')
		expect(setActiveProject).not.toHaveBeenCalled()
	})

	it('clamps and ignores non-finite cursor updates', () => {
		const { actions, setCursor } = createEnv()
		actions.setCursor(-4.129)
		actions.setCursor(Number.NaN)
		expect(setCursor).toHaveBeenCalledTimes(1)
		expect(setCursor).toHaveBeenCalledWith(0)
	})

	it('skips playback tick when duration is not positive', () => {
		const { actions, setCursor } = createEnv({ playbackDuration: 0 })
		actions.tickPlayback(1)
		expect(setCursor).not.toHaveBeenCalled()
	})
})
