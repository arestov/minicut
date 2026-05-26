import type { ExportPlan } from "../render/renderPlan";
import {
	AUTH_EXT_CHANNEL,
	AUTH_EXT_EVENT,
	type AuthorityExtensionBus,
} from "./authorityExtensionBus";
import type { EditorActionEnvironment } from "./editorActionEnvironment";
import {
	type ExportRequestState,
	parseExportRequest,
} from "./exportRequestState";
import type { RuntimeTaskDescriptor } from "./runtimeTaskFacade";

const resolveExportPlanClipSources = (
	plan: ExportPlan,
	resolveResourceUrl: (resourceId: string, fallbackUrl: string) => string,
): ExportPlan => {
	if (!Array.isArray(plan.clipSources) || plan.clipSources.length === 0) {
		return plan;
	}

	const clipSources = plan.clipSources.map((clipSource) => {
		if (typeof clipSource.resourceId !== "string" || !clipSource.resourceId) {
			return clipSource;
		}
		const resolvedUrl = resolveResourceUrl(
			clipSource.resourceId,
			clipSource.resourceUrl,
		);
		if (resolvedUrl === clipSource.resourceUrl) {
			return clipSource;
		}
		return {
			...clipSource,
			resourceUrl: resolvedUrl,
		};
	});

	return {
		...plan,
		clipSources,
	};
};

const validateRenderableClipSources = (plan: ExportPlan): void => {
	for (const clipSource of plan.clipSources) {
		if (clipSource.resourceKind === "text") {
			continue;
		}
		if (typeof clipSource.resourceId !== "string" || !clipSource.resourceId) {
			throw new Error(
				`Export clip ${clipSource.id || "<unknown>"} is missing resourceId`,
			);
		}
		if (
			typeof clipSource.resourceUrl !== "string" ||
			!clipSource.resourceUrl.trim()
		) {
			throw new Error(
				`Export clip ${clipSource.id || "<unknown>"} (${clipSource.resourceId}) is missing resourceUrl after resolve`,
			);
		}
	}
};

const getRequestFromTask = (
	task: RuntimeTaskDescriptor,
): ExportRequestState | null => {
	if (!task.payload || typeof task.payload !== "object") {
		return null;
	}
	return parseExportRequest((task.payload as { data?: unknown } | null)?.data);
};

export const executeRenderExportTask = async ({
	task,
	env,
	extensionBus,
}: {
	task: RuntimeTaskDescriptor;
	env: EditorActionEnvironment;
	extensionBus: AuthorityExtensionBus;
}): Promise<void> => {
	if (task.dropped) {
		return;
	}

	const request = getRequestFromTask(task);
	if (!request || !env.dkt) {
		env.tasks.completeTask(task);
		return;
	}

	const setProgress = (
		stage: "queued" | "rendering" | "finalizing" | "done" | "error",
		progress: number,
		extra?: Partial<{
			fileName: string;
			size: number;
			frameCount: number;
			error: string;
		}>,
	): void => {
		env.dkt?.dispatch(
			"setExportProgress",
			{
				id: request.id,
				range: request.range,
				stage,
				progress,
				updatedAt: Date.now(),
				initiatedBy: request.initiatedBy,
				...(extra?.fileName ? { fileName: extra.fileName } : {}),
				...(typeof extra?.size === "number" ? { size: extra.size } : {}),
				...(typeof extra?.frameCount === "number"
					? { frameCount: extra.frameCount }
					: {}),
				...(extra?.error ? { error: extra.error } : {}),
			},
			null,
		);
	};

	try {
		setProgress("queued", 0);

		const resolvedPlan = resolveExportPlanClipSources(
			request.plan,
			(resourceId, fallbackUrl) =>
				env.transfers.resolveResourceUrl(resourceId, fallbackUrl),
		);
		validateRenderableClipSources(resolvedPlan);

		const result = await env.export.renderer.render(
			{
				plan: resolvedPlan,
				range: request.range,
				format: request.format,
			},
			(progressEvent) => {
				const normalizedStage =
					progressEvent.stage === "done" ? "finalizing" : progressEvent.stage;
				setProgress(normalizedStage, Math.round(progressEvent.progress * 100));
			},
		);

		const downloadUrl = env.media.createObjectUrl(result.blob);
		if (downloadUrl) {
			env.lifecycle.registerObjectUrl(downloadUrl, "export");
			env.export.cachedResults.set(request.id, {
				downloadUrl,
				blob: result.blob,
				timestamp: Date.now(),
			});

			extensionBus.publish({
				channel: AUTH_EXT_CHANNEL.EXPORT_DOWNLOAD,
				event: AUTH_EXT_EVENT.EXPORT_READY,
				payload: {
					exportId: request.id,
					downloadUrl,
					fileName: result.fileName,
				},
			});
		}

		setProgress("done", 100, {
			fileName: result.fileName,
			size: result.size,
			frameCount: result.frameCount,
		});
		env.tasks.completeTask(task);
	} catch (error) {
		setProgress("error", 0, {
			error: error instanceof Error ? error.message : "Export failed",
		});
		env.tasks.failTask(task);
	} finally {
		env.dkt.dispatch("consumeExportRequest", { id: request.id }, null);
	}
};
