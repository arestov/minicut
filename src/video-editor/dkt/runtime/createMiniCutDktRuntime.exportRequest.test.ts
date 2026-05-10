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
				&& ((message.payload as { request?: { id?: unknown } } | null)?.request?.id) === 'export:test-channel-1',
			),
		)

		const exportMessage = memory.sent.find((message) =>
			message.type === DKT_MSG.EXPORT_REQUEST
			&& ((message.payload as { request?: { id?: unknown } } | null)?.request?.id) === 'export:test-channel-1',
		)

		expect(exportMessage?.type).toBe(DKT_MSG.EXPORT_REQUEST)
		expect((exportMessage as { payload?: { request?: { range?: { type?: unknown } }; queueKey?: unknown } } | undefined)?.payload?.request?.range?.type).toBe('project')
		expect((exportMessage as { payload?: { queueKey?: unknown } } | undefined)?.payload?.queueKey).toBe('project')

		connection.destroy()
	})

	it('publishes dkt:import-files-request after requestImportFiles action', async () => {
		const runtime = createMiniCutDktRuntime({ enabled: true })
		const memory = createMemoryTransport()
		const connection = runtime.connect(memory.transport)

		memory.emit({ type: DKT_MSG.BOOTSTRAP, sessionKey: 'session:import-channel' })
		await waitFor(() => memory.sent.some((message) => message.type === DKT_MSG.RUNTIME_READY))

		memory.emit({
			type: DKT_MSG.DISPATCH_ACTION,
			actionName: 'createProject',
			payload: {
				sourceProjectId: 'project:import-channel',
				title: 'Import channel test project',
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
			actionName: 'requestImportFiles',
			payload: {
				inputBatchHandleId: 'input-batch:test-channel-1',
			},
			scopeNodeId: null,
		})

		await waitFor(() =>
			memory.sent.some((message) =>
				message.type === DKT_MSG.IMPORT_FILES_REQUEST
				&& (message.payload as { inputBatchHandleId?: unknown } | null)?.inputBatchHandleId === 'input-batch:test-channel-1',
			),
		)

		const importMessage = memory.sent.find((message) =>
			message.type === DKT_MSG.IMPORT_FILES_REQUEST
			&& (message.payload as { inputBatchHandleId?: unknown } | null)?.inputBatchHandleId === 'input-batch:test-channel-1',
		)

		expect(importMessage?.type).toBe(DKT_MSG.IMPORT_FILES_REQUEST)
		expect((importMessage as { payload?: { projectId?: unknown } } | undefined)?.payload?.projectId).toBe('project:import-channel')

		connection.destroy()
	})

	it('publishes dkt:export-request for clip and selected-clip export actions', async () => {
		const runtime = createMiniCutDktRuntime({ enabled: true })
		const memory = createMemoryTransport()
		const connection = runtime.connect(memory.transport)

		memory.emit({ type: DKT_MSG.BOOTSTRAP, sessionKey: 'session:export-clip-channel' })
		await waitFor(() => memory.sent.some((message) => message.type === DKT_MSG.RUNTIME_READY))

		memory.emit({
			type: DKT_MSG.DISPATCH_ACTION,
			actionName: 'createProject',
			payload: {
				sourceProjectId: 'project:export-clip-channel',
				title: 'Export clip channel test project',
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
			actionName: 'addTextClipToTimeline',
			payload: {
				sourceClipId: 'clip:export-target',
				sourceTextId: 'text:export-target',
				name: 'Export target clip',
				mediaKind: 'text',
				start: 2,
				in: 0,
				duration: 3,
				text: {
					sourceTextId: 'text:export-target',
					content: 'Export target text',
				},
			},
			scopeNodeId: null,
		})

		await waitFor(() =>
			memory.sent.filter((message) => message.type === DKT_MSG.SYNC_HANDLE).length >= 2,
		)

		memory.emit({
			type: DKT_MSG.DISPATCH_ACTION,
			actionName: 'requestClipExport',
			payload: {
				id: 'export:clip-channel',
				clipId: 'clip:export-target',
			},
			scopeNodeId: null,
		})

		await waitFor(() =>
			memory.sent.some((message) =>
				message.type === DKT_MSG.EXPORT_REQUEST
				&& ((message.payload as { request?: { id?: unknown } } | null)?.request?.id) === 'export:clip-channel',
			),
		)

		const clipExportMessage = memory.sent.find((message) =>
			message.type === DKT_MSG.EXPORT_REQUEST
			&& ((message.payload as { request?: { id?: unknown } } | null)?.request?.id) === 'export:clip-channel',
		)

		expect(clipExportMessage?.type).toBe(DKT_MSG.EXPORT_REQUEST)
		expect((clipExportMessage as { payload?: { request?: { range?: { type?: unknown; clipId?: unknown } }; queueKey?: unknown } } | undefined)?.payload?.request?.range).toEqual({
			type: 'clip',
			clipId: 'clip:export-target',
		})
		expect((clipExportMessage as { payload?: { queueKey?: unknown } } | undefined)?.payload?.queueKey).toBe('clip:clip:export-target')

		memory.emit({
			type: DKT_MSG.DISPATCH_ACTION,
			actionName: 'selectEntity',
			payload: 'clip:export-target',
			scopeNodeId: null,
		})

		await waitFor(() =>
			memory.sent.filter((message) => message.type === DKT_MSG.SYNC_HANDLE).length >= 3,
		)

		memory.emit({
			type: DKT_MSG.DISPATCH_ACTION,
			actionName: 'requestSelectedClipExport',
			payload: {
				id: 'export:selected-clip-channel',
			},
			scopeNodeId: null,
		})

		await waitFor(() =>
			memory.sent.some((message) =>
				message.type === DKT_MSG.EXPORT_REQUEST
				&& ((message.payload as { request?: { id?: unknown } } | null)?.request?.id) === 'export:selected-clip-channel',
			),
		)

		const selectedExportMessage = memory.sent.find((message) =>
			message.type === DKT_MSG.EXPORT_REQUEST
			&& ((message.payload as { request?: { id?: unknown } } | null)?.request?.id) === 'export:selected-clip-channel',
		)

		expect(selectedExportMessage?.type).toBe(DKT_MSG.EXPORT_REQUEST)
		expect((selectedExportMessage as { payload?: { request?: { range?: { type?: unknown; clipId?: unknown } }; queueKey?: unknown } } | undefined)?.payload?.request?.range).toEqual({
			type: 'clip',
			clipId: 'clip:export-target',
		})
		expect((selectedExportMessage as { payload?: { queueKey?: unknown } } | undefined)?.payload?.queueKey).toBe('clip:clip:export-target')

		connection.destroy()
	})
})
