import { model } from 'dkt/model.js'
import { SessionRoot as BaseSessionRoot } from 'dkt-all/libs/provoda/bwlev/SessionRoot.js'
import { TIMELINE_ZOOM_DEFAULT } from './sessionZoom'
import { createPreviewFrame, type PreviewFrame, type PreviewStructure } from '../read-model/previewComps'
import { dktSessionActions } from './SessionRoot/actions'

const DEFAULT_PREVIEW_STRUCTURE: PreviewStructure = { clipSources: [] }

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
		selectedEntityId: ['input', null],
		activeInspectorTab: ['input', 'edit'],
		cursor: ['input', 0],
		isPlaying: ['input', false],
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
		previewFrame: ['comp', ['previewStructure', 'cursor'] as const, (previewStructure: unknown, cursor: unknown): PreviewFrame => createPreviewFrame(
			previewStructure && typeof previewStructure === 'object' && Array.isArray((previewStructure as { clipSources?: unknown }).clipSources)
				? previewStructure as PreviewStructure
				: DEFAULT_PREVIEW_STRUCTURE,
			typeof cursor === 'number' && Number.isFinite(cursor) ? cursor : 0,
		)],
		selectedClipTrackPosition: ['input', null],
		selectedClipSummary: ['input', null],
	},
	rels: {
		activeProject: ['input', { linking: '<< project << #' }],
		selectedTrack: ['input', { linking: '<< track << #' }],
		selectedClip: ['input', { linking: '<< clip << #' }],
		selectedResource: ['input', { linking: '<< resource << #' }],
		selectedText: ['input', { linking: '<< text << #' }],
		selectedEffect: ['input', { linking: '<< effect << #' }],
	},
	actions: dktSessionActions,
})
