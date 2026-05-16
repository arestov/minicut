import { describe, expect, it } from "vitest";
import { Clip } from "../../models/Clip";
import { Effect } from "../../models/Effect";
import { Project } from "../../models/Project";
import { Resource } from "../../models/Resource";
import { EditorSessionRoot } from "../../models/SessionRoot";
import { Text } from "../../models/Text";
import { Track } from "../../models/Track";

type FieldSection = "attrs" | "rels";
type FieldClassification =
	| "crdt"
	| "bootstrap-only"
	| "local"
	| "local-pipeline"
	| "mirror"
	| "projection";

type ModelCase = {
	name: string;
	model: Record<string, unknown>;
	fields: Record<FieldSection, Record<string, FieldClassification>>;
};

const CRDT_CLASSIFICATIONS = [
	"crdt",
	"bootstrap-only",
	"local",
	"local-pipeline",
	"mirror",
	"projection",
] as const;

const MODEL_CASES: ModelCase[] = [
	{
		name: "Project",
		model: Project as unknown as Record<string, unknown>,
		fields: {
			attrs: {
				title: "crdt",
				fps: "crdt",
				width: "crdt",
				height: "crdt",
				duration: "crdt",
				importProgress: "local-pipeline",
				lastImportError: "local-pipeline",
				activeImportTaskId: "local-pipeline",
				previewFrame: "projection",
				createdAt: "crdt",
				updatedAt: "crdt",
				autoCreateDefaultTracks: "bootstrap-only",
			},
			rels: {
				tracks: "crdt",
				resources: "crdt",
				primaryVideoTrack: "projection",
				primaryAudioTrack: "projection",
			},
		},
	},
	{
		name: "Track",
		model: Track as unknown as Record<string, unknown>,
		fields: {
			attrs: {
				kind: "crdt",
				name: "crdt",
				muted: "crdt",
				locked: "crdt",
				isVisible: "crdt",
				height: "crdt",
				trackDuration: "projection",
				clipCount: "projection",
			},
			rels: {
				clips: "crdt",
				project: "mirror",
			},
		},
	},
	{
		name: "Clip",
		model: Clip as unknown as Record<string, unknown>,
		fields: {
			attrs: {
				name: "crdt",
				color: "crdt",
				mediaKind: "crdt",
				start: "crdt",
				in: "crdt",
				trimStart: "local",
				duration: "crdt",
				fadeIn: "crdt",
				fadeOut: "crdt",
				audio: "crdt",
				opacity: "crdt",
				transform: "crdt",
				splitOriginalDuration: "local",
				crop: "crdt",
				colorAdjustments: "crdt",
				effectStackSummary: "projection",
			},
			rels: {
				effects: "crdt",
				text: "local",
				resource: "crdt",
				track: "crdt",
				project: "mirror",
				crdtConflicts: "projection",
			},
		},
	},
	{
		name: "Resource",
		model: Resource as unknown as Record<string, unknown>,
		fields: {
			attrs: {
				name: "crdt",
				kind: "crdt",
				url: "crdt",
				mime: "crdt",
				duration: "crdt",
				width: "crdt",
				height: "crdt",
				size: "crdt",
				source: "crdt",
				status: "local-pipeline",
				data: "crdt",
				timelineAddRequest: "local-pipeline",
			},
			rels: {
				project: "mirror",
				clips: "mirror",
			},
		},
	},
	{
		name: "Text",
		model: Text as unknown as Record<string, unknown>,
		fields: {
			attrs: {
				content: "crdt",
				style: "crdt",
				box: "crdt",
			},
			rels: {
				clip: "mirror",
			},
		},
	},
	{
		name: "Effect",
		model: Effect as unknown as Record<string, unknown>,
		fields: {
			attrs: {
				name: "crdt",
				kind: "crdt",
				enabled: "crdt",
				amount: "crdt",
				params: "crdt",
				color: "crdt",
			},
			rels: {
				clip: "mirror",
				project: "mirror",
			},
		},
	},
	{
		name: "EditorSessionRoot",
		model: EditorSessionRoot as unknown as Record<string, unknown>,
		fields: {
			attrs: {
				sessionKey: "projection",
				route: "projection",
				closedAt: "projection",
				isCommonRoot: "projection",
				tabId: "projection",
				activeProjectId: "projection",
				pendingProjectInit: "projection",
				selectedEntityId: "projection",
				activeInspectorTab: "projection",
				cursor: "projection",
				isPlaying: "projection",
				previewBuffer: "projection",
				exportRequest: "projection",
				exportProgress: "projection",
				timelineZoom: "projection",
				timelineTool: "projection",
				snappingEnabled: "projection",
			},
			rels: {
				activeProject: "projection",
				selectedTrack: "projection",
				selectedResource: "projection",
				selectedText: "projection",
				selectedEffect: "projection",
			},
		},
	},
];

const getModelSection = (
	model: Record<string, unknown>,
	section: FieldSection,
): Record<string, unknown> => {
	const value =
		(model[section] as Record<string, unknown> | undefined) ??
		((model.prototype as Record<string, unknown> | undefined)?.[section] as
			| Record<string, unknown>
			| undefined);
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		throw new Error(`Missing model.${section}`);
	}
	return value;
};

const getCrdtSection = (
	model: Record<string, unknown>,
	section: FieldSection,
): Record<string, unknown> | undefined => {
	const block =
		(model.crdt as Record<string, unknown> | undefined) ??
		((model.prototype as Record<string, unknown> | undefined)?.crdt as
			| Record<string, unknown>
			| undefined);
	const value = block?.[section];
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		return undefined;
	}
	return value as Record<string, unknown>;
};

const getInputFieldNames = (
	model: Record<string, unknown>,
	section: FieldSection,
): string[] =>
	Object.entries(getModelSection(model, section))
		.filter(([, descriptor]) => {
			return Array.isArray(descriptor) && descriptor[0] === "input";
		})
		.map(([name]) => name)
		.sort();

describe("CRDT field coverage", () => {
	it("classifies every MiniCut input attr and rel", () => {
		for (const entry of MODEL_CASES) {
			for (const section of ["attrs", "rels"] as const) {
				const inputFields = getInputFieldNames(entry.model, section);
				const classifiedFields = Object.keys(entry.fields[section]).sort();

				expect(classifiedFields, entry.name + "." + section).toEqual(
					inputFields,
				);

				for (const [field, classification] of Object.entries(
					entry.fields[section],
				)) {
					expect(
						CRDT_CLASSIFICATIONS,
						`Invalid CRDT classification for ${entry.name}.${section}.${field}`,
					).toContain(classification);
				}
			}
		}
	});

	it("keeps classification and crdt declarations in sync", () => {
		for (const entry of MODEL_CASES) {
			for (const section of ["attrs", "rels"] as const) {
				const crdtSection = getCrdtSection(entry.model, section);

				for (const [field, classification] of Object.entries(
					entry.fields[section],
				)) {
					const crdtValue = crdtSection?.[field];
					const fieldRef = `${entry.name}.crdt.${section}.${field}`;
					if (classification === "crdt") {
						expect(
							crdtValue,
							`${fieldRef} is classified as crdt and needs a non-null CRDT strategy`,
						).not.toBeUndefined();
						expect(
							crdtValue,
							`${fieldRef} is classified as crdt and cannot be explicit null`,
						).not.toBeNull();
						continue;
					}

					if (crdtSection && field in crdtSection) {
						expect(
							crdtValue,
							`${fieldRef} is classified as ${classification} and should stay explicit null`,
						).toBeNull();
					}
				}
			}
		}
	});
});
