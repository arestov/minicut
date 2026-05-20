import { appRoot } from "dkt/appRoot.js";
import { merge as mergeDcl } from "dkt/dcl/merge.js";
import {
	reduceCreateClipModel,
	reduceCreateEffectModel,
	reduceCreateProjectModel,
	reduceCreateResourceModel,
	reduceCreateTextModel,
	reduceCreateTrackModel,
	reduceSetActiveProjectHint,
} from "./AppRoot/actions";
import { CLIP_CREATION_SHAPE, Clip } from "./Clip";
import { EFFECT_CREATION_SHAPE, Effect } from "./Effect";
import { PROJECT_CREATION_SHAPE, Project } from "./Project";
import { RESOURCE_CREATION_SHAPE, Resource } from "./Resource";
import { EditorSessionRoot } from "./SessionRoot";
import { TEXT_CREATION_SHAPE, Text } from "./Text";
import { TRACK_CREATION_SHAPE, Track } from "./Track";

const appProps = mergeDcl({
	init: (target: unknown) => {
		const typedTarget = target as { start_page?: unknown };
		typedTarget.start_page = typedTarget;
	},
	model_name: "app_root",
	rels: {
		$session_root: ["model", EditorSessionRoot],
		common_session_root: ["input", { linking: "<< $session_root" }],
		sessions: ["input", { linking: "<< $session_root", many: true }],
		free_sessions: ["input", { linking: "<< $session_root", many: true }],
		project: ["model", Project, { many: true }],
		track: ["model", Track, { many: true }],
		resource: ["model", Resource, { many: true }],
		clip: ["model", Clip, { many: true }],
		text: ["model", Text, { many: true }],
		effect: ["model", Effect, { many: true }],
	},
	attrs: {
		activeProjectHint: ["input", null],
		projectMetaList: ["input", []],
		hasProjects: [
			"comp",
			["projectMetaList"],
			(projectMetaList: unknown) =>
				Array.isArray(projectMetaList) && projectMetaList.length > 0,
		],
	},
	crdt: {
		mode: "collaborative",
		attrs: {
			activeProjectHint: { sync: false, reason: "projection" },
			projectMetaList: { sync: false, reason: "projection" },
		},
		rels: {
			common_session_root: { sync: false, reason: "projection" },
			sessions: { sync: false, reason: "projection" },
			free_sessions: { sync: false, reason: "projection" },
			project: "sequence",
			track: { sync: false, reason: "projection" },
			resource: { sync: false, reason: "projection" },
			clip: { sync: false, reason: "projection" },
			text: { sync: false, reason: "projection" },
			effect: { sync: false, reason: "projection" },
		},
	},
	actions: {
		createProjectModel: {
			to: [
				"<< project << #",
				{
					method: "at_end",
					can_create: true,
					creation_shape: PROJECT_CREATION_SHAPE,
				},
			],
			fn: reduceCreateProjectModel,
		},
		createTrackModel: {
			to: [
				"<< track << #",
				{
					method: "at_end",
					can_create: true,
					creation_shape: TRACK_CREATION_SHAPE,
				},
			],
			fn: reduceCreateTrackModel,
		},
		createResourceModel: {
			to: [
				"<< resource << #",
				{
					method: "at_end",
					can_create: true,
					creation_shape: RESOURCE_CREATION_SHAPE,
				},
			],
			fn: reduceCreateResourceModel,
		},
		createTextModel: {
			to: [
				"<< text << #",
				{
					method: "at_end",
					can_create: true,
					creation_shape: TEXT_CREATION_SHAPE,
				},
			],
			fn: reduceCreateTextModel,
		},
		createEffectModel: {
			to: [
				"<< effect << #",
				{
					method: "at_end",
					can_create: true,
					creation_shape: EFFECT_CREATION_SHAPE,
				},
			],
			fn: reduceCreateEffectModel,
		},
		createClipModel: {
			to: [
				"<< clip << #",
				{
					method: "at_end",
					can_create: true,
					creation_shape: CLIP_CREATION_SHAPE,
				},
			],
			fn: reduceCreateClipModel,
		},
		setActiveProjectHint: {
			to: {
				activeProjectHint: ["activeProjectHint"],
			},
			fn: reduceSetActiveProjectHint,
		},
	},
});

export const MiniCutAppRoot = appRoot(appProps, appProps.init);
