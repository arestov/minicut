/// <reference lib="webworker" />

import { createMiniCutDktRuntime } from '../dkt/runtime/createMiniCutDktRuntime'
import { createPortTransport } from '../dkt/shared/createPortTransport'
import { DKT_MSG, type MiniCutDktTransportMessage } from '../dkt/shared/messageTypes'

const runtime = createMiniCutDktRuntime({ enabled: true })

const emitError = (
	transport: ReturnType<typeof createPortTransport<MiniCutDktTransportMessage>>,
	error: unknown,
): void => {
	transport.send({
		type: DKT_MSG.RUNTIME_ERROR,
		message: error instanceof Error ? error.stack || error.message : String(error),
	})
}

const sharedWorkerScope = self as unknown as SharedWorkerGlobalScope

sharedWorkerScope.onconnect = (event: MessageEvent) => {
	const port = event.ports[0]
	if (!port) {
		return
	}

	const transport = createPortTransport<MiniCutDktTransportMessage>(port)
	const unlisten = transport.listen((message) => {
		Promise.resolve((async () => {
			switch (message.type) {
				case DKT_MSG.BOOTSTRAP: {
					const app = await runtime.bootstrapApp()
					transport.send({
						type: DKT_MSG.RUNTIME_READY,
						rootNodeId: app?.appModel._node_id ?? null,
					})
					return
				}
				case DKT_MSG.DISPATCH_ACTION:
					await runtime.dispatchAction(message.actionName, message.payload, message.scopeNodeId)
					return
			}
		})()).catch((error) => emitError(transport, error))
	})

	port.onmessageerror = (error) => {
		emitError(transport, error)
	}

	port.start()
	transport.send({ type: DKT_MSG.RUNTIME_LOG, message: 'MiniCut DKT worker attached' })

	const cleanup = () => {
		unlisten()
		transport.destroy()
	}

	port.addEventListener?.('close', cleanup as EventListener)
}

export {}
