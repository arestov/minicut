import { appRoot } from 'dkt/appRoot.js'
import { merge as mergeDcl } from 'dkt/dcl/merge.js'
import { Clip, CLIP_CREATION_SHAPE } from './Clip'
import { Effect, EFFECT_CREATION_SHAPE } from './Effect'
import { EditorSessionRoot } from './SessionRoot'
import { Project, PROJECT_CREATION_SHAPE } from './Project'
import { Resource, RESOURCE_CREATION_SHAPE } from './Resource'
import { Text, TEXT_CREATION_SHAPE } from './Text'
import { Track, TRACK_CREATION_SHAPE } from './Track'
import {
	reduceCreateProjectModel,
	reduceCreateTrackModel,
	reduceCreateResourceModel,
	reduceCreateTextModel,
	reduceCreateEffectModel,
	reduceCreateClipModel,
	reduceSetActiveProjectHint,
} from './AppRoot/actions'

const appProps = mergeDcl({
	init: (target: unknown) => {
		const typedTarget = target as { start_page?: unknown }
		typedTarget.start_page = typedTarget
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
		hasProjects: ['comp', ['projectMetaList'], (projectMetaList: unknown) => Array.isArray(projectMetaList) && projectMetaList.length > 0],
	},
	actions: {
		createProjectModel: {
			to: ['<< project << #', {
				method: 'at_end',
				can_create: true,
				creation_shape: PROJECT_CREATION_SHAPE,
			}],
			fn: reduceCreateProjectModel,
		},
		createTrackModel: {
			to: ['<< track << #', {
				method: 'at_end',
				can_create: true,
				creation_shape: TRACK_CREATION_SHAPE,
			}],
			fn: reduceCreateTrackModel,
		},
		createResourceModel: {
			to: ['<< resource << #', {
				method: 'at_end',
				can_create: true,
				creation_shape: RESOURCE_CREATION_SHAPE,
			}],
			fn: reduceCreateResourceModel,
		},
		createTextModel: {
			to: ['<< text << #', {
				method: 'at_end',
				can_create: true,
				creation_shape: TEXT_CREATION_SHAPE,
			}],
			fn: reduceCreateTextModel,
		},
		createEffectModel: {
			to: ['<< effect << #', {
				method: 'at_end',
				can_create: true,
				creation_shape: EFFECT_CREATION_SHAPE,
			}],
			fn: reduceCreateEffectModel,
		},
		createClipModel: {
			to: ['<< clip << #', {
				method: 'at_end',
				can_create: true,
				creation_shape: CLIP_CREATION_SHAPE,
			}],
			fn: reduceCreateClipModel,
		},
		setActiveProjectHint: {
			to: {
				activeProjectHint: ['activeProjectHint'],
			},
			fn: reduceSetActiveProjectHint,
		},
	},
})

export const MiniCutAppRoot = appRoot(appProps, appProps.init)
