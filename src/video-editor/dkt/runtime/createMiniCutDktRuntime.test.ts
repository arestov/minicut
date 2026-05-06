// @ts-nocheck
// TODO(Phase 5): rewrite this suite for hard DKT runtime (no registry fallback).
import { describe, expect, it } from 'vitest'
import { createEmptyRegistry, createProjectGraph } from '../../domain/createProject'
import { CMD } from '../../domain/types'
import { DKT_MSG, type MiniCutDktTransportMessage } from '../shared/messageTypes'
import { createMiniCutDktRuntime } from './createMiniCutDktRuntime'

const findModel = (state: Awaited<ReturnType<ReturnType<typeof createMiniCutDktRuntime>['debugDumpAppState']>>, modelName: string) => {
	const matches = [
		...(state?.runtimeModels ?? []),
		...(state?.lined ?? []),
	].filter((model) => model.modelName === modelName)
	return matches[0] ?? null
}

const findModelByAttr = (
	state: Awaited<ReturnType<ReturnType<typeof createMiniCutDktRuntime>['debugDumpAppState']>>,
	modelName: string,
	attrName: string,
	expectedValue: unknown,
) => [
	...(state?.runtimeModels ?? []),
	...(state?.lined ?? []),
].find((model) => model.modelName === modelName && attrEquals(model.attrs[attrName], expectedValue)) ?? null

const attrEquals = (value: unknown, expectedValue: unknown): boolean =>
	Object.is(value, expectedValue) || JSON.stringify(value) === JSON.stringify(expectedValue)

const waitForModelAttr = async (
	runtime: ReturnType<typeof createMiniCutDktRuntime>,
	modelName: string,
	attrName: string,
	expectedValue: unknown,
) => {
	for (let attempt = 0; attempt < 20; attempt++) {
		const state = await runtime.debugDumpAppState()
		const model = findModelByAttr(state, modelName, attrName, expectedValue)
		if (model) {
			return model
		}
		await new Promise((resolve) => setTimeout(resolve, 0))
	}
	const state = await runtime.debugDumpAppState()
	return findModelByAttr(state, modelName, attrName, expectedValue)
}

const waitForModelRel = async (
	runtime: ReturnType<typeof createMiniCutDktRuntime>,
	modelName: string,
	attrName: string,
	expectedValue: unknown,
	relName: string,
) => {
	for (let attempt = 0; attempt < 20; attempt++) {
		const state = await runtime.debugDumpAppState()
		const model = findModel(state, modelName)
		if (attrEquals(model?.attrs[attrName], expectedValue) && Array.isArray(model?.rels[relName])) {
			return model
		}
		await new Promise((resolve) => setTimeout(resolve, 0))
	}
	const state = await runtime.debugDumpAppState()
	return findModel(state, modelName)
}

const waitForRegistryProject = async (
	runtime: ReturnType<typeof createMiniCutDktRuntime>,
	projectId: string,
) => {
	for (let attempt = 0; attempt < 20; attempt++) {
		const snapshot = await runtime.getRegistryState()
		if (snapshot.projects[projectId]) {
			return snapshot
		}
		await new Promise((resolve) => setTimeout(resolve, 0))
	}

	return runtime.getRegistryState()
}

const waitForRegistryProjectTrackCount = async (
	runtime: ReturnType<typeof createMiniCutDktRuntime>,
	projectId: string,
	count: number,
) => {
	for (let attempt = 0; attempt < 40; attempt++) {
		const snapshot = await runtime.getRegistryState()
		const project = snapshot.projects[projectId]
		const projectEntity = project ? snapshot.entitiesById[project.rootEntityId] : null
		const timeline = projectEntity ? snapshot.entitiesById[String(projectEntity.rels.activeTimeline)] : null
		if (Array.isArray(timeline?.rels.tracks) && timeline.rels.tracks.length === count) {
			return snapshot
		}
		await new Promise((resolve) => setTimeout(resolve, 0))
	}

	return runtime.getRegistryState()
}

const createMemoryTransport = () => {
	const listeners = new Set<(message: MiniCutDktTransportMessage) => void>()
	const sent: MiniCutDktTransportMessage[] = []

	return {
		transport: {
			send(message: MiniCutDktTransportMessage) {
				sent.push(message)
			},
			listen(listener: (message: MiniCutDktTransportMessage) => void) {
				listeners.add(listener)
				return () => listeners.delete(listener)
			},
			destroy() {
				listeners.clear()
			},
		},
		sent,
		emit(message: MiniCutDktTransportMessage) {
			for (const listener of [...listeners]) {
				listener(message)
			}
		},
	}
}

const waitForTransportMessage = async (
	transport: ReturnType<typeof createMemoryTransport>,
	predicate: (message: MiniCutDktTransportMessage) => boolean,
) => {
	for (let attempt = 0; attempt < 40; attempt += 1) {
		const match = transport.sent.find(predicate)
		if (match) {
			return match
		}
		await new Promise((resolve) => setTimeout(resolve, 0))
	}

	return transport.sent.find(predicate) ?? null
}

describe('createMiniCutDktRuntime', () => {
	it('does not boot while disabled', async () => {
		const runtime = createMiniCutDktRuntime()
		expect(await runtime.bootstrapApp()).toBeNull()
		expect(await runtime.debugDumpAppState()).toBeNull()
		await expect(runtime.dispatchAction('setActiveProjectHint', 'project:1')).rejects.toThrow('disabled')
	})

	it('boots MiniCut DKT app root and dispatches a pure root action', async () => {
		const runtime = createMiniCutDktRuntime({ enabled: true })
		const boot = await runtime.bootstrapApp()
		expect(boot?.appModel.model_name).toBe('minicut_app_root')

		await runtime.dispatchAction('setActiveProjectHint', 'project:dkt')
		const appRoot = await waitForModelAttr(runtime, 'minicut_app_root', 'activeProjectHint', 'project:dkt')

		expect(appRoot?.attrs.activeProjectHint).toBe('project:dkt')
		expect(appRoot?.attrs.hasProjects).toBe(false)
	})

	it('boots a DKT session root and dispatches session actions', async () => {
		const runtime = createMiniCutDktRuntime({ enabled: true })
		const sessionRoot = await runtime.bootstrapSessionRoot()
		expect(sessionRoot?.model_name).toBe('minicut_session_root')

		await runtime.dispatchSessionAction('setCursor', 4.129)
		await runtime.dispatchSessionAction('selectEntity', 'clip:session')
		const model = await waitForModelAttr(runtime, 'minicut_session_root', 'selectedEntityId', 'clip:session')

		expect(model?.attrs.cursor).toBe(4.13)
		expect(model?.attrs.selectedEntityId).toBe('clip:session')
	})

	it('creates an active project with default tracks from the session root action', async () => {
		const runtime = createMiniCutDktRuntime({ enabled: true })

		await runtime.dispatchSessionAction('createProject', {
			sourceProjectId: 'project:session-create',
			title: 'Session Project',
		})

		const registry = await waitForRegistryProjectTrackCount(runtime, 'project:session-create', 2)
		const project = registry.projects['project:session-create']
		expect(project).toBeTruthy()
		const projectEntity = registry.entitiesById[project.rootEntityId]
		const timeline = registry.entitiesById[String(projectEntity.rels.activeTimeline)]
		expect(timeline.rels.tracks).toHaveLength(2)
	})

	it('creates a DKT clip seed and dispatches scoped clip actions', async () => {
		const runtime = createMiniCutDktRuntime({ enabled: true })
		const clipSeed = {
			sourceClipId: 'clip:opacity',
			name: 'Opacity clip',
			color: '#ef4444',
			start: 1,
			in: 1,
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
		}
		await runtime.dispatchClipAction(clipSeed, 'updateOpacity', { opacityPercent: 37 })
		await runtime.dispatchClipAction(clipSeed, 'rename', { name: 'Renamed clip' })
		await runtime.dispatchClipAction(clipSeed, 'setFade', { edge: 'in', delta: 0.5 })
		await runtime.dispatchClipAction(clipSeed, 'trim', { edge: 'start', delta: 0.5 })

		const model = await waitForModelAttr(runtime, 'minicut_clip', 'start', 1.5)
		expect(model?.attrs.sourceClipId).toBe('clip:opacity')
		expect(model?.attrs.name).toBe('Renamed clip')
		expect(model?.attrs.fadeIn).toBe(0.5)
		expect(model?.attrs.start).toBe(1.5)
		expect(model?.attrs.in).toBe(1.5)
		expect(model?.attrs.duration).toBe(3.5)
		expect(model?.attrs.opacity).toEqual({ value: 0.4 })
	})

	it('creates DKT text and effect seeds and dispatches attr actions', async () => {
		const runtime = createMiniCutDktRuntime({ enabled: true })
		const textSeed = {
			sourceTextId: 'text:caption',
			content: 'Before',
			style: { fontSize: 64, color: '#ffffff' },
			box: { width: 760, height: 220 },
		}
		await runtime.dispatchTextAction(textSeed, 'setTextContent', { content: 'After' })
		await runtime.dispatchTextAction(textSeed, 'setTextStyle', { style: { color: '#111827' } })

		await runtime.dispatchEffectAction({
			sourceEffectId: 'effect:tint',
			name: 'Tint',
			kind: 'tint',
			enabled: true,
			amount: 0.25,
		}, 'setEffectAmount', { amount: 0.8 })

		const text = await waitForModelAttr(runtime, 'minicut_text', 'content', 'After')
		const effect = await waitForModelAttr(runtime, 'minicut_effect', 'amount', 0.8)

		expect(text?.attrs.sourceTextId).toBe('text:caption')
		expect(text?.attrs.style).toMatchObject({ color: '#111827' })
		expect(effect?.attrs.sourceEffectId).toBe('effect:tint')
		expect(effect?.attrs.amount).toBe(0.8)
	})

	it('creates structural project, track, and resource seeds', async () => {
		const runtime = createMiniCutDktRuntime({ enabled: true })

		await runtime.dispatchProjectAction({
			sourceProjectId: 'project:main',
			title: 'Before',
			fps: 30,
			width: 1920,
			height: 1080,
		}, 'renameProject', { title: 'After' })
		await runtime.dispatchTrackAction({
			sourceTrackId: 'track:video',
			kind: 'video',
			name: 'Video',
		}, 'setTrackMuted', { muted: true })
		await runtime.dispatchResourceAction({
			sourceResourceId: 'resource:asset',
			name: 'Asset',
			kind: 'video',
			url: 'sample://asset',
			mime: 'video/sample',
		}, 'setResourceStatus', { status: 'ready' })

		const project = await waitForModelAttr(runtime, 'minicut_project', 'title', 'After')
		const track = await waitForModelAttr(runtime, 'minicut_track', 'muted', true)
		const resource = await waitForModelAttr(runtime, 'minicut_resource', 'status', 'ready')

		expect(project?.attrs.sourceProjectId).toBe('project:main')
		expect(track?.attrs.sourceTrackId).toBe('track:video')
		expect(resource?.attrs.sourceResourceId).toBe('resource:asset')
	})

	it('creates hierarchy children through model-owned DKT actions', async () => {
		const runtime = createMiniCutDktRuntime({ enabled: true })
		const projectSeed = {
			sourceProjectId: 'project:hierarchy',
			title: 'Hierarchy',
		}
		const trackSeed = {
			sourceTrackId: 'track:hierarchy-video',
			kind: 'video' as const,
			name: 'Video Track',
		}
		const clipSeed = {
			sourceClipId: 'clip:hierarchy-text',
			name: 'Text Clip',
			start: 0,
			in: 0,
			duration: 3,
		}

		await runtime.dispatchProjectAction(projectSeed, 'addTrack', trackSeed)
		await runtime.dispatchProjectAction(projectSeed, 'importResource', {
			sourceResourceId: 'resource:hierarchy-video',
			name: 'Hierarchy Video',
			kind: 'video',
			status: 'ready',
		})
		await runtime.dispatchTrackAction(trackSeed, 'addClip', clipSeed)
		await runtime.dispatchTrackAction(trackSeed, 'addTextClip', {
			...clipSeed,
			sourceClipId: 'clip:hierarchy-title',
			text: {
				sourceTextId: 'text:hierarchy-title',
				content: 'Title',
			},
		})
		await runtime.dispatchClipAction(clipSeed, 'addEffect', {
			sourceEffectId: 'effect:hierarchy-blur',
			name: 'Blur',
			kind: 'blur',
			amount: 0.2,
		})

		const track = await waitForModelAttr(runtime, 'minicut_track', 'sourceTrackId', 'track:hierarchy-video')
		const resource = await waitForModelAttr(runtime, 'minicut_resource', 'sourceResourceId', 'resource:hierarchy-video')
		const clip = await waitForModelAttr(runtime, 'minicut_clip', 'sourceClipId', 'clip:hierarchy-text')
		const text = await waitForModelAttr(runtime, 'minicut_text', 'sourceTextId', 'text:hierarchy-title')
		const effect = await waitForModelAttr(runtime, 'minicut_effect', 'sourceEffectId', 'effect:hierarchy-blur')

		expect(track?.attrs.name).toBe('Video Track')
		expect(resource?.attrs.status).toBe('ready')
		expect(clip?.attrs.duration).toBe(3)
		expect(text?.attrs.content).toBe('Title')
		expect(effect?.attrs.amount).toBe(0.2)
	})

	it('owns command dispatch state as a DKT root registry snapshot', async () => {
		const runtime = createMiniCutDktRuntime({ enabled: true })
		const result = await runtime.dispatchCommand({ c: CMD.PROJECT_CREATE, p: { title: 'DKT Project' } })
		const projectId = result.createdIds?.projectId
		const snapshot = await waitForRegistryProject(runtime, String(projectId))
		const projectModel = await waitForModelAttr(runtime, 'minicut_project', 'sourceProjectId', String(projectId))
		const appRoot = await waitForModelAttr(runtime, 'minicut_app_root', 'hasProjects', true)

		expect(projectId).toBeTypeOf('string')
		expect(snapshot.projects[String(projectId)]).toBeTruthy()
		expect(Object.keys(snapshot.entitiesById).length).toBeGreaterThan(0)
		expect(projectModel?.attrs.sourceProjectId).toBe(String(projectId))
		expect(Array.isArray(appRoot?.rels.project)).toBe(true)
		expect((appRoot?.rels.project as unknown[] | undefined)?.length ?? 0).toBeGreaterThan(0)

		const importResult = await runtime.dispatchCommand({
			c: CMD.RESOURCE_IMPORT,
			p: {
				projectId: String(projectId),
				name: 'Imported Asset',
				kind: 'video',
				duration: 5,
				url: 'sample://imported',
				mime: 'video/sample',
			},
		})
		const resourceId = String(importResult.createdIds?.resourceId)
		const resourceModel = await waitForModelAttr(runtime, 'minicut_resource', 'sourceResourceId', resourceId)
		const projectWithResources = await waitForModelRel(runtime, 'minicut_project', 'sourceProjectId', String(projectId), 'resources')

		expect(resourceModel?.attrs.name).toBe('Imported Asset')
		expect(Array.isArray(projectWithResources?.rels.resources)).toBe(true)
		expect((projectWithResources?.rels.resources as unknown[] | undefined)?.length ?? 0).toBeGreaterThan(0)
	})

	it('materializes project hierarchy when replacing the registry snapshot directly', async () => {
		const runtime = createMiniCutDktRuntime({ enabled: true })
		const registry = createEmptyRegistry()
		const created = createProjectGraph('Snapshot Project', 1)
		registry.activeProjectId = created.project.id
		registry.projects[created.project.id] = created.project
		for (const entity of created.entities) {
			registry.entitiesById[entity.id] = entity
		}

		await runtime.replaceRegistryState(registry)

		const projectModel = await waitForModelRel(runtime, 'minicut_project', 'sourceProjectId', created.project.id, 'tracks')
		const firstTrack = created.entities.find((entity) => entity.type === 'track')
		const trackModel = firstTrack ? await waitForModelAttr(runtime, 'minicut_track', 'sourceTrackId', firstTrack.id) : null
		const appRoot = await waitForModelAttr(runtime, 'minicut_app_root', 'hasProjects', true)
		expect(projectModel?.attrs.sourceProjectId).toBe(created.project.id)
		expect(trackModel?.attrs.sourceTrackId).toBe(firstTrack?.id)
		expect(Array.isArray(projectModel?.rels.tracks)).toBe(true)
		expect((projectModel?.rels.tracks as unknown[] | undefined)?.length ?? 0).toBeGreaterThan(0)
		expect(Array.isArray(appRoot?.rels.project)).toBe(true)
		expect((appRoot?.rels.project as unknown[] | undefined)?.length ?? 0).toBeGreaterThan(0)
	})

	it('boots transport sync on the session root and resolves scoped dispatch inside that tree', async () => {
		const runtime = createMiniCutDktRuntime({ enabled: true })
		const memory = createMemoryTransport()
		const connection = runtime.connect(memory.transport)

		try {
			memory.emit({ type: DKT_MSG.BOOTSTRAP, sessionKey: 'session:transport' })
			const sessionRoot = await runtime.bootstrapSessionRoot('session:transport')
			const readyMessage = await waitForTransportMessage(
				memory,
				(message) => message.type === DKT_MSG.RUNTIME_READY,
			)

			expect(readyMessage).toMatchObject({
				type: DKT_MSG.RUNTIME_READY,
				sessionKey: 'session:transport',
				rootNodeId: sessionRoot?._node_id ?? null,
			})

			memory.emit({
				type: DKT_MSG.DISPATCH_ACTION,
				actionName: 'setCursor',
				payload: 7.25,
				scopeNodeId: sessionRoot?._node_id ?? null,
			})

			const model = await waitForModelAttr(runtime, 'minicut_session_root', 'cursor', 7.25)
			expect(model?.attrs.cursor).toBe(7.25)
		} finally {
			connection.destroy()
		}
	})
})
