import { model } from 'dkt/model.js'
import { SessionRoot as BaseSessionRoot } from 'dkt-all/libs/provoda/bwlev/SessionRoot.js'
import { TIMELINE_ZOOM_DEFAULT } from '../dkt/state/sessionStore'
import { dktSessionActions } from './SessionRoot/actions'

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
		previewStructure: ['input', { clipSources: [] }],
		previewFrame: ['input', { cursor: 0, renderedClips: [], visualRenderedClips: [], audioRenderedClips: [], activeClipNames: [] }],
		selectedClipTrackPosition: ['input', null],
		selectedClipSummary: ['input', null],
	},
	rels: {
		activeProject: ['input', { linking: '<< project << #' }],
		selectedClip: ['input', { linking: '<< clip << #' }],
	},
	actions: dktSessionActions,
})
