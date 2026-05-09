import { describe, expect, it, vi } from 'vitest'
import type { ReactSyncScopeHandle } from '../../dkt-react-sync/scope/ScopeHandle'
import type { PageSyncRuntime } from '../../dkt-react-sync/runtime/PageSyncRuntime'
import type { ExportRenderRequest, ExportRenderResult } from '../render/exportRenderer'
import { createEditorHarnessAdapter } from './editorHarnessAdapter'
import type { EditorActionEnvironment } from './editorActionEnvironment'

const createScope = (_nodeId: string): ReactSyncScopeHandle => ({ kind: 'scope', _nodeId })

const createBaseEnvironment = (runtime: PageSyncRuntime, onRender: (request: ExportRenderRequest) => void): EditorActionEnvironment => ({
	pageRuntime: runtime,
	dkt: { dispatch: () => undefined },
	media: {
		getFileKind: () => null,
		createObjectUrl: () => 'blob:export',
		revokeObjectUrl: () => undefined,
		getImportedResourceDuration: async () => 0,
	},
	export: {
		renderer: { render: async () => ({
			id: 'id',
			fileName: 'project.webm',
			mimeType: 'video/webm',
			blob: new Blob(['x']),
			size: 1,
			duration: 1,
			frameCount: 1,
			manifest: {
				format: 'video-webm',
				projectId: 'project',
				range: { type: 'project' },
				start: 0,
				duration: 1,
				fps: 30,
				frameCount: 1,
				clips: [],
				frames: [],
			},
		}) },
		render: async (request) => {
			onRender(request)
			const result: ExportRenderResult = {
				id: 'id',
				fileName: 'project.webm',
				mimeType: 'video/webm',
				blob: new Blob(['x']),
				size: 1,
				duration: 1,
				frameCount: 1,
				manifest: {
					format: 'video-webm',
					projectId: request.plan.projectId,
					range: request.range,
					start: 0,
					duration: 1,
					fps: 30,
					frameCount: 1,
					clips: [],
					frames: [],
				},
			}
			return result
		},
	},
	transfers: {
		manager: {} as EditorActionEnvironment['transfers']['manager'],
		getPeerId: () => null,
		resolveResourceUrl: (_resourceId, fallbackUrl) => fallbackUrl,
		requestPlayheadWindow: () => undefined,
		notePreviewError: () => undefined,
	},
	lifecycle: {
		isDestroyed: () => false,
		setTimeout: (handler, timeoutMs) => setTimeout(handler, timeoutMs),
		clearTimeout: (timerId) => clearTimeout(timerId),
		registerObjectUrl: () => undefined,
	},
	tasks: {
		dispatchTask: () => ({ taskId: 'task', intentKey: '$fx_test', fxName: '$fx_test', payload: {}, queuePolicy: 'queue-all', dropped: false }),
		consumeRuntimeRef: () => undefined,
		deleteRuntimeRef: () => undefined,
		completeTask: () => undefined,
	},
	platform: {
		createAuthorityClient: () => null as never,
		createExportRenderer: () => ({ render: async () => { throw new Error('not used') } }),
		createMediaPort: () => null as never,
		getImportedResourceDuration: async () => 0,
		createObjectUrl: () => 'blob:export',
		revokeObjectUrl: () => undefined,
		setTimeout: (handler: () => void, timeoutMs: number) => setTimeout(handler, timeoutMs),
		clearTimeout: (timerId: ReturnType<typeof setTimeout>) => clearTimeout(timerId),
	} as unknown as EditorActionEnvironment['platform'],
})

describe('createEditorHarnessAdapter queueProjectExport', () => {
	it('uses computed exportPlan as-is when it is available', async () => {
		const rootScope = createScope('root')
		const projectScope = createScope('project')
		const onRender = vi.fn<(request: ExportRenderRequest) => void>()

		const runtime = {
			mountShape: () => () => undefined,
			getSnapshot: () => ({ ready: true }),
			getRootScope: () => rootScope,
			readOne: (scope: ReactSyncScopeHandle, relName: string) => {
				if (scope._nodeId === 'root' && relName === 'activeProject') return projectScope
				return null
			},
			readMany: () => [],
			readAttrs: (scope: ReactSyncScopeHandle, fields: string[]) => {
				if (scope._nodeId === 'project' && fields.includes('exportPlan')) {
					return {
						exportPlan: {
							projectId: 'project-from-comp',
							fps: 30,
							width: 1280,
							height: 720,
							duration: 1,
							clipSources: [{
								id: 'clip-1',
								resourceId: 'res-1',
								name: 'Clip',
								color: '#2563eb',
								resourceName: 'Res',
								resourceKind: 'video',
								resourceUrl: 'blob:res-1',
								mime: 'video/webm',
								inPoint: 0,
								start: 0,
								duration: 1,
								fadeIn: 0,
								fadeOut: 0,
								opacity: { value: 1 },
								transform: { x: { value: 0 }, y: { value: 0 }, scale: { value: 1 }, rotation: { value: 0 } },
								audio: { gain: 1, pan: 0 },
								filters: ['saturate(0)'],
								effects: [{ kind: 'color-correction', name: 'Color correction', enabled: true, params: { saturation: { value: 0 } } }],
								text: null,
							}],
						},
					}
				}
				return {}
			},
			debugDumpGraph: () => null,
			debugMessages: () => [],
		} as unknown as PageSyncRuntime

		const env = createBaseEnvironment(runtime, onRender)
		const actions = createEditorHarnessAdapter(env, { resourceChunkSize: 64 * 1024 })

		await actions.queueProjectExport()

		expect(onRender).toHaveBeenCalledTimes(1)
		const rendered = onRender.mock.calls[0]?.[0]
		if (!rendered) throw new Error('Expected export request to be rendered')
		expect(rendered.plan.projectId).toBe('project-from-comp')
		expect(rendered.plan.clipSources[0]?.effects).toHaveLength(1)
	})

	it('returns null when exportPlan is unavailable', async () => {
		const rootScope = createScope('root')
		const projectScope = createScope('project')
		let rendered: ExportRenderRequest | null = null

		const runtime = {
			mountShape: () => () => undefined,
			getSnapshot: () => ({ ready: true }),
			getRootScope: () => rootScope,
			readOne: (scope: ReactSyncScopeHandle, relName: string) => {
				if (scope._nodeId === 'root' && relName === 'activeProject') return projectScope
				return null
			},
			readMany: () => [],
			readAttrs: (scope: ReactSyncScopeHandle, fields: string[]) => {
				if (scope._nodeId === 'project' && fields.includes('exportPlan')) {
					return {
						exportPlan: undefined,
					}
				}
				return {}
			},
			debugDumpGraph: () => null,
			debugMessages: () => [],
		} as unknown as PageSyncRuntime

		const env = createBaseEnvironment(runtime, (request) => {
			rendered = request
		})
		const actions = createEditorHarnessAdapter(env, { resourceChunkSize: 64 * 1024 })

		const result = await actions.queueProjectExport()

		expect(result).toBeNull()
		expect(rendered).toBeNull()
	})
})
