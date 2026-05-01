import { nanoid } from 'nanoid'
import type { Entity, ProjectGraph, ProjectRegistry, TrackAttrs } from './types'

const makeEntityId = (prefix: string) => `${prefix}:${nanoid(6)}`

const createTrack = (kind: TrackAttrs['kind'], name: string, height: number): Entity => ({
	id: makeEntityId('track'),
	type: 'track',
	attrs: {
		kind,
		name,
		muted: false,
		locked: false,
		height,
	},
	rels: {
		clips: [],
	},
})

export const createEmptyRegistry = (): ProjectRegistry => ({
	activeProjectId: null,
	projects: {},
})

export const createProjectGraph = (title: string, ordinal: number): ProjectGraph => {
	const projectId = `project-${nanoid(6)}`
	const projectEntityId = makeEntityId('project')
	const timelineId = makeEntityId('timeline')
	const videoTrack = createTrack('video', 'V1', 72)
	const audioTrack = createTrack('audio', 'A1', 64)
	const now = Date.now()

	const entities: Record<string, Entity> = {
		[projectEntityId]: {
			id: projectEntityId,
			type: 'project',
			attrs: {
				title: title || `Project ${ordinal}`,
				fps: 30,
				width: 1920,
				height: 1080,
				duration: 0,
				createdAt: now,
				updatedAt: now,
			},
			rels: {
				resources: [],
				timelines: [timelineId],
				activeTimeline: timelineId,
			},
		},
		[timelineId]: {
			id: timelineId,
			type: 'timeline',
			attrs: {
				name: 'Main timeline',
				duration: 0,
			},
			rels: {
				tracks: [videoTrack.id, audioTrack.id],
			},
		},
		[videoTrack.id]: videoTrack,
		[audioTrack.id]: audioTrack,
	}

	return {
		id: projectId,
		version: 0,
		rootEntityId: projectEntityId,
		entities,
	}
}
