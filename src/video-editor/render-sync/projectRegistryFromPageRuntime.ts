import type { PageSyncRuntime } from '../../dkt-react-sync/runtime/PageSyncRuntime'
import type { ReactSyncScopeHandle } from '../../dkt-react-sync/scope/ScopeHandle'
import { createEmptyRegistry } from '../domain/createProject'
import type { Entity, ProjectRegistry } from '../domain/types'

const EMPTY_LIST = Object.freeze([]) as readonly ReactSyncScopeHandle[]

const uniq = <Value>(values: readonly Value[]): Value[] => Array.from(new Set(values))

const readString = (attrs: Record<string, unknown>, key: string): string | null => {
	const value = attrs[key]
	return typeof value === 'string' && value ? value : null
}

const readNumber = (attrs: Record<string, unknown>, key: string, fallback: number): number => {
	const value = attrs[key]
	return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

const cloneValue = <Value>(value: unknown, fallback: Value): Value => {
	if (value == null) {
		return fallback
	}
	if (typeof value !== 'object') {
		return value as Value
	}
	return structuredClone(value) as Value
}

const getPioneerScope = (runtime: PageSyncRuntime): ReactSyncScopeHandle | null => {
	const root = runtime.getRootScope()
	return root ? runtime.readOne(root, 'pioneer') : null
}

const readRootRouted = (runtime: PageSyncRuntime, relName: string): readonly ReactSyncScopeHandle[] => {
	const pioneer = getPioneerScope(runtime)
	return pioneer ? runtime.readMany(pioneer, relName) : EMPTY_LIST
}

const readAttrs = (runtime: PageSyncRuntime, scope: ReactSyncScopeHandle, fields: readonly string[]) =>
	runtime.readAttrs(scope, fields)

const findBySourceAttr = (
	runtime: PageSyncRuntime,
	scopes: readonly ReactSyncScopeHandle[],
	attrName: string,
	sourceId: string | null,
): ReactSyncScopeHandle | null => {
	if (!sourceId) {
		return null
	}
	return scopes.find((scope) => readAttrs(runtime, scope, [attrName])[attrName] === sourceId) ?? null
}

const readProjectTrackScopes = (
	runtime: PageSyncRuntime,
	projectScope: ReactSyncScopeHandle,
	sourceProjectId: string,
): readonly ReactSyncScopeHandle[] => {
	const direct = runtime.readMany(projectScope, 'tracks')
	if (direct.length > 0) {
		return direct
	}

	return readRootRouted(runtime, 'track').filter((trackScope) => {
		const sourceTrackId = readAttrs(runtime, trackScope, ['sourceTrackId']).sourceTrackId
		return typeof sourceTrackId === 'string' && sourceTrackId.startsWith(`${sourceProjectId}:track:`)
	})
}

const readProjectResourceScopes = (
	runtime: PageSyncRuntime,
	projectScope: ReactSyncScopeHandle,
): readonly ReactSyncScopeHandle[] => {
	return runtime.readMany(projectScope, 'resources')
}

const createTrackEntity = (runtime: PageSyncRuntime, scope: ReactSyncScopeHandle): Entity | null => {
	const attrs = readAttrs(runtime, scope, ['sourceTrackId', 'kind', 'name', 'muted', 'locked', 'height'])
	const id = readString(attrs, 'sourceTrackId')
	if (!id) {
		return null
	}

	const clips = runtime.readMany(scope, 'clips')
		.map((clipScope) => readString(readAttrs(runtime, clipScope, ['sourceClipId']), 'sourceClipId'))
		.filter((clipId): clipId is string => Boolean(clipId))

	return {
		id,
		type: 'track',
		attrs: {
			kind: attrs.kind === 'audio' ? 'audio' : 'video',
			name: readString(attrs, 'name') ?? 'Track',
			muted: attrs.muted === true,
			locked: attrs.locked === true,
			height: readNumber(attrs, 'height', 84),
		},
		rels: { clips: uniq(clips) },
	}
}

const createResourceEntity = (runtime: PageSyncRuntime, scope: ReactSyncScopeHandle): Entity | null => {
	const attrs = readAttrs(runtime, scope, [
		'sourceResourceId', 'name', 'kind', 'url', 'mime', 'duration', 'width', 'height', 'size', 'source', 'status', 'data',
	])
	const id = readString(attrs, 'sourceResourceId')
	if (!id) {
		return null
	}

	return {
		id,
		type: 'resource',
		attrs: {
			name: readString(attrs, 'name') ?? 'Resource',
			kind: readString(attrs, 'kind') ?? 'video',
			url: readString(attrs, 'url') ?? '',
			mime: readString(attrs, 'mime') ?? 'application/octet-stream',
			duration: readNumber(attrs, 'duration', 0),
			width: typeof attrs.width === 'number' ? attrs.width : undefined,
			height: typeof attrs.height === 'number' ? attrs.height : undefined,
			size: typeof attrs.size === 'number' ? attrs.size : undefined,
			source: cloneValue(attrs.source, { kind: 'local' }),
			status: readString(attrs, 'status') ?? 'missing',
			data: cloneValue(attrs.data, null),
		},
		rels: {},
	}
}

const createTextEntity = (runtime: PageSyncRuntime, scope: ReactSyncScopeHandle): Entity | null => {
	const attrs = readAttrs(runtime, scope, ['sourceTextId', 'content', 'style', 'box'])
	const id = readString(attrs, 'sourceTextId')
	if (!id) {
		return null
	}

	return {
		id,
		type: 'text',
		attrs: {
			content: readString(attrs, 'content') ?? 'Text',
			style: cloneValue(attrs.style, null),
			box: cloneValue(attrs.box, null),
		},
		rels: {},
	}
}

const createEffectEntity = (runtime: PageSyncRuntime, scope: ReactSyncScopeHandle, clipId: string): Entity | null => {
	const attrs = readAttrs(runtime, scope, ['sourceEffectId', 'name', 'kind', 'enabled', 'amount', 'params', 'color'])
	const id = readString(attrs, 'sourceEffectId')
	if (!id) {
		return null
	}

	return {
		id,
		type: 'effect',
		attrs: {
			name: readString(attrs, 'name') ?? 'Effect',
			kind: readString(attrs, 'kind') ?? 'tint',
			enabled: attrs.enabled !== false,
			amount: typeof attrs.amount === 'number' ? attrs.amount : null,
			params: cloneValue(attrs.params, null),
			color: cloneValue(attrs.color, null),
		},
		rels: { clip: clipId },
	}
}

const createClipEntity = (runtime: PageSyncRuntime, scope: ReactSyncScopeHandle, registry: ProjectRegistry): Entity | null => {
	const attrs = readAttrs(runtime, scope, [
		'sourceClipId', 'sourceResourceId', 'sourceTextId', 'name', 'color', 'mediaKind', 'start', 'in', 'duration', 'fadeIn', 'fadeOut', 'audio', 'opacity', 'transform',
	])
	const id = readString(attrs, 'sourceClipId')
	if (!id) {
		return null
	}

	const resourceId = readString(attrs, 'sourceResourceId')
	const textId = readString(attrs, 'sourceTextId')
	const textScope = runtime.readOne(scope, 'text')
	if (textScope) {
		const text = createTextEntity(runtime, textScope)
		if (text) {
			registry.entitiesById[text.id] = text
		}
	}

	const effectIds: string[] = []
	for (const effectScope of runtime.readMany(scope, 'effects')) {
		const effect = createEffectEntity(runtime, effectScope, id)
		if (effect) {
			registry.entitiesById[effect.id] = effect
			effectIds.push(effect.id)
		}
	}

	return {
		id,
		type: 'clip',
		attrs: {
			name: readString(attrs, 'name') ?? 'Clip',
			color: readString(attrs, 'color') ?? '#2563eb',
			mediaKind: readString(attrs, 'mediaKind'),
			start: readNumber(attrs, 'start', 0),
			in: readNumber(attrs, 'in', 0),
			duration: readNumber(attrs, 'duration', 0),
			fadeIn: readNumber(attrs, 'fadeIn', 0),
			fadeOut: readNumber(attrs, 'fadeOut', 0),
			audio: cloneValue(attrs.audio, { gain: 1, pan: 0 }),
			opacity: cloneValue(attrs.opacity, { value: 1 }),
			transform: cloneValue(attrs.transform, {
				x: { value: 0 },
				y: { value: 0 },
				scale: { value: 1 },
				rotation: { value: 0 },
			}),
		},
		rels: {
			resource: resourceId,
			text: textId,
			effects: effectIds,
		},
	}
}

export const createProjectRegistryFromPageRuntime = (runtime: PageSyncRuntime | null): ProjectRegistry => {
	const registry = createEmptyRegistry()
	if (!runtime) {
		return registry
	}

	const activeProjectId = runtime.getRootAttrs(['activeProjectId']).activeProjectId
	registry.activeProjectId = typeof activeProjectId === 'string' ? activeProjectId : null

	for (const projectScope of readRootRouted(runtime, 'project')) {
		const projectAttrs = readAttrs(runtime, projectScope, ['sourceProjectId', 'title', 'fps', 'width', 'height', 'duration', 'createdAt', 'updatedAt'])
		const projectId = readString(projectAttrs, 'sourceProjectId')
		if (!projectId) {
			continue
		}

		const timelineId = `timeline:${projectId}`
		const tracks = readProjectTrackScopes(runtime, projectScope, projectId)
			.map((trackScope) => createTrackEntity(runtime, trackScope))
			.filter((track): track is Entity => Boolean(track))
		const resources = readProjectResourceScopes(runtime, projectScope)
			.map((resourceScope) => createResourceEntity(runtime, resourceScope))
			.filter((resource): resource is Entity => Boolean(resource))

		for (const track of tracks) {
			registry.entitiesById[track.id] = track
		}

		for (let trackIndex = 0; trackIndex < tracks.length; trackIndex += 1) {
			const trackScope = tracks[trackIndex]
			const sourceTrackId = trackScope.id
			const dktTrackScope = readProjectTrackScopes(runtime, projectScope, projectId)
				.find((scope) => readAttrs(runtime, scope, ['sourceTrackId']).sourceTrackId === sourceTrackId)
			if (!dktTrackScope) {
				continue
			}
			for (const clipScope of runtime.readMany(dktTrackScope, 'clips')) {
				const clip = createClipEntity(runtime, clipScope, registry)
				if (clip) {
					registry.entitiesById[clip.id] = clip
				}
			}
		}

		for (const resource of resources) {
			registry.entitiesById[resource.id] = resource
		}

		registry.entitiesById[timelineId] = {
			id: timelineId,
			type: 'timeline',
			attrs: {
				name: 'Main timeline',
				duration: readNumber(projectAttrs, 'duration', 0),
			},
			rels: { tracks: tracks.map((track) => track.id) },
		}
		registry.entitiesById[projectId] = {
			id: projectId,
			type: 'project',
			attrs: {
				title: readString(projectAttrs, 'title') ?? 'Untitled project',
				fps: readNumber(projectAttrs, 'fps', 30),
				width: readNumber(projectAttrs, 'width', 1920),
				height: readNumber(projectAttrs, 'height', 1080),
				duration: readNumber(projectAttrs, 'duration', 0),
				createdAt: readNumber(projectAttrs, 'createdAt', 0),
				updatedAt: readNumber(projectAttrs, 'updatedAt', 0),
			},
			rels: {
				resources: resources.map((resource) => resource.id),
				timelines: [timelineId],
				activeTimeline: timelineId,
			},
		}
		registry.projects[projectId] = {
			id: projectId,
			version: 0,
			rootEntityId: projectId,
		}
	}

	if (registry.activeProjectId && !registry.projects[registry.activeProjectId]) {
		registry.activeProjectId = Object.keys(registry.projects)[0] ?? null
	}

	return registry
}