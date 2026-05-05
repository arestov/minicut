import { describe, expect, it } from 'vitest'
import { createProjectGraph } from './createProject'
import { buildEditorActionCommand, expectCommand } from './actionCommandBuilders'
import { createEntityActionScope } from './actionScope'
import { CMD } from './types'

const createRegistryWithClip = () => {
	const { project, entities } = createProjectGraph('Test', 1)
	const timeline = entities.find((entity) => entity.type === 'timeline')!
	const videoTrack = entities.find((entity) => entity.type === 'track' && entity.attrs.kind === 'video')!
	const clip = {
		id: 'clip:1',
		type: 'clip' as const,
		attrs: {
			name: 'Clip',
			start: 1,
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
		registry: {
			activeProjectId: project.id,
			projects: { [project.id]: project },
			entitiesById: Object.fromEntries([...entities, clip].map((entity) => [entity.id, entity])),
		},
		projectId: project.id,
		timelineId: timeline.id,
		clipId: clip.id,
	}
}

describe('buildEditorActionCommand', () => {
	it('maps scoped clip rename to a clip update command', () => {
		const { registry, projectId, clipId } = createRegistryWithClip()
		const command = expectCommand(buildEditorActionCommand({
			scope: createEntityActionScope(clipId, 'clip'),
			name: 'rename',
			payload: { name: 'Renamed' },
		}, { registry, activeProjectId: projectId }))

		expect(command).toEqual({ c: CMD.CLIP_UPDATE_ATTRS, p: { id: clipId, attrs: { name: 'Renamed' } } })
	})

	it('maps scoped resize to clamped clip attrs', () => {
		const { registry, projectId, clipId } = createRegistryWithClip()
		const command = expectCommand(buildEditorActionCommand({
			scope: createEntityActionScope(clipId, 'clip'),
			name: 'resize',
			payload: { edge: 'end', delta: -10 },
		}, { registry, activeProjectId: projectId }))

		expect(command).toEqual({ c: CMD.CLIP_UPDATE_ATTRS, p: { id: clipId, attrs: { duration: 0.5 } } })
	})

	it('maps addTrack through active project context', () => {
		const { registry, projectId } = createRegistryWithClip()
		const command = expectCommand(buildEditorActionCommand({
			scope: { nodeId: '$root', type: 'root' },
			name: 'addTrack',
			payload: { kind: 'audio' },
		}, { registry, activeProjectId: projectId }))

		expect(command).toEqual({ c: CMD.TRACK_CREATE, p: { projectId, kind: 'audio' } })
	})

	it('builds createProject as a model action transaction with session activation', () => {
		const { registry } = createRegistryWithClip()
		const result = buildEditorActionCommand({
			scope: { nodeId: '$root', type: 'root' },
			name: 'createProject',
			payload: 'New project',
		}, { registry, activeProjectId: null })

		expect(result).toMatchObject({
			type: 'transaction',
			steps: [
				{ type: 'command', command: { c: CMD.PROJECT_CREATE, p: { title: 'New project' } }, holdCreatedIdAs: 'project.new', createdIdKey: 'projectId' },
				{ type: 'session', patch: { selectedEntityId: null, cursor: 0 } },
			],
		})
	})

	it('builds deleteClip as a transaction when selected clip should be cleared', () => {
		const { registry, projectId, clipId } = createRegistryWithClip()
		const result = buildEditorActionCommand({
			scope: createEntityActionScope(clipId, 'clip'),
			name: 'deleteClip',
			payload: undefined,
		}, { registry, activeProjectId: projectId, selectedEntityId: clipId })

		expect(result).toEqual({
			type: 'transaction',
			steps: [
				{ type: 'command', command: { c: CMD.TIMELINE_DELETE_CLIP, p: { id: clipId } } },
				{ type: 'session', patch: { selectedEntityId: null } },
			],
		})
	})

	it('builds splitAt selection transaction for public clip split actions', () => {
		const { registry, projectId, clipId } = createRegistryWithClip()
		const result = buildEditorActionCommand({
			scope: createEntityActionScope(clipId, 'clip'),
			name: 'splitAt',
			payload: { time: 2 },
		}, { registry, activeProjectId: projectId, selectCreatedClipOnSplit: true })

		expect(result).toMatchObject({
			type: 'transaction',
			steps: [
				{ type: 'command', command: { c: CMD.TIMELINE_SPLIT_CLIP, p: { id: clipId, time: 2 } }, holdCreatedIdAs: 'split.clip' },
				{ type: 'session' },
			],
		})
	})
})
