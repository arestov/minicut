import { appRoot } from 'dkt/appRoot.js'
import { merge as mergeDcl } from 'dkt/dcl/merge.js'
import { Clip, CLIP_PROXY_CREATION_SHAPE } from './Clip'
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
		createClipProxy: {
			to: {
				_clipProxy: [
					'<< clip << #',
					{
						method: 'at_end',
						can_create: true,
						creation_shape: CLIP_PROXY_CREATION_SHAPE,
					},
				],
			},
			fn: (payload: unknown) => {
				const value = payload as {
					sourceClipId?: unknown
					name?: unknown
					color?: unknown
					duration?: unknown
					fadeIn?: unknown
					fadeOut?: unknown
					audio?: unknown
					opacity?: unknown
					transform?: unknown
				} | null
				if (typeof value?.sourceClipId !== 'string' || !value.sourceClipId) {
					return {}
				}

				return {
					_clipProxy: {
						attrs: {
							sourceClipId: value.sourceClipId,
							name: typeof value.name === 'string' ? value.name : 'Clip',
							color: typeof value.color === 'string' ? value.color : '#2563eb',
							duration: typeof value.duration === 'number' ? value.duration : 0,
							fadeIn: typeof value.fadeIn === 'number' ? value.fadeIn : 0,
							fadeOut: typeof value.fadeOut === 'number' ? value.fadeOut : 0,
							audio: value.audio && typeof value.audio === 'object' ? value.audio : { gain: 1, pan: 0 },
							opacity: value.opacity && typeof value.opacity === 'object' ? value.opacity : { value: 1 },
							transform: value.transform && typeof value.transform === 'object'
								? value.transform
								: {
									x: { value: 0 },
									y: { value: 0 },
									scale: { value: 1 },
									rotation: { value: 0 },
								},
						},
					},
				}
			},
		},
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
