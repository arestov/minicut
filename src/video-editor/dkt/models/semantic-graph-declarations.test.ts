import { describe, expect, it } from "vitest";
import { Clip } from "../../models/Clip";
import { Effect } from "../../models/Effect";
import { Project } from "../../models/Project";
import { Resource } from "../../models/Resource";
import { EditorSessionRoot } from "../../models/SessionRoot";
import { Text } from "../../models/Text";
import { Track } from "../../models/Track";

const getAggregate = (
	model: Record<string, unknown>,
	name: string,
): Record<string, unknown> => {
	const aggregates =
		(model.aggregates as Record<string, unknown> | undefined) ??
		((model.prototype as Record<string, unknown> | undefined)
			?.aggregates as Record<string, unknown> | undefined);
	const aggregate = aggregates?.[name];
	if (!aggregate || typeof aggregate !== "object") {
		throw new Error(`Missing aggregate ${name}`);
	}
	return aggregate as Record<string, unknown>;
};

const getRelOptions = (
	model: Record<string, unknown>,
	name: string,
): Record<string, unknown> => {
	const rels =
		(model.rels as Record<string, unknown> | undefined) ??
		((model.prototype as Record<string, unknown> | undefined)
			?.rels as Record<string, unknown> | undefined);
	const rel = rels?.[name];
	if (!Array.isArray(rel) || !rel[1] || typeof rel[1] !== "object") {
		throw new Error(`Missing rel ${name}`);
	}
	return rel[1] as Record<string, unknown>;
};

const getAttrAggregate = (
	model: Record<string, unknown>,
	name: string,
): Record<string, unknown> => {
	const attrs =
		(model.attrs as Record<string, unknown> | undefined) ??
		((model.prototype as Record<string, unknown> | undefined)
			?.attrs as Record<string, unknown> | undefined);
	const attr = attrs?.[name];
	if (!Array.isArray(attr) || !attr[2] || typeof attr[2] !== "object") {
		throw new Error(`Missing aggregate metadata for attr ${name}`);
	}
	const aggregate = (attr[2] as { aggregate?: unknown }).aggregate;
	if (!aggregate || typeof aggregate !== "object") {
		throw new Error(`Missing aggregate descriptor for attr ${name}`);
	}
	return aggregate as Record<string, unknown>;
};

const getActionAggregate = (
	model: Record<string, unknown>,
	name: string,
): Record<string, unknown> => {
	const actions =
		(model.actions as Record<string, unknown> | undefined) ??
		((model.prototype as Record<string, unknown> | undefined)
			?.actions as Record<string, unknown> | undefined);
	const action = actions?.[name];
	const descriptor = Array.isArray(action) ? action[0] : action;
	if (!descriptor || typeof descriptor !== "object") {
		throw new Error(`Missing action ${name}`);
	}
	const aggregate = (descriptor as { aggregate?: unknown }).aggregate;
	if (!aggregate || typeof aggregate !== "object" || Array.isArray(aggregate)) {
		throw new Error(`Missing aggregate metadata for action ${name}`);
	}
	return aggregate as Record<string, unknown>;
};

const getCrdtBlock = (
	model: Record<string, unknown>,
): Record<string, unknown> | undefined =>
	(model.crdt as Record<string, unknown> | undefined) ??
	((model.prototype as Record<string, unknown> | undefined)?.crdt as
		| Record<string, unknown>
		| undefined);

const getCrdtSection = (
	model: Record<string, unknown>,
	section: "attrs" | "rels",
): Record<string, unknown> => {
	const block = getCrdtBlock(model);
	const value = block?.[section];
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		throw new Error(`Missing crdt.${section} declaration`);
	}
	return value as Record<string, unknown>;
};

const expectV1CrdtShape = (model: Record<string, unknown>) => {
	const block = getCrdtBlock(model);
	expect(block).toBeTruthy();
	expect(block).toHaveProperty("attrs");
	expect(block).toHaveProperty("rels");
	for (const key of Object.keys(block ?? {})) {
		expect(["attrs", "rels"]).toContain(key);
	}
};

describe("semantic graph declarations", () => {
	it("exports clip timing and lifecycle metadata for resource, text, and effects", () => {
		const clipTiming = getAggregate(
			Clip as unknown as Record<string, unknown>,
			"clipTiming",
		);
		expect(clipTiming).toMatchObject({
			kind: "group",
			deps: {
				sourceDuration: {
					fromMember: "resource",
					addr: "< duration",
				},
			},
		});

		expect(
			getAttrAggregate(Clip as unknown as Record<string, unknown>, "start"),
		).toMatchObject({ name: "clipTiming", as: "start" });
		expect(
			getAttrAggregate(Clip as unknown as Record<string, unknown>, "in"),
		).toMatchObject({ name: "clipTiming", as: "inPoint" });
		expect(
			getAttrAggregate(Clip as unknown as Record<string, unknown>, "duration"),
		).toMatchObject({ name: "clipTiming", as: "duration" });

		expect(
			getRelOptions(Clip as unknown as Record<string, unknown>, "resource"),
		).toMatchObject({
			role: "ref",
			aggregate: { name: "clipTiming", role: "evidence", as: "resource" },
		});

		const clipLifecycle = getAggregate(
			Clip as unknown as Record<string, unknown>,
			"clipLifecycle",
		);
		expect(clipLifecycle).toMatchObject({
			kind: "entity",
			delete: "tombstone",
			concurrentActivity: "conflict",
			ownedSubtree: "include",
		});

		expect(
			getRelOptions(Clip as unknown as Record<string, unknown>, "effects"),
		).toMatchObject({
			role: "owner",
			ownership: "slot-single",
			inverseRel: "clip",
			aggregate: { name: "clipLifecycle", role: "evidence", as: "effects" },
		});
		expect(
			getRelOptions(Clip as unknown as Record<string, unknown>, "text"),
		).toMatchObject({
			role: "owner",
			ownership: "slot-single",
			inverseRel: "clip",
			aggregate: { name: "clipLifecycle", role: "evidence", as: "text" },
		});
	});

	it("exports project, track, and resource inverseRel metadata", () => {
		expect(
			getAggregate(Project as unknown as Record<string, unknown>, "projectTracks"),
		).toMatchObject({
			kind: "ordered-membership",
			move: "atomic",
			insert: "sequence",
			remove: "tombstone-membership",
		});
		expect(
			getRelOptions(Project as unknown as Record<string, unknown>, "tracks"),
		).toMatchObject({
			role: "owner",
			ownership: "multi",
			inverseRel: "project",
			aggregate: { name: "projectTracks", role: "primary", as: "tracks" },
		});
		expect(
			getRelOptions(Track as unknown as Record<string, unknown>, "project"),
		).toMatchObject({
			role: "nav",
			inverseRel: "tracks",
			aggregate: { name: "projectTracks", role: "mirror", as: "project" },
		});

		expect(
			getRelOptions(Project as unknown as Record<string, unknown>, "resources"),
		).toMatchObject({
			role: "owner",
			ownership: "multi",
			inverseRel: "project",
			aggregate: {
				name: "resourceLifecycle",
				role: "primary",
				as: "resources",
			},
		});
		expect(
			getRelOptions(Resource as unknown as Record<string, unknown>, "project"),
		).toMatchObject({
			role: "nav",
			inverseRel: "resources",
			aggregate: {
				name: "resourceLifecycle",
				role: "mirror",
				as: "project",
			},
		});
		expect(
			getRelOptions(Resource as unknown as Record<string, unknown>, "clips"),
		).toMatchObject({
			role: "ref",
			aggregate: {
				name: "resourceLifecycle",
				role: "evidence",
				as: "clips",
			},
		});
	});

	it("exports resource and effect aggregate metadata used by lifecycle checks", () => {
		expect(
			getAggregate(Project as unknown as Record<string, unknown>, "resourceLifecycle"),
		).toMatchObject({
			kind: "entity",
			delete: "tombstone",
			concurrentActivity: "conflict",
			orphan: "conflict",
		});
		expect(
			getAggregate(Project as unknown as Record<string, unknown>, "importPipeline"),
		).toMatchObject({
			kind: "pipeline",
			write: "domain-action",
		});
		expect(
			getActionAggregate(
				Project as unknown as Record<string, unknown>,
				"requestImportFiles",
			),
		).toMatchObject({
			name: "importPipeline",
			role: "boundary",
			as: "requestImportFiles",
			permission: "entry",
		});
		expect(
			getActionAggregate(
				Project as unknown as Record<string, unknown>,
				"setImportProgress",
			),
		).toMatchObject({
			name: "importPipeline",
			role: "boundary",
			as: "setImportProgress",
			permission: "internal",
		});
		expect(
			getActionAggregate(
				EditorSessionRoot as unknown as Record<string, unknown>,
				"setActiveProjectImportProgress",
			),
		).toMatchObject({
			name: "importPipeline",
			role: "boundary",
			as: "setActiveProjectImportProgress",
			permission: "entry",
		});
		expect(
			getAttrAggregate(Resource as unknown as Record<string, unknown>, "status"),
		).toMatchObject({ name: "importPipeline", as: "status" });
		expect(
			getAttrAggregate(
				Resource as unknown as Record<string, unknown>,
				"timelineAddRequest",
			),
		).toMatchObject({ name: "importPipeline", as: "timelineAddRequest" });
		expect(
			getAttrAggregate(Effect as unknown as Record<string, unknown>, "params"),
		).toMatchObject({ name: "effectParams", as: "params" });
		expect(
			getRelOptions(Effect as unknown as Record<string, unknown>, "clip"),
		).toMatchObject({
			role: "nav",
			inverseRel: "effects",
		});
	});

	it("exports CRDT declarations in V1 attrs/rels shape", () => {
		for (const model of [Project, Track, Clip, Resource, Text, Effect]) {
			expectV1CrdtShape(model as unknown as Record<string, unknown>);
		}
		expect(getCrdtBlock(EditorSessionRoot as unknown as Record<string, unknown>))
			.toBeUndefined();

		expect(
			getCrdtSection(Project as unknown as Record<string, unknown>, "attrs"),
		).toMatchObject({
			title: "lww",
			fps: "lww",
			width: "lww",
			height: "lww",
			duration: "lww",
			createdAt: "lww",
			updatedAt: "lww",
			autoCreateDefaultTracks: null,
			importProgress: null,
			lastImportError: null,
			activeImportTaskId: null,
			previewFrame: null,
		});
		expect(
			getCrdtSection(Project as unknown as Record<string, unknown>, "rels"),
		).toMatchObject({
			tracks: "sequence",
			resources: "or-set",
			primaryVideoTrack: null,
			primaryAudioTrack: null,
		});
	});

	it("marks conflict-capable timing, timeline, and effect CRDT fields", () => {
		expect(
			getCrdtSection(Clip as unknown as Record<string, unknown>, "attrs"),
		).toMatchObject({
			start: ["mvr", { conflictMeta: true }],
			in: ["mvr", { conflictMeta: true }],
			duration: ["mvr", { conflictMeta: true }],
			trimStart: null,
			effectStackSummary: null,
		});
		expect(
			getCrdtSection(Track as unknown as Record<string, unknown>, "rels"),
		).toMatchObject({
			clips: ["sequence", { conflictMeta: true }],
		});
		expect(
			getCrdtSection(Clip as unknown as Record<string, unknown>, "rels"),
		).toMatchObject({
			track: ["lww", { conflictMeta: true }],
		});
		expect(
			getCrdtSection(Effect as unknown as Record<string, unknown>, "attrs"),
		).toMatchObject({
			amount: ["mvr", { conflictMeta: true }],
			params: ["mvr", { conflictMeta: true }],
			color: ["mvr", { conflictMeta: true }],
		});
	});

	it("keeps pipeline and projection fields local to ordinary DKT state", () => {
		expect(
			getCrdtSection(Resource as unknown as Record<string, unknown>, "attrs"),
		).toMatchObject({
			status: null,
			timelineAddRequest: null,
		});
		expect(
			getCrdtSection(Resource as unknown as Record<string, unknown>, "rels"),
		).toMatchObject({
			project: null,
			clips: null,
		});
		expect(getCrdtBlock(EditorSessionRoot as unknown as Record<string, unknown>))
			.toBeUndefined();
	});
});
