import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { createNodeHarnessPlatform } from "../app/platform/nodePlatform";
import { bootDktModels, queryRel } from "../dkt/testingInit";
import { normalizeExportPlan, type ExportPlan } from "../render/renderPlan";

export interface HeadlessOperationProjectCreate {
	op: "project:create";
	title?: string;
}

export interface HeadlessOperationResourceImport {
	op: "resource:import";
	projectId?: string;
	projectRef?: "lastProject";
	name: string;
	kind: "video" | "audio" | "image";
	duration: number;
	mime?: string;
	url?: string;
	size?: number;
}

export interface HeadlessOperationTimelineAddClip {
	op: "timeline:add-clip";
	projectId?: string;
	projectRef?: "lastProject";
	resourceId?: string;
	resourceRef?: "lastResource";
	includeLinkedAudio?: boolean;
}

export type HeadlessOperation =
	| HeadlessOperationProjectCreate
	| HeadlessOperationResourceImport
	| HeadlessOperationTimelineAddClip;

export interface HeadlessScenario {
	commands?: unknown[];
	operations?: HeadlessOperation[];
	export?: { type: "project" } | { type: "clip"; clipId?: string };
}

export interface HeadlessScenarioResult {
	projectCount: number;
	activeProjectId: string | null;
	resourceCount: number;
	exported?: {
		fileName: string;
		mimeType: string;
		size: number;
		frameCount: number;
		duration: number;
		range: { type: "project" } | { type: "clip"; clipId: string };
	};
}

export const runHeadlessScenario = async (
	scenario: HeadlessScenario,
): Promise<HeadlessScenarioResult> => {
	if (scenario.commands?.length) {
		throw new Error("Legacy headless commands are unsupported; use operations");
	}
	const ctx = await bootDktModels();
	let lastProject: (typeof ctx)["sessionRoot"] | null = null;
	let lastResource: (typeof ctx)["sessionRoot"] | null = null;
	try {
		for (const operation of scenario.operations ?? []) {
			if (operation.op === "project:create") {
				const existingProjects = await queryRel(ctx.appModel, "project");
				const bootstrappedProject =
					lastProject == null && existingProjects.length === 1
						? existingProjects[0]
						: null;
				if (bootstrappedProject) {
					await ctx.lockToRead(async () => {
						await bootstrappedProject.dispatch(
							"renameProject",
							operation.title ?? "Untitled project",
						);
						await ctx.sessionRoot.dispatch("syncActiveProjectRel", {
							project: bootstrappedProject,
						});
					});
					lastProject = bootstrappedProject;
				} else {
					await ctx.lockToRead(async () => {
						await ctx.sessionRoot.dispatch("createProject", {
							title: operation.title ?? "Untitled project",
						});
					});
					lastProject =
						(await queryRel(ctx.sessionRoot, "activeProject"))[0] ?? null;
				}
				if (!lastProject) throw new Error("Headless project creation produced no active project");
				continue;
			}

			const projects = await queryRel(ctx.appModel, "project");
			const project = operation.projectId
				? projects.find((item) => item._node_id === operation.projectId) ?? null
				: operation.projectRef === "lastProject"
					? lastProject
					: lastProject ?? projects[0] ?? null;
			if (!project) throw new Error(`${operation.op} requires a project`);

			if (operation.op === "resource:import") {
				const beforeIds = new Set(
					(await queryRel(project, "resources")).map((item) => item._node_id),
				);
				await ctx.lockToRead(async () => {
					await project.dispatch("importResource", {
						name: operation.name,
						kind: operation.kind,
						duration: operation.duration,
						mime: operation.mime ?? `${operation.kind}/*`,
						url: operation.url ?? `headless://${encodeURIComponent(operation.name)}`,
						size: operation.size ?? 0,
						source: { kind: "headless" },
						status: "ready",
						data: { status: "ready" },
					});
				});
				lastResource =
					(await queryRel(project, "resources")).find(
						(item) => !beforeIds.has(item._node_id),
					) ?? null;
				if (!lastResource) throw new Error("Headless resource import produced no resource");
				continue;
			}

			const resources = await queryRel(project, "resources");
			const resource = operation.resourceId
				? resources.find((item) => item._node_id === operation.resourceId) ?? null
				: operation.resourceRef === "lastResource"
					? lastResource
					: lastResource ?? resources[0] ?? null;
			if (!resource?._node_id) {
				throw new Error("timeline:add-clip requires a resource");
			}
			await ctx.lockToRead(async () => {
				await project.dispatch("addResourceToTimeline", resource._node_id);
			});
		}

		const projects = await queryRel(ctx.appModel, "project");
		const activeProject =
			(await queryRel(ctx.sessionRoot, "activeProject"))[0] ?? lastProject;
		const resources = activeProject
			? await queryRel(activeProject, "resources")
			: [];
		const result: HeadlessScenarioResult = {
			projectCount: projects.length,
			activeProjectId: activeProject?._node_id
				? String(activeProject._node_id)
				: null,
			resourceCount: resources.length,
		};

		if (scenario.export && activeProject?._node_id) {
			const tracks = await queryRel(activeProject, "tracks");
			const clips = (
				await Promise.all(tracks.map((track) => queryRel(track, "clips")))
			).flat();
			const ownerGraphClipSources = (
				await Promise.all(
					clips.map((clip) => ctx.queryAttr(clip, "clipRenderData")),
				)
			).filter(
				(value): value is ExportPlan["clipSources"][number] =>
					Boolean(value && typeof value === "object"),
			);
			const projectedClipSources = await ctx.queryAttr(
				activeProject,
				"previewClipSources",
			);
			const clipSources = Array.isArray(projectedClipSources) && projectedClipSources.length
				? (projectedClipSources as ExportPlan["clipSources"])
				: ownerGraphClipSources;
			const graphDuration = clipSources.reduce(
				(max, clip) => Math.max(max, Number(clip.start) + Number(clip.duration)),
				0,
			);
			const plan = normalizeExportPlan({
				projectId: String(activeProject._node_id),
				fps: Number(await ctx.queryAttr(activeProject, "fps")) || 30,
				width: Number(await ctx.queryAttr(activeProject, "width")) || 1920,
				height: Number(await ctx.queryAttr(activeProject, "height")) || 1080,
				duration:
					Number(await ctx.queryAttr(activeProject, "timelineDuration")) ||
					graphDuration,
				clipSources,
			});
			const range =
				scenario.export.type === "clip"
					? {
							type: "clip" as const,
							clipId:
								scenario.export.clipId ??
								plan.clipSources.at(-1)?.id ??
								"",
						}
					: { type: "project" as const };
			if (range.type === "clip" && !range.clipId) {
				throw new Error("Headless clip export requires a clip id");
			}
			const rendered = await createNodeHarnessPlatform()
				.createExportRenderer()
				.render({ plan, range, format: "json-manifest" });
			result.exported = {
				fileName: rendered.fileName,
				mimeType: rendered.mimeType,
				size: rendered.size,
				frameCount: rendered.frameCount,
				duration: rendered.duration,
				range,
			};
		}
		return result;
	} finally {
		await ctx.close();
	}
};

export const runHeadlessScenarioFile = async (
	scenarioPath: string,
	outputPath?: string,
): Promise<HeadlessScenarioResult> => {
	const absoluteScenarioPath = path.resolve(scenarioPath);
	const scenario = JSON.parse(
		await readFile(absoluteScenarioPath, "utf8"),
	) as HeadlessScenario;
	const result = await runHeadlessScenario(scenario);

	if (outputPath) {
		const absoluteOutputPath = path.resolve(outputPath);
		await writeFile(
			absoluteOutputPath,
			`${JSON.stringify(result, null, 2)}\n`,
			"utf8",
		);
	}

	return result;
};
