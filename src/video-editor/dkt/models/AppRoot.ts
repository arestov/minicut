import { appRoot } from 'dkt/appRoot.js'
import { merge as mergeDcl } from 'dkt/dcl/merge.js'
import { Clip, CLIP_PROXY_CREATION_SHAPE } from './Clip'
import { Effect, EFFECT_PROXY_CREATION_SHAPE } from './Effect'
import { EditorSessionRoot } from './SessionRoot'
import { Text, TEXT_PROXY_CREATION_SHAPE } from './Text'
import { defaultTextBox, defaultTextStyle } from '../textActions'

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
		text: ['model', Text, { many: true }],
		effect: ['model', Effect, { many: true }],
	},
	attrs: {
		activeProjectHint: ['input', null],
		historyCanUndo: ['input', false],
		historyCanRedo: ['input', false],
		projectMetaList: ['input', []],
		hasProjects: ['comp', ['projectMetaList'], (projectMetaList: unknown) => Array.isArray(projectMetaList) && projectMetaList.length > 0],
	},
	actions: {
		createTextProxy: {
			to: {
				_textProxy: [
					'<< text << #',
					{
						method: 'at_end',
						can_create: true,
						creation_shape: TEXT_PROXY_CREATION_SHAPE,
					},
				],
			},
			fn: (payload: unknown) => {
				const value = payload as { sourceTextId?: unknown; content?: unknown; style?: unknown; box?: unknown } | null
				if (typeof value?.sourceTextId !== 'string' || !value.sourceTextId) {
					return {}
				}

				return {
					_textProxy: {
						attrs: {
							sourceTextId: value.sourceTextId,
							content: typeof value.content === 'string' ? value.content : 'Text',
							style: value.style && typeof value.style === 'object' ? value.style : defaultTextStyle,
							box: value.box && typeof value.box === 'object' ? value.box : defaultTextBox,
						},
					},
				}
			},
		},
		createEffectProxy: {
			to: {
				_effectProxy: [
					'<< effect << #',
					{
						method: 'at_end',
						can_create: true,
						creation_shape: EFFECT_PROXY_CREATION_SHAPE,
					},
				],
			},
			fn: (payload: unknown) => {
				const value = payload as {
					sourceEffectId?: unknown
					name?: unknown
					kind?: unknown
					enabled?: unknown
					amount?: unknown
					params?: unknown
					color?: unknown
				} | null
				if (typeof value?.sourceEffectId !== 'string' || !value.sourceEffectId) {
					return {}
				}

				return {
					_effectProxy: {
						attrs: {
							sourceEffectId: value.sourceEffectId,
							name: typeof value.name === 'string' ? value.name : 'Effect',
							kind: typeof value.kind === 'string' ? value.kind : 'blur',
							enabled: typeof value.enabled === 'boolean' ? value.enabled : true,
							amount: typeof value.amount === 'number' ? value.amount : null,
							params: value.params && typeof value.params === 'object' ? value.params : null,
							color: value.color && typeof value.color === 'object' ? value.color : null,
						},
					},
				}
			},
		},
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
