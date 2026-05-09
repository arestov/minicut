import { model } from 'dkt/model.js'
import { SessionRoot as BaseSessionRoot } from 'dkt-all/libs/provoda/bwlev/SessionRoot.js'
import { TIMELINE_ZOOM_DEFAULT } from './sessionZoom'
import { createPreviewFrame, lookupPreviewBufferFrame, type PreviewBuffer, type PreviewFrame, type PreviewStructure } from '../read-model/previewComps'
import type { ExportProgressState } from '../app/exportProgressState'
import type { ExportRequestState } from '../app/exportRequestState'
import { dktSessionActions } from './SessionRoot/actions'

const DEFAULT_PREVIEW_STRUCTURE: PreviewStructure = { clipSources: [] }

const debugExport = (message: string, details?: unknown) => {
	if ((globalThis as { __MINICUT_EXPORT_DEBUG__?: unknown }).__MINICUT_EXPORT_DEBUG__ !== true) {
		return
	}
	console.info('[minicut:export:session-root]', message, details)
}

export const EditorSessionRoot = model({
	extends: BaseSessionRoot,
	model_name: 'minicut_session_root',
	attrs: {
		sessionKey: ['input', null],
		route: ['input', null],
		closedAt: ['input', null],
		isCommonRoot: ['input', false],
		tabId: ['input', null],
		activeProjectId: ['input', null],
		pendingProjectInit: ['input', null],
		selectedEntityId: ['input', null],
		activeInspectorTab: ['input', 'edit'],
		cursor: ['input', 0],
		isPlaying: ['input', false],
		previewBuffer: ['input', null as PreviewBuffer | null],
		exportRequest: ['input', null as ExportRequestState | null],
		exportRequestIntent: ['input', null as ExportRequestState | null],
		exportProgress: ['input', null as ExportProgressState | null],
		timelineZoom: ['input', TIMELINE_ZOOM_DEFAULT],
		timelineTool: ['input', 'select'],
		snappingEnabled: ['input', true],
		previewStructure: ['comp', ['< @one:previewClipSources < activeProject'] as const,
			(previewClipSources: unknown): PreviewStructure => {
				if (previewClipSources && typeof previewClipSources === 'object' && Array.isArray((previewClipSources as PreviewStructure).clipSources)) {
					return previewClipSources as PreviewStructure
				}
				return DEFAULT_PREVIEW_STRUCTURE
			}],
		previewFrame: ['comp', ['previewStructure', 'cursor', 'previewBuffer', 'isPlaying'] as const,
			(previewStructure: unknown, cursor: unknown, previewBuffer: unknown, isPlaying: unknown): PreviewFrame => {
				const time = typeof cursor === 'number' && Number.isFinite(cursor) ? cursor : 0
				if (isPlaying) {
					const buffered = lookupPreviewBufferFrame(previewBuffer as PreviewBuffer | null, time)
					if (buffered) return buffered
				}
				return createPreviewFrame(
					previewStructure && typeof previewStructure === 'object' && Array.isArray((previewStructure as { clipSources?: unknown }).clipSources)
						? previewStructure as PreviewStructure
						: DEFAULT_PREVIEW_STRUCTURE,
					time,
				)
			}],
		selectedClipSummary: ['comp', [
			'< @one:sourceClipId < selectedClip',
			'< @one:color < selectedClip',
			'< @one:name < selectedClip',
			'< @one:name < selectedClip.track',
		] as const, (sourceClipId: unknown, color: unknown, clipName: unknown, trackName: unknown) => {
			if (typeof sourceClipId !== 'string' || !sourceClipId) return null
			return {
				color: typeof color === 'string' && color ? color : '#2563eb',
				resourceName: typeof clipName === 'string' && clipName ? clipName : 'Clip',
				trackName: typeof trackName === 'string' && trackName ? trackName : 'Track',
			}
		}],
		selectedClipTrackPosition: ['comp', [
			'<< @all:activeProject.tracks',
			'<< @one:selectedClip.track',
			'< @one:name < selectedClip.track',
		] as const, (tracks: unknown, selectedTrack: unknown, trackName: unknown) => {
			if (!selectedTrack) return null
			const trackList = Array.isArray(tracks) ? tracks : []
			const index = trackList.indexOf(selectedTrack)
			if (index === -1) return null
			return {
				trackName: typeof trackName === 'string' && trackName
					? trackName
					: `Track ${index + 1}`,
				ordinal: index + 1,
			}
		}],
	},
	effects: {
		api: {
			exportRuntime: [
				['_node_id'] as const,
				['#exportRuntime'] as const,
				(exportRuntime: unknown) => exportRuntime,
			],
		},
		out: {
			requestExport: {
				api: ['exportRuntime'],
				trigger: ['exportRequestIntent'],
				require: ['exportRequestIntent'],
				create_when: { api_inits: true },
				fn: (api: unknown, state: unknown) => {
					const runtime = api as { requestExport?: (payload: unknown) => void } | null
					const taskPayload = (state as { payload?: unknown } | null)?.payload
					const intentFromTask = taskPayload && typeof taskPayload === 'object' ? taskPayload : null
					const intentFromState = (state as { exportRequestIntent?: unknown } | null)?.exportRequestIntent
					const intent = intentFromTask || intentFromState
					if (!runtime || typeof runtime.requestExport !== 'function' || !intent || typeof intent !== 'object') {
						debugExport('skip requestExport effect', {
							hasRuntime: Boolean(runtime && typeof runtime.requestExport === 'function'),
							hasIntentFromTask: Boolean(intentFromTask),
							hasIntentFromState: Boolean(intentFromState && typeof intentFromState === 'object'),
						})
						return
					}

					debugExport('requestExport effect -> runtime', {
						id: (intent as { id?: unknown }).id,
						range: (intent as { range?: unknown }).range,
					})
					runtime.requestExport(intent)
				},
			},
		},
	},
	rels: {
		activeProject: ['input', { linking: '<< project << #' }],
		selectedTrack: ['input', { linking: '<< track << #' }],
		selectedClip: ['comp', [
			'<< @all:activeProject.tracks.clips',
			'< @all:sourceClipId < activeProject.tracks.clips',
			'selectedEntityId',
		] as const, (clips: unknown, sourceClipIds: unknown, selectedEntityId: unknown) => {
			if (typeof selectedEntityId !== 'string' || !selectedEntityId) return null
			const modelList = Array.isArray(clips) ? clips : []
			const idList = Array.isArray(sourceClipIds) ? sourceClipIds : []
			const index = idList.indexOf(selectedEntityId)
			if (index !== -1 && modelList[index]) return modelList[index]

			for (const clipModel of modelList) {
				if (!clipModel || typeof clipModel !== 'object') {
					continue
				}
				const nodeId = (clipModel as { _node_id?: unknown; _nodeId?: unknown })._node_id
				const nodeIdCamel = (clipModel as { _node_id?: unknown; _nodeId?: unknown })._nodeId
				if (
					(typeof nodeId === 'string' && nodeId === selectedEntityId)
					|| (typeof nodeIdCamel === 'string' && nodeIdCamel === selectedEntityId)
				) {
					return clipModel
				}
			}

			return null
		}, { linking: '<< clip << #' }],
		selectedResource: ['input', { linking: '<< resource << #' }],
		selectedText: ['input', { linking: '<< text << #' }],
		selectedEffect: ['input', { linking: '<< effect << #' }],
	},
	actions: dktSessionActions,
})
