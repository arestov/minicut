import { describe, expect, it } from 'vitest'
import { createMiniCutDktRuntime } from './createMiniCutDktRuntime'
import { DKT_MSG, type MiniCutDktTransportMessage } from '../shared/messageTypes'

const waitFor = async (predicate: () => boolean): Promise<void> => {
	for (let attempt = 0; attempt < 80; attempt += 1) {
		if (predicate()) {
			return
		}
		await new Promise((resolve) => setTimeout(resolve, 0))
	}
	throw new Error('Timed out waiting for condition')
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

describe('createMiniCutDktRuntime export request channel', () => {
	it('publishes dkt:export-request directly after requestProjectExport action', async () => {
		const runtime = createMiniCutDktRuntime({ enabled: true })
		const memory = createMemoryTransport()
		const connection = runtime.connect(memory.transport)

		memory.emit({ type: DKT_MSG.BOOTSTRAP, sessionKey: 'session:export-channel' })
		await waitFor(() => memory.sent.some((message) => message.type === DKT_MSG.RUNTIME_READY))

		memory.emit({
			type: DKT_MSG.DISPATCH_ACTION,
			actionName: 'createProject',
			payload: {
				sourceProjectId: 'project:export-channel',
				title: 'Export channel test project',
			},
			scopeNodeId: null,
		})

		await waitFor(() =>
			memory.sent.some((message) =>
				message.type === DKT_MSG.SYNC_HANDLE,
			),
		)

		memory.emit({
			type: DKT_MSG.DISPATCH_ACTION,
			actionName: 'requestProjectExport',
			payload: {
				id: 'export:test-channel-1',
				initiatedBy: 'unit-test',
			},
			scopeNodeId: null,
		})

		await waitFor(() =>
			memory.sent.some((message) =>
				message.type === DKT_MSG.EXPORT_REQUEST
				&& (message.payload as { id?: unknown } | null)?.id === 'export:test-channel-1',
			),
		)

		const exportMessage = memory.sent.find((message) =>
			message.type === DKT_MSG.EXPORT_REQUEST
			&& (message.payload as { id?: unknown } | null)?.id === 'export:test-channel-1',
		)

		expect(exportMessage?.type).toBe(DKT_MSG.EXPORT_REQUEST)
		expect((exportMessage as { payload?: { range?: { type?: unknown } } } | undefined)?.payload?.range?.type).toBe('project')

		connection.destroy()
	})
})
