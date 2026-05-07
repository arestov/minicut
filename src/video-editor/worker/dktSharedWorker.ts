/// <reference lib="webworker" />

import { createMiniCutDktWorkerModelRuntime } from '../dkt/runtime/workerModelRuntime'
import { createPortTransport } from '../dkt/shared/createPortTransport'
import { DKT_MSG, type MiniCutDktTransportMessage } from '../dkt/shared/messageTypes'

const runtime = createMiniCutDktWorkerModelRuntime()

const sharedWorkerScope = self as unknown as SharedWorkerGlobalScope

sharedWorkerScope.onconnect = (event: MessageEvent) => {
	const port = event.ports[0]
	if (!port) {
		return
	}

	const transport = createPortTransport<MiniCutDktTransportMessage>(port)
	const sendWorkerLog = (message: string, extra?: unknown) => {
		const suffix = extra === undefined
			? ''
			: ` ${typeof extra === 'string' ? extra : JSON.stringify(extra)}`
		transport.send({ type: DKT_MSG.RUNTIME_LOG, message: `[worker] ${message}${suffix}` })
	}

	const unlistenDebug = transport.listen((message) => {
		if (message.type !== DKT_MSG.BOOTSTRAP && message.type !== DKT_MSG.DISPATCH_ACTION) {
			return
		}
		if (message.type === DKT_MSG.DISPATCH_ACTION && message.actionName !== 'setActiveInspectorTab') {
			sendWorkerLog('message', {
				type: message.type,
				actionName: message.actionName,
				scopeNodeId: message.scopeNodeId ?? null,
				sessions: runtime.getActiveSessionKeys(),
				connections: runtime.getConnectionCount(),
			})
			return
		}
		sendWorkerLog('message', {
			type: message.type,
			sessions: runtime.getActiveSessionKeys(),
			connections: runtime.getConnectionCount(),
		})
	})
	const connection = runtime.connect(transport)

	port.onmessageerror = (error) => {
		transport.send({
			type: DKT_MSG.RUNTIME_ERROR,
			message: error instanceof Error ? error.stack || error.message : String(error),
		})
	}

	port.start()
	sendWorkerLog('MiniCut DKT worker attached', {
		sessions: runtime.getActiveSessionKeys(),
		connections: runtime.getConnectionCount(),
	})
	void runtime.getRuntimeSnapshot().then((snapshot) => {
		sendWorkerLog('runtime snapshot', snapshot)
	}).catch((error) => {
		transport.send({
			type: DKT_MSG.RUNTIME_ERROR,
			message: error instanceof Error ? error.stack || error.message : String(error),
		})
	})

	const cleanup = () => {
		unlistenDebug()
		connection.destroy()
	}

	port.addEventListener?.('close', cleanup as EventListener)
}

export {}
