import { describe, expect, it } from "vitest";
import { Clip } from "../../models/Clip";
import { Effect } from "../../models/Effect";
import { Project } from "../../models/Project";
import { Resource } from "../../models/Resource";
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
	});

	it("exports resource and effect aggregate metadata used by lifecycle checks", () => {
		expect(
			getAggregate(Project as unknown as Record<string, unknown>, "resourceLifecycle"),
		).toMatchObject({
			kind: "entity",
			delete: "tombstone",
			concurrentActivity: "conflict",
		});
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
});
