import { appRoot } from 'dkt/appRoot.js'
import { merge as mergeDcl } from 'dkt/dcl/merge.js'
import { Clip } from './Clip'
import { EditorSessionRoot } from './SessionRoot'

const appProps = mergeDcl({
	init: (target: { start_page?: unknown }) => {
		target.start_page = target
	},
	model_name: 'minicut_app_root',
	rels: {
		$session_root: ['model', EditorSessionRoot],
		common_session_root: ['input', { linking: '<< $session_root' }],
		sessions: ['input', { linking: '<< $session_root', many: true }],
		free_sessions: ['input', { linking: '<< $session_root', many: true }],
		clip: ['model', Clip, { many: true }],
	},
	attrs: {
		activeProjectHint: ['input', null],
		historyCanUndo: ['input', false],
		historyCanRedo: ['input', false],
		projectMetaList: ['input', []],
		hasProjects: ['comp', ['projectMetaList'], (projectMetaList: unknown) => Array.isArray(projectMetaList) && projectMetaList.length > 0],
	},
	actions: {
		setActiveProjectHint: {
			to: {
				activeProjectHint: ['activeProjectHint'],
			},
			fn: (payload: unknown) => ({
				activeProjectHint: typeof payload === 'string' && payload ? payload : null,
			}),
		},
		setHistoryAvailability: {
			to: {
				historyCanUndo: ['historyCanUndo'],
				historyCanRedo: ['historyCanRedo'],
			},
			fn: (payload: unknown) => {
				const value = payload as { canUndo?: unknown; canRedo?: unknown } | null
				return {
					historyCanUndo: value?.canUndo === true,
					historyCanRedo: value?.canRedo === true,
				}
			},
		},
	},
})

export const MiniCutAppRoot = appRoot(appProps, appProps.init)
