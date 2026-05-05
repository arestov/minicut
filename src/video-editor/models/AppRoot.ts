import { appRoot } from 'dkt/appRoot.js'
import { merge as mergeDcl } from 'dkt/dcl/merge.js'
import { createEmptyRegistry } from '../domain/createProject'
import type { ProjectRegistry } from '../domain/types'
import { Clip, CLIP_PROXY_CREATION_SHAPE } from './Clip'
import { Effect, EFFECT_PROXY_CREATION_SHAPE } from './Effect'
import { EditorSessionRoot } from './SessionRoot'
import { Project, PROJECT_PROXY_CREATION_SHAPE } from './Project'
import { Resource, RESOURCE_PROXY_CREATION_SHAPE } from './Resource'
import { Text, TEXT_PROXY_CREATION_SHAPE } from './Text'
import { Track, TRACK_PROXY_CREATION_SHAPE } from './Track'
import { defaultTextBox, defaultTextStyle } from '../dkt/textActions'

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
		project: ['model', Project, { many: true }],
		track: ['model', Track, { many: true }],
		resource: ['model', Resource, { many: true }],
		clip: ['model', Clip, { many: true }],
		text: ['model', Text, { many: true }],
		effect: ['model', Effect, { many: true }],
	},
	attrs: {
		activeProjectHint: ['input', null],
		projectMetaList: ['input', []],
		registrySnapshot: ['input', createEmptyRegistry()],
		hasProjects: ['comp', ['projectMetaList'], (projectMetaList: unknown) => Array.isArray(projectMetaList) && projectMetaList.length > 0],
	},
	actions: {
		replaceRegistrySnapshot: {
			to: {
				registrySnapshot: ['registrySnapshot'],
			},
			fn: (payload: unknown) => {
				const registry = payload as ProjectRegistry | null
				return registry && typeof registry === 'object' && 'projects' in registry && 'entitiesById' in registry
					? { registrySnapshot: structuredClone(registry) }
					: '$noop'
			},
		},
		createProjectProxy: {
			to: ['<< project << #', {
				method: 'at_end',
				can_create: true,
				creation_shape: PROJECT_PROXY_CREATION_SHAPE,
			}],
			fn: (payload: unknown) => {
				const value = payload as {
					sourceProjectId?: unknown
					title?: unknown
					fps?: unknown
					width?: unknown
					height?: unknown
					duration?: unknown
					createdAt?: unknown
					updatedAt?: unknown
				} | null
				if (typeof value?.sourceProjectId !== 'string' || !value.sourceProjectId) {
					return '$noop'
				}

				return {
					attrs: {
						sourceProjectId: value.sourceProjectId,
						title: typeof value.title === 'string' ? value.title : 'Untitled project',
						fps: typeof value.fps === 'number' ? value.fps : 30,
						width: typeof value.width === 'number' ? value.width : 1920,
						height: typeof value.height === 'number' ? value.height : 1080,
						duration: typeof value.duration === 'number' ? value.duration : 0,
						createdAt: typeof value.createdAt === 'number' ? value.createdAt : 0,
						updatedAt: typeof value.updatedAt === 'number' ? value.updatedAt : 0,
					},
				}
			},
		},
		createTrackProxy: {
			to: ['<< track << #', {
				method: 'at_end',
				can_create: true,
				creation_shape: TRACK_PROXY_CREATION_SHAPE,
			}],
			fn: (payload: unknown) => {
				const value = payload as { sourceTrackId?: unknown; kind?: unknown; name?: unknown; muted?: unknown; locked?: unknown; height?: unknown } | null
				if (typeof value?.sourceTrackId !== 'string' || !value.sourceTrackId) {
					return '$noop'
				}

				return {
					attrs: {
						sourceTrackId: value.sourceTrackId,
						kind: value.kind === 'audio' ? 'audio' : 'video',
						name: typeof value.name === 'string' ? value.name : 'Track',
						muted: typeof value.muted === 'boolean' ? value.muted : false,
						locked: typeof value.locked === 'boolean' ? value.locked : false,
						height: typeof value.height === 'number' ? value.height : 84,
					},
				}
			},
		},
		createResourceProxy: {
			to: ['<< resource << #', {
				method: 'at_end',
				can_create: true,
				creation_shape: RESOURCE_PROXY_CREATION_SHAPE,
			}],
			fn: (payload: unknown) => {
				const value = payload as {
					sourceResourceId?: unknown
					name?: unknown
					kind?: unknown
					url?: unknown
					mime?: unknown
					duration?: unknown
					width?: unknown
					height?: unknown
					size?: unknown
					source?: unknown
					status?: unknown
					data?: unknown
				} | null
				if (typeof value?.sourceResourceId !== 'string' || !value.sourceResourceId) {
					return '$noop'
				}

				return {
					attrs: {
						sourceResourceId: value.sourceResourceId,
						name: typeof value.name === 'string' ? value.name : 'Resource',
						kind: typeof value.kind === 'string' ? value.kind : 'video',
						url: typeof value.url === 'string' ? value.url : '',
						mime: typeof value.mime === 'string' ? value.mime : 'application/octet-stream',
						duration: typeof value.duration === 'number' ? value.duration : 0,
						width: typeof value.width === 'number' ? value.width : null,
						height: typeof value.height === 'number' ? value.height : null,
						size: typeof value.size === 'number' ? value.size : null,
						source: value.source && typeof value.source === 'object' ? value.source : { kind: 'local' },
						status: typeof value.status === 'string' ? value.status : 'missing',
						data: value.data && typeof value.data === 'object' ? value.data : null,
					},
				}
			},
		},
		createTextProxy: {
			to: ['<< text << #', {
				method: 'at_end',
				can_create: true,
				creation_shape: TEXT_PROXY_CREATION_SHAPE,
			}],
			fn: (payload: unknown) => {
				const value = payload as { sourceTextId?: unknown; content?: unknown; style?: unknown; box?: unknown } | null
				if (typeof value?.sourceTextId !== 'string' || !value.sourceTextId) {
					return '$noop'
				}

				return {
					attrs: {
						sourceTextId: value.sourceTextId,
						content: typeof value.content === 'string' ? value.content : 'Text',
						style: value.style && typeof value.style === 'object' ? value.style : defaultTextStyle,
						box: value.box && typeof value.box === 'object' ? value.box : defaultTextBox,
					},
				}
			},
		},
		createEffectProxy: {
			to: ['<< effect << #', {
				method: 'at_end',
				can_create: true,
				creation_shape: EFFECT_PROXY_CREATION_SHAPE,
			}],
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
					return '$noop'
				}

				return {
					attrs: {
						sourceEffectId: value.sourceEffectId,
						name: typeof value.name === 'string' ? value.name : 'Effect',
						kind: typeof value.kind === 'string' ? value.kind : 'blur',
						enabled: typeof value.enabled === 'boolean' ? value.enabled : true,
						amount: typeof value.amount === 'number' ? value.amount : null,
						params: value.params && typeof value.params === 'object' ? value.params : null,
						color: value.color && typeof value.color === 'object' ? value.color : null,
					},
				}
			},
		},
		createClipProxy: {
			to: ['<< clip << #', {
				method: 'at_end',
				can_create: true,
				creation_shape: CLIP_PROXY_CREATION_SHAPE,
			}],
			fn: (payload: unknown) => {
				const value = payload as {
					sourceClipId?: unknown
					name?: unknown
					color?: unknown
					start?: unknown
					in?: unknown
					duration?: unknown
					fadeIn?: unknown
					fadeOut?: unknown
					audio?: unknown
					opacity?: unknown
					transform?: unknown
				} | null
				if (typeof value?.sourceClipId !== 'string' || !value.sourceClipId) {
					return '$noop'
				}

				return {
					attrs: {
						sourceClipId: value.sourceClipId,
						name: typeof value.name === 'string' ? value.name : 'Clip',
						color: typeof value.color === 'string' ? value.color : '#2563eb',
						start: typeof value.start === 'number' ? value.start : 0,
						in: typeof value.in === 'number' ? value.in : 0,
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
	},
})

export const MiniCutAppRoot = appRoot(appProps, appProps.init)
