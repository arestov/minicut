import { describe, expect, it } from "vitest";
import { MemoryWorkerAuthority } from "../../worker/memoryWorker";
import { miniCutEditorRootShape } from "../../ui/dkt/shapes";
import { createMiniCutPageSyncRuntime } from "./createMiniCutPageSyncRuntime";

const waitFor = async (predicate: () => boolean): Promise<void> => {
	for (let attempt = 0; attempt < 500; attempt += 1) {
		if (predicate()) {
			return;
		}
		await new Promise((resolve) => setTimeout(resolve, 0));
	}
	throw new Error("Timed out waiting for React sync state");
};

describe("MiniCut DKT to React dynamic shape delivery", () => {
	it("delivers root and newly created project/track attrs through the real sync sender", async () => {
		const authority = new MemoryWorkerAuthority();
		const pageRuntime = createMiniCutPageSyncRuntime({
			transport: authority.openDktTransport(),
		});

		try {
			pageRuntime.bootstrap({ sessionKey: "react-sync-shape-delivery" });
			await waitFor(() => pageRuntime.getRootScope() != null);

			const rootScope = pageRuntime.getRootScope();
			if (!rootScope) {
				throw new Error("Expected bootstrapped root scope");
			}

			const stopShape = pageRuntime.mountShape(
				rootScope,
				miniCutEditorRootShape,
			);

			try {
				await pageRuntime.waitForRuntimeSettled?.();
				await waitFor(
					() =>
						typeof pageRuntime.readAttrs(rootScope, ["timelineZoom"])
							.timelineZoom === "number",
				);
				expect(
					pageRuntime.readAttrs(rootScope, ["timelineZoom"]).timelineZoom,
				).toBe(56);

				await pageRuntime.dispatchAndWait(
					"createProject",
					{ title: "Shape delivery project" },
					rootScope,
				);
				await pageRuntime.waitForRuntimeSettled?.();

				await waitFor(() => {
					const pioneer = pageRuntime.readOne(rootScope, "pioneer");
					if (!pioneer) {
						return false;
					}
					return pageRuntime
						.readMany(pioneer, "project")
						.some(
							(project) =>
								pageRuntime.readAttrs(project, ["title"]).title ===
								"Shape delivery project",
						);
				});

				const pioneer = pageRuntime.readOne(rootScope, "pioneer");
				if (!pioneer) {
					throw new Error("Expected pioneer scope");
				}
				const project = pageRuntime
					.readMany(pioneer, "project")
					.find(
						(candidate) =>
							pageRuntime.readAttrs(candidate, ["title"]).title ===
							"Shape delivery project",
					);
				if (!project) {
					throw new Error("Expected newly created project scope");
				}

				const tracks = pageRuntime.readMany(project, "tracks");
				expect(tracks).toHaveLength(2);
				expect(
					tracks.map((track) => pageRuntime.readAttrs(track, ["kind"]).kind).sort(),
				).toEqual(["audio", "video"]);
				expect(
					tracks.every(
						(track) =>
							typeof pageRuntime.readAttrs(track, ["name"]).name === "string",
					),
				).toBe(true);
			} finally {
				stopShape();
			}
		} finally {
			pageRuntime.destroy();
			authority.destroy();
		}
	});
});
