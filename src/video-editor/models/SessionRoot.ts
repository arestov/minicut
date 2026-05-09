import { model } from 'dkt/model.js'
import { SessionRoot as BaseSessionRoot } from 'dkt-all/libs/provoda/bwlev/SessionRoot.js'
import { TIMELINE_ZOOM_DEFAULT } from './sessionZoom'
import { createPreviewFrame, lookupPreviewBufferFrame, type PreviewBuffer, type PreviewFrame, type PreviewStructure } from '../read-model/previewComps'
import type { ExportProgressState } from '../app/exportProgressState'
import type { ExportRequestState } from '../app/exportRequestState'
import { dktSessionActions } from './SessionRoot/actions'
import { reducePreviewFrame, reducePreviewStructure, reduceSelectedClip } from './SessionRoot/comps'

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
		exportProgress: ['input', null as ExportProgressState | null],
		timelineZoom: ['input', TIMELINE_ZOOM_DEFAULT],
		timelineTool: ['input', 'select'],
		snappingEnabled: ['input', true],
		previewStructure: ['comp', ['< @one:previewClipSources < activeProject'] as const,
			reducePreviewStructure],
		previewFrame: ['comp', ['previewStructure', 'cursor', 'previewBuffer', 'isPlaying'] as const,
			reducePreviewFrame],
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
			$fx_requestExport: {
				api: ['exportRuntime'],
				create_when: { api_inits: true },
				fn: (api: unknown, state: unknown) => {
					const runtime = api as { requestExport?: (payload: unknown) => void } | null
					const payload = (state as { payload?: unknown } | null)?.payload
					if (!runtime || typeof runtime.requestExport !== 'function' || !payload || typeof payload !== 'object') {
						debugExport('skip $fx_requestExport effect', {
							hasRuntime: Boolean(runtime && typeof runtime.requestExport === 'function'),
							hasPayload: Boolean(payload),
						})
						return
					}

					debugExport('$fx_requestExport effect -> runtime', {
						id: (payload as { id?: unknown }).id,
						range: (payload as { range?: unknown }).range,
					})
					runtime.requestExport(payload)
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
		] as const, reduceSelectedClip, { linking: '<< clip << #' }],
		selectedResource: ['input', { linking: '<< resource << #' }],
		selectedText: ['input', { linking: '<< text << #' }],
		selectedEffect: ['input', { linking: '<< effect << #' }],
	},
	actions: dktSessionActions,
})
