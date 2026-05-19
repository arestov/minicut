import { writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createInMemoryCrdtRelay } from '../src/video-editor/dkt/crdt/createInMemoryCrdtRelay.ts'
import { createTestWorkerCrdtTransport } from '../src/video-editor/dkt/crdt/createTestWorkerCrdtTransport.ts'
import { DKT_MSG } from '../src/video-editor/dkt/shared/messageTypes.ts'
import { createMiniCutDktRuntime } from '../src/video-editor/dkt/runtime/createMiniCutDktRuntime.ts'
import { createMiniCutPageSyncRuntime } from '../src/video-editor/dkt/runtime/createMiniCutPageSyncRuntime.ts'
import { miniCutEditorRootShape } from '../src/video-editor/ui/dkt/shapes.ts'

const args = new Set(process.argv.slice(2))
const ROOM_ID = process.env.MINICUT_REPRO_ROOM ?? `node-page-crdt-${Date.now()}`
const REPORT_PATH = process.env.MINICUT_REPRO_REPORT_PATH ?? path.join(os.tmpdir(), `minicut-node-page-crdt-${Date.now()}.json`)
const PROFILE_ID = 'minicut-crdt-v1'
const PROFILE_VERSION = 1
const unhandledErrors = []

process.on('uncaughtException', (error) => {
	unhandledErrors.push(error instanceof Error ? error.stack || error.message : String(error))
})
process.on('unhandledRejection', (error) => {
	unhandledErrors.push(error instanceof Error ? error.stack || error.message : String(error))
})

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

const createDuplexTransport = () => {
	const pageListeners = new Set()
	const workerListeners = new Set()
	const pageSent = []
	const workerSent = []
	const page = {
		send(message) {
			pageSent.push(message)
			for (const listener of [...workerListeners]) listener(message)
		},
		listen(listener) {
			pageListeners.add(listener)
			return () => pageListeners.delete(listener)
		},
		destroy() {
			pageListeners.clear()
			workerListeners.clear()
		},
	}
	const worker = {
		send(message) {
			workerSent.push(message)
			for (const listener of [...pageListeners]) listener(message)
		},
		listen(listener) {
			workerListeners.add(listener)
			return () => workerListeners.delete(listener)
		},
		destroy() {
			pageListeners.clear()
			workerListeners.clear()
		},
	}
	return { page, worker, pageSent, workerSent }
}

const waitFor = async (label, fn, timeoutMs = 15_000) => {
	const startedAt = Date.now()
	let lastError = null
	while (Date.now() - startedAt < timeoutMs) {
		try {
			const value = await fn()
			if (value) return value
		} catch (error) {
			lastError = error
		}
		await delay(20)
	}
	throw new Error(`${label} timed out${lastError ? `: ${lastError.message}` : ''}`)
}

const waitPageIdle = (pageRuntime) =>
	pageRuntime.waitForRuntimeSettled?.() ?? Promise.resolve()

const makePeer = async ({ peerName, relay }) => {
	const crdtPeerId = `minicut-node:${ROOM_ID}:peer:${peerName}`
	const crdtTransport = createTestWorkerCrdtTransport({
		relay,
		roomId: ROOM_ID,
		peerId: crdtPeerId,
		profileId: PROFILE_ID,
		profileVersion: PROFILE_VERSION,
	})
	const runtime = createMiniCutDktRuntime({
		enabled: true,
		crdt: {
			enabled: true,
			peerId: crdtPeerId,
			storage: 'memory',
			transport: crdtTransport,
		},
		unloadModels: true,
	})
	const bridge = createDuplexTransport()
	const connection = runtime.connect(bridge.worker)
	const pageRuntime = createMiniCutPageSyncRuntime({ transport: bridge.page })
	pageRuntime.bootstrap({
		sessionKey: ROOM_ID,
		sessionId: `${ROOM_ID}:peer:${peerName}`,
	})
	await waitFor(`${peerName}: page ready`, () => pageRuntime.getSnapshot().ready)
	const rootScope = pageRuntime.getRootScope()
	const unmountShape = rootScope ? pageRuntime.mountShape(rootScope, miniCutEditorRootShape) : () => {}
	await waitPageIdle(pageRuntime)
	return {
		peerName,
		crdtTransport,
		runtime,
		connection,
		pageRuntime,
		bridge,
		close() {
			unmountShape()
			crdtTransport.close()
			connection.destroy()
			bridge.page.destroy()
			bridge.worker.destroy()
		},
	}
}

const scope = (nodeId) => ({ kind: 'scope', _nodeId: nodeId })

const readPageProject = (pageRuntime, projectScope) => {
	if (!projectScope) return null
	const attrs = pageRuntime.readAttrs(projectScope, ['title', 'duration', 'timelineDuration'])
	const tracks = pageRuntime.readMany(projectScope, 'tracks').map((trackScope) => {
		const trackAttrs = pageRuntime.readAttrs(trackScope, ['kind', 'name', 'appendStart'])
		const clips = pageRuntime.readMany(trackScope, 'clips').map((clipScope) => {
			const clipAttrs = pageRuntime.readAttrs(clipScope, [
				'name',
				'mediaKind',
				'start',
				'in',
				'duration',
				'$meta$model$crdt$open_conflicts_count',
				'$meta$attrs$crdt$duration$open_conflicts_count',
				'$meta$aggregates$crdt$clipTiming$open_conflicts_count',
			])
			return { nodeId: clipScope._nodeId, attrs: clipAttrs }
		})
		return { nodeId: trackScope._nodeId, attrs: trackAttrs, clips }
	})
	const resources = pageRuntime.readMany(projectScope, 'resources').map((resourceScope) => {
		const attrs = pageRuntime.readAttrs(resourceScope, ['name', 'kind', 'duration', 'status'])
		return { nodeId: resourceScope._nodeId, attrs }
	})
	return { nodeId: projectScope._nodeId, attrs, tracks, resources }
}

const summarizePage = (peer) => {
	const runtime = peer.pageRuntime
	const root = runtime.getRootScope()
	const snapshot = runtime.getSnapshot()
	if (!root) return { snapshot, root: null }
	const activeProject = runtime.readOne(root, 'activeProject')
	const pioneer = runtime.readOne(root, 'pioneer')
	const pioneerProjects = pioneer ? runtime.readMany(pioneer, 'project') : []
	const graph = runtime.debugDumpGraph()
	const projectNodes = graph.nodes
		.filter((node) => node.modelName === 'project')
		.map((node) => ({
			nodeId: node.nodeId,
			title: node.attrs.title,
			tracks: node.rels.tracks ?? null,
			resources: node.rels.resources ?? null,
		}))
	return {
		snapshot,
		rootNodeId: root._nodeId,
		activeProjectId: activeProject?._nodeId ?? null,
		pioneerProjectIds: pioneerProjects.map((item) => item._nodeId),
		projectNodes,
		activeProject: readPageProject(runtime, activeProject),
		graphNodeCount: graph.nodes.length,
	}
}

const summarizeWorker = async (peer) => {
	const dump = await peer.pageRuntime.requestDebugDump?.()
	const runtimeModels = Array.isArray(dump?.runtimeModels) ? dump.runtimeModels : []
	const projects = runtimeModels
		.filter((model) => model.modelName === 'project')
		.map((model) => ({
			nodeId: model.nodeId,
			title: model.attrs?.title,
			tracks: model.rels?.tracks ?? null,
			resources: model.rels?.resources ?? null,
		}))
	const sessionRoots = runtimeModels
		.filter((model) => model.modelName === 'session_root')
		.map((model) => ({
			nodeId: model.nodeId,
			activeProjectId: model.attrs?.activeProjectId ?? null,
			activeProject: model.rels?.activeProject ?? null,
			sessionKey: model.attrs?.sessionKey ?? null,
		}))
	return {
		projects,
		sessionRoots,
		crdt: dump?.crdt ?? null,
		modelsCount: dump?.modelsCount ?? runtimeModels.length,
	}
}

const summarizePeer = async (peer) => ({
	peerName: peer.peerName,
	page: summarizePage(peer),
	worker: await summarizeWorker(peer),
	pageMessagesTail: peer.pageRuntime.debugMessages?.().slice(-12) ?? [],
	crdtReceived: peer.crdtTransport.received.length,
})

const compactStage = (stage) => ({
	stage: stage.stage,
	A: {
		pageActive: stage.A.page.activeProjectId,
		pageProjects: stage.A.page.projectNodes.map((project) => ({
			id: project.nodeId,
			tracks: Array.isArray(project.tracks) ? project.tracks.length : 0,
			resources: Array.isArray(project.resources) ? project.resources.length : 0,
		})),
		workerProjects: stage.A.worker.projects.map((project) => ({
			id: project.nodeId,
			tracks: Array.isArray(project.tracks) ? project.tracks.length : 0,
			resources: Array.isArray(project.resources) ? project.resources.length : 0,
		})),
	},
	B: {
		pageActive: stage.B.page.activeProjectId,
		pageProjects: stage.B.page.projectNodes.map((project) => ({
			id: project.nodeId,
			tracks: Array.isArray(project.tracks) ? project.tracks.length : 0,
			resources: Array.isArray(project.resources) ? project.resources.length : 0,
		})),
		workerProjects: stage.B.worker.projects.map((project) => ({
			id: project.nodeId,
			tracks: Array.isArray(project.tracks) ? project.tracks.length : 0,
			resources: Array.isArray(project.resources) ? project.resources.length : 0,
		})),
	},
})

const compactResult = (result) => ({
	ok: result.ok,
	roomId: result.roomId,
	error: result.error?.split('\n')[0] ?? null,
	sourceProjectId: result.sourceProjectId ?? null,
	selectedOnB: result.selectedOnB ?? null,
	unhandledErrors: result.unhandledErrors?.map((item) => item.split('\n')[0]) ?? [],
	reportPath: result.reportPath,
	stages: result.stages?.map(compactStage) ?? [],
})

const selectActiveProjectById = async (peer, projectId) => {
	const root = peer.pageRuntime.getRootScope()
	if (!root) throw new Error(`${peer.peerName}: missing root scope`)
	peer.pageRuntime.dispatch('setActiveProject', projectId, root)
	await waitPageIdle(peer.pageRuntime)
	const active = peer.pageRuntime.readOne(root, 'activeProject')
	return active?._nodeId ?? null
}

const addVideoAndAudioClipDirectly = async (peer) => {
	const root = peer.pageRuntime.getRootScope()
	const activeProject = root ? peer.pageRuntime.readOne(root, 'activeProject') : null
	if (!activeProject) throw new Error(`${peer.peerName}: missing active project`)
	const tracks = peer.pageRuntime.readMany(activeProject, 'tracks')
	const trackSummaries = tracks.map((trackScope) => ({
		scope: trackScope,
		attrs: peer.pageRuntime.readAttrs(trackScope, ['kind', 'name']),
	}))
	const videoTrack = trackSummaries.find((item) => item.attrs.kind === 'video')?.scope ?? tracks[0]
	const audioTrack = trackSummaries.find((item) => item.attrs.kind === 'audio')?.scope ?? tracks[1]
	if (!videoTrack || !audioTrack) throw new Error(`${peer.peerName}: missing primary tracks`)
	peer.pageRuntime.dispatch('addClip', {
		name: 'node-fixture.webm',
		mediaKind: 'video',
		start: 0,
		in: 0,
		duration: 4,
	}, videoTrack)
	peer.pageRuntime.dispatch('addClip', {
		name: 'Embedded audio',
		mediaKind: 'audio',
		start: 0,
		in: 0,
		duration: 4,
	}, audioTrack)
	await waitPageIdle(peer.pageRuntime)
}

const resizeFirstVideoClip = async (peer, delta) => {
	const root = peer.pageRuntime.getRootScope()
	const activeProject = root ? peer.pageRuntime.readOne(root, 'activeProject') : null
	if (!activeProject) throw new Error(`${peer.peerName}: missing active project`)
	const clips = peer.pageRuntime
		.readMany(activeProject, 'tracks')
		.flatMap((trackScope) => peer.pageRuntime.readMany(trackScope, 'clips'))
	const clip = clips.find((clipScope) => {
		const attrs = peer.pageRuntime.readAttrs(clipScope, ['mediaKind', 'name'])
		return attrs.mediaKind === 'video' || attrs.name === 'node-fixture.webm'
	})
	if (!clip) throw new Error(`${peer.peerName}: missing video clip`)
	peer.pageRuntime.dispatch('resize', { edge: 'end', delta }, clip)
	await waitPageIdle(peer.pageRuntime)
	return clip._nodeId
}

const flushTransport = async (...peers) => {
	await Promise.all(peers.map((peer) =>
		peer.pageRuntime.waitForRuntimeSettled?.().catch(() => undefined) ?? Promise.resolve(),
	))
	await delay(25)
}

const main = async () => {
	const relay = createInMemoryCrdtRelay()
	const peerA = await makePeer({ peerName: 'A', relay })
	const peerB = await makePeer({ peerName: 'B', relay })
	const stages = []
	const capture = async (stage) => {
		stages.push({
			stage,
			relay: relay.getRoomSnapshot(ROOM_ID),
			A: await summarizePeer(peerA),
			B: await summarizePeer(peerB),
		})
	}

	try {
		await capture('boot')
		await addVideoAndAudioClipDirectly(peerA)
		await flushTransport(peerA, peerB)
		await capture('after-a-adds-clips')

		const sourceProjectId = summarizePage(peerA).activeProjectId
		const selectedOnB = sourceProjectId
			? await selectActiveProjectById(peerB, sourceProjectId)
			: null
		await capture('after-b-selects-a-project')

		peerA.crdtTransport.setDeliveryPaused(true)
		peerB.crdtTransport.setDeliveryPaused(true)
		await resizeFirstVideoClip(peerA, -1)
		await resizeFirstVideoClip(peerB, -2)
		await capture('after-partitioned-edits')

		peerA.crdtTransport.setDeliveryPaused(false)
		peerB.crdtTransport.setDeliveryPaused(false)
		peerA.crdtTransport.flushBufferedMessages()
		peerB.crdtTransport.flushBufferedMessages()
		await flushTransport(peerA, peerB)
		await capture('after-heal')

		const finalA = summarizePage(peerA)
		const finalB = summarizePage(peerB)
		const result = {
			ok: Boolean(
				sourceProjectId &&
				selectedOnB === sourceProjectId &&
				unhandledErrors.length === 0 &&
				finalA.activeProject?.tracks?.some((track) => track.clips.length > 0) &&
				finalB.activeProject?.tracks?.some((track) => track.clips.length > 0)
			),
			roomId: ROOM_ID,
			sourceProjectId,
			selectedOnB,
			unhandledErrors,
			reportPath: REPORT_PATH,
			stages,
		}
		await writeFile(REPORT_PATH, `${JSON.stringify(result, null, 2)}\n`, 'utf8')
		process.stdout.write(`${JSON.stringify(compactResult(result), null, 2)}\n`)
		if (!result.ok && !args.has('--allow-failure')) process.exitCode = 1
	} catch (error) {
		const result = {
			ok: false,
			roomId: ROOM_ID,
			error: error instanceof Error ? error.stack || error.message : String(error),
			unhandledErrors,
			reportPath: REPORT_PATH,
			stages,
			relay: relay.getRoomSnapshot(ROOM_ID),
		}
		await writeFile(REPORT_PATH, `${JSON.stringify(result, null, 2)}\n`, 'utf8')
		process.stderr.write(`${JSON.stringify(compactResult(result), null, 2)}\n`)
		if (!args.has('--allow-failure')) process.exitCode = 1
	} finally {
		peerA.close()
		peerB.close()
	}
}

await main().catch(async (error) => {
	const result = {
		ok: false,
		error: error instanceof Error ? error.stack || error.message : String(error),
		unhandledErrors,
		reportPath: REPORT_PATH,
	}
	await writeFile(REPORT_PATH, `${JSON.stringify(result, null, 2)}\n`, 'utf8').catch(() => undefined)
	process.stderr.write(`${JSON.stringify(result, null, 2)}\n`)
	process.exitCode = 1
})
