import { describe, expect, it } from "vitest";
import { Clip } from "../../models/Clip";
import { Effect } from "../../models/Effect";
import { MiniCutAppRoot } from "../../models/AppRoot";
import { Project } from "../../models/Project";
import { Resource } from "../../models/Resource";
import { ReviewArchiveEntry } from "../../models/ReviewArchiveEntry";
import { EditorSessionRoot } from "../../models/SessionRoot";
import { Text } from "../../models/Text";
import { Track } from "../../models/Track";

type FieldSection = "attrs" | "rels";
type FieldClassification =
	| "crdt"
	| "bootstrap-only"
	| "effect-runtime"
	| "framework-owned"
	| "pipeline"
	| "projection";

type ModelCase = {
	name: string;
	model: Record<string, unknown>;
	fields: Record<FieldSection, Record<string, FieldClassification>>;
};

const CRDT_CLASSIFICATIONS = [
	"crdt",
	"bootstrap-only",
	"effect-runtime",
	"framework-owned",
	"pipeline",
	"projection",
] as const;

const EXPECTED_EXCLUSION_REASONS: Record<
	Exclude<FieldClassification, "crdt">,
	string
> = {
	"bootstrap-only": "bootstrap-only",
	"effect-runtime": "effect-runtime",
	"framework-owned": "framework-owned",
	pipeline: "pipeline",
	projection: "projection",
};

const MODEL_CASES: ModelCase[] = [
	{
		name: "MiniCutAppRoot",
		model: MiniCutAppRoot as unknown as Record<string, unknown>,
		fields: {
			attrs: {
				activeReviewItemId: "projection",
				projectMetaList: "projection",
				$meta$apis$mediaRestoreRuntime$used: "effect-runtime",
			},
			rels: {
				common_session_root: "projection",
				sessions: "projection",
				free_sessions: "projection",
				project: "crdt",
				attendedProject: "projection",
				track: "projection",
				resource: "projection",
				mediaRecoveryTask: "projection",
				clip: "projection",
				text: "projection",
				effect: "projection",
				reviewItem: "projection",
				reviewArchiveEntry: "projection",
				reviewSession: "projection",
				activitySummary: "projection",
			},
		},
	},
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
				importProgress: "pipeline",
				lastImportError: "pipeline",
				activeImportTaskId: "effect-runtime",
				previewFrame: "projection",
				createdAt: "crdt",
				updatedAt: "crdt",
				autoCreateDefaultTracks: "bootstrap-only",
			},
			rels: {
				rootOwner: "framework-owned",
				tracks: "crdt",
				resources: "crdt",
				primaryVideoTrack: "crdt",
				primaryAudioTrack: "crdt",
			},
		},
	},
	{
		name: "ReviewArchiveEntry",
		model: ReviewArchiveEntry as unknown as Record<string, unknown>,
		fields: {
			attrs: {
				archiveEntryId: "projection",
				conflictId: "projection",
				reviewItemId: "projection",
				projectId: "projection",
				sourceConflictClipId: "projection",
				editedVariant: "projection",
				createdAt: "projection",
			},
			rels: { rootOwner: "framework-owned" },
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
				enabled: "crdt",
				isVisible: "crdt",
				height: "crdt",
				trackRole: "crdt",
				visibleInPreview: "crdt",
				trackDuration: "projection",
				clipCount: "projection",
			},
			rels: {
				clips: "crdt",
				project: "framework-owned",
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
				trimStart: "crdt",
				duration: "crdt",
				fadeIn: "crdt",
				fadeOut: "crdt",
				audio: "crdt",
				opacity: "crdt",
				transform: "crdt",
				splitOriginalDuration: "crdt",
				crop: "crdt",
				colorAdjustments: "crdt",
				effectStackSummary: "projection",
			},
			rels: {
				effects: "crdt",
				text: "crdt",
				resource: "crdt",
				track: "framework-owned",
				project: "crdt",
				crdtConflicts: "framework-owned",
			},
		},
	},
	{
		name: "Resource",
		model: Resource as unknown as Record<string, unknown>,
		fields: {
			attrs: {
				"$meta$removed": "crdt",
				name: "crdt",
				kind: "crdt",
				url: "effect-runtime",
				mime: "crdt",
				duration: "crdt",
				width: "crdt",
				height: "crdt",
				size: "crdt",
				lastModified: "crdt",
				sourceKind: "crdt",
				sourceRef: "crdt",
				source: "crdt",
				status: "crdt",
				data: "effect-runtime",
				timelineAddRequest: "effect-runtime",
				doneBoot: "effect-runtime",
				assetStorageKind: "crdt",
				assetRef: "crdt",
				contentFingerprint: "crdt",
				fingerprintVersion: "crdt",
				localMediaStatus: "effect-runtime",
				localMediaAvailability: "effect-runtime",
				originalAccessStatus: "effect-runtime",
			},
			rels: {
				project: "framework-owned",
				clips: "crdt",
				activeMediaRecoveryTask: "effect-runtime",
				mediaRecoveryTasks: "effect-runtime",
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
				clip: "framework-owned",
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
				clip: "framework-owned",
				project: "crdt",
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
				storageOpenStatus: "projection",
				isCommonRoot: "projection",
				tabId: "projection",
				activeProjectId: "projection",
				pendingProjectInit: "projection",
				selectedEntityId: "projection",
				activeInspectorTab: "projection",
				cursor: "projection",
				playbackIntent: "projection",
				playbackRunId: "projection",
				playStartCursor: "projection",
				playStartedAt: "projection",
				playbackRate: "projection",
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

const getCrdtBlock = (
	model: Record<string, unknown>,
): Record<string, unknown> | undefined =>
	(model.crdt as Record<string, unknown> | undefined) ??
	((model.prototype as Record<string, unknown> | undefined)?.crdt as
		| Record<string, unknown>
		| undefined);

const getCrdtSection = (
	model: Record<string, unknown>,
	section: FieldSection,
): Record<string, unknown> | undefined => {
	const block = getCrdtBlock(model);
	const value = block?.[section];
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		return undefined;
	}
	return value as Record<string, unknown>;
};

const getDeclaredCrdtFieldNames = (
	model: Record<string, unknown>,
	section: FieldSection,
	includeComputedRels = false,
): string[] =>
	Object.entries(getModelSection(model, section))
		.filter(([, descriptor]) => {
			return (
				Array.isArray(descriptor) &&
				(descriptor[0] === "input" ||
					(section === "rels" && includeComputedRels && descriptor[0] === "comp") ||
					descriptor[0] === "model" ||
					descriptor[0] === "sel")
			);
		})
		.map(([name]) => name)
		.filter((name) => !name.startsWith("$"))
		.sort();

describe("CRDT field coverage", () => {
	it("declares collaborative and local model modes explicitly", () => {
		for (const entry of MODEL_CASES) {
			const mode = getCrdtBlock(entry.model)?.mode;
			if (
				entry.name === "EditorSessionRoot" ||
				entry.name === "ReviewArchiveEntry"
			) {
				expect(mode, entry.name).toBe("local");
				continue;
			}
			expect(mode, entry.name).toBe("collaborative");
		}
	});

	it("classifies every MiniCut input attr and rel", () => {
		for (const entry of MODEL_CASES) {
			for (const section of ["attrs", "rels"] as const) {
				const systemFields = Object.keys(entry.fields[section]).filter((name) =>
					name.startsWith("$meta$"),
				);
				const declaredFields = [
					...getDeclaredCrdtFieldNames(
						entry.model,
						section,
						entry.name === "MiniCutAppRoot",
					),
					...systemFields,
				].sort();
				const classifiedFields = Object.keys(entry.fields[section]).sort();

				expect(classifiedFields, entry.name + "." + section).toEqual(
					declaredFields,
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

	it("keeps classification and strict crdt declarations in sync", () => {
		for (const entry of MODEL_CASES) {
			if (getCrdtBlock(entry.model)?.mode === "local") {
				continue;
			}
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
						expect(
							(crdtValue as { sync?: unknown })?.sync,
							`${fieldRef} is classified as crdt and cannot be an exclusion`,
						).not.toBe(false);
						continue;
					}

					expect(
						crdtValue,
						`${fieldRef} is classified as ${classification} and needs an explicit exclusion`,
					).toMatchObject({
						sync: false,
						reason: EXPECTED_EXCLUSION_REASONS[classification],
					});
				}

				for (const [field, crdtValue] of Object.entries(crdtSection ?? {})) {
					expect(
						crdtValue,
						`${entry.name}.crdt.${section}.${field} cannot use bare null`,
					).not.toBeNull();
				}
			}
		}
	});
});
