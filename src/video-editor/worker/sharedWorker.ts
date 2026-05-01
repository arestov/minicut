/// <reference lib="webworker" />

import { buildDispatchResult } from '../domain/applyCommand'
import { applyPatchEnvelopeToRegistry } from '../domain/applyPatch'
import { createEmptyRegistry } from '../domain/createProject'
import { MSG, type Command, type DispatchResult, type PatchEnvelope, type ProjectRegistry, type WireMessage } from '../domain/types'

const ports = new Set<MessagePort>()
let registry: ProjectRegistry = createEmptyRegistry()

const post = <Payload>(port: MessagePort, message: WireMessage<Payload>): void => {
	port.postMessage(message)
}

const broadcastPatch = (envelope: PatchEnvelope): void => {
	for (const port of ports) {
		post(port, { m: MSG.PATCHES, p: envelope })
	}
}

const handleCommand = (port: MessagePort, requestId: string | undefined, command: Command): void => {
	try {
		const result: DispatchResult = buildDispatchResult(registry, command)
		registry = applyPatchEnvelopeToRegistry(registry, result.envelope)
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

self.onconnect = (event: MessageEvent) => {
	const port = event.ports[0]
	ports.add(port)

	port.onmessage = (messageEvent: MessageEvent<WireMessage>) => {
		const message = messageEvent.data
		switch (message.m) {
			case MSG.SNAPSHOT_REQUEST:
				post(port, { m: MSG.SNAPSHOT, requestId: message.requestId, p: structuredClone(registry) })
				break

			case MSG.COMMAND:
				handleCommand(port, message.requestId, message.p as Command)
				break

			default:
				post(port, {
					m: MSG.ERROR,
					requestId: message.requestId,
					p: `Unsupported message code ${message.m}`,
				})
		}
	}

	port.start()
}

export {}