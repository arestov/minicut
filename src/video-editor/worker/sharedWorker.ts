/// <reference lib="webworker" />

import { buildDispatchResult } from '../domain/applyCommand'
import { applyPatchEnvelopeInPlace } from '../domain/applyPatchInPlace'
import { createEmptyRegistry } from '../domain/createProject'
import { MSG, PATCH, type Command, type DispatchResult, type HistoryState, type PatchEnvelope, type ProjectRegistry, type WireMessage } from '../domain/types'
import { buildWorkerDerivedIndexes } from './derivedIndexes'

const ports = new Set<MessagePort>()
let registry: ProjectRegistry = createEmptyRegistry()
let indexes = buildWorkerDerivedIndexes(registry)
const undoStack: ProjectRegistry[] = []
let redoStack: ProjectRegistry[] = []

const post = <Payload>(port: MessagePort, message: WireMessage<Payload>): void => {
	port.postMessage(message)
}

const broadcastPatch = (envelope: PatchEnvelope): void => {
	for (const port of ports) {
		post(port, { m: MSG.PATCHES, p: envelope })
	}
}

const getHistoryState = (): HistoryState => ({ canUndo: undoStack.length > 0, canRedo: redoStack.length > 0 })

const getRegistryEnvelopeProjectId = (snapshot: ProjectRegistry): string =>
	snapshot.activeProjectId ?? Object.keys(snapshot.projects)[0] ?? '__workspace__'

const createRegistrySetEnvelope = (snapshot: ProjectRegistry): PatchEnvelope => {
	const projectId = getRegistryEnvelopeProjectId(snapshot)
	return {
		projectId,
		version: snapshot.projects[projectId]?.version ?? 0,
		patches: [{ c: PATCH.REGISTRY_SET, p: { registry: structuredClone(snapshot) } }],
	}
}

const cleanupPort = (port: MessagePort): void => {
	ports.delete(port)
	port.onmessage = null
	port.onmessageerror = null
	port.close()
}

const handleCommand = (port: MessagePort, requestId: string | undefined, command: Command): void => {
	try {
		const before = structuredClone(registry)
		const result: DispatchResult = buildDispatchResult(registry, command, indexes)
		applyPatchEnvelopeInPlace(registry, result.envelope)
		indexes = buildWorkerDerivedIndexes(registry)
		undoStack.push(before)
		redoStack = []
		broadcastPatch(result.envelope)
		post(port, { m: MSG.DISPATCH_RESULT, requestId, p: result })
	} catch (error) {
		post(port, {
			m: MSG.ERROR,
			requestId,
			p: error instanceof Error ? error.message : String(error),
		})
	}
}

const handleUndo = (port: MessagePort, requestId: string | undefined): void => {
	try {
		const previous = undoStack.pop()
		if (!previous) {
			post(port, { m: MSG.DISPATCH_RESULT, requestId, p: null })
			return
		}

		redoStack.push(structuredClone(registry))
		registry = structuredClone(previous)
		indexes = buildWorkerDerivedIndexes(registry)
		const envelope = createRegistrySetEnvelope(registry)
		broadcastPatch(envelope)
		post(port, { m: MSG.DISPATCH_RESULT, requestId, p: envelope })
	} catch (error) {
		post(port, { m: MSG.ERROR, requestId, p: error instanceof Error ? error.message : String(error) })
	}
}

const handleRedo = (port: MessagePort, requestId: string | undefined): void => {
	try {
		const next = redoStack.pop()
		if (!next) {
			post(port, { m: MSG.DISPATCH_RESULT, requestId, p: null })
			return
		}

		undoStack.push(structuredClone(registry))
		registry = structuredClone(next)
		indexes = buildWorkerDerivedIndexes(registry)
		const envelope = createRegistrySetEnvelope(registry)
		broadcastPatch(envelope)
		post(port, { m: MSG.DISPATCH_RESULT, requestId, p: envelope })
	} catch (error) {
		post(port, { m: MSG.ERROR, requestId, p: error instanceof Error ? error.message : String(error) })
	}
}

const sharedWorkerScope = self as unknown as SharedWorkerGlobalScope

sharedWorkerScope.onconnect = (event: MessageEvent) => {
	const port = event.ports[0]
	ports.add(port)

	port.onmessage = (messageEvent: MessageEvent<WireMessage>) => {
		const message = messageEvent.data
		switch (message.m) {
			case MSG.SNAPSHOT_REQUEST:
				post(port, { m: MSG.SNAPSHOT, requestId: message.requestId, p: structuredClone(registry) })
				break

			case MSG.HISTORY_STATE_REQUEST:
				post(port, { m: MSG.HISTORY_STATE, requestId: message.requestId, p: getHistoryState() })
				break

			case MSG.REGISTRY_RESTORE_REQUEST: {
				registry = structuredClone(message.p as ProjectRegistry)
				indexes = buildWorkerDerivedIndexes(registry)
				undoStack.length = 0
				redoStack = []
				const envelope = createRegistrySetEnvelope(registry)
				broadcastPatch(envelope)
				post(port, { m: MSG.REGISTRY_RESTORE_ACK, requestId: message.requestId, p: true })
				break
			}

			case MSG.COMMAND:
				handleCommand(port, message.requestId, message.p as Command)
				break

			case MSG.UNDO:
				handleUndo(port, message.requestId)
				break

			case MSG.REDO:
				handleRedo(port, message.requestId)
				break

			case MSG.DISCONNECT:
				cleanupPort(port)
				break

			default:
				post(port, {
					m: MSG.ERROR,
					requestId: message.requestId,
					p: `Unsupported message code ${message.m}`,
				})
		}
	}

	port.onmessageerror = () => {
		cleanupPort(port)
	}

	port.start()
}

export {}