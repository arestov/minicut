/// <reference lib="webworker" />

import { createMiniCutDktRuntime } from '../dkt/runtime/createMiniCutDktRuntime'
import { createPortTransport } from '../dkt/shared/createPortTransport'
import { DKT_MSG, type MiniCutDktTransportMessage } from '../dkt/shared/messageTypes'

const runtime = createMiniCutDktRuntime({ enabled: true })

const sharedWorkerScope = self as unknown as SharedWorkerGlobalScope

sharedWorkerScope.onconnect = (event: MessageEvent) => {
	const port = event.ports[0]
	if (!port) {
		return
	}

	const transport = createPortTransport<MiniCutDktTransportMessage>(port)
	const connection = runtime.connect(transport)

	port.onmessageerror = (error) => {
		transport.send({
			type: DKT_MSG.RUNTIME_ERROR,
			message: error instanceof Error ? error.stack || error.message : String(error),
		})
	}

	port.start()
	transport.send({ type: DKT_MSG.RUNTIME_LOG, message: 'MiniCut DKT worker attached' })

	const cleanup = () => {
		connection.destroy()
	}

	port.addEventListener?.('close', cleanup as EventListener)
}

export {}
