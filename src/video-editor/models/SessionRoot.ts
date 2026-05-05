import { model } from 'dkt/model.js'
import { SessionRoot as BaseSessionRoot } from 'dkt-all/libs/provoda/bwlev/SessionRoot.js'
import { dktSessionActions } from '../dkt/sessionActions'

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
		timelineZoom: ['input', 16],
		timelineTool: ['input', 'select'],
		snappingEnabled: ['input', true],
	},
	actions: dktSessionActions,
})
