import { describe, expect, it } from "vitest";
import { MemoryWorkerAuthority } from "../../src/video-editor/worker/memoryWorker";
import { miniCutEditorRootShape } from "../../src/video-editor/ui/dkt/shapes";
import { createMiniCutPageSyncRuntime } from "../../src/video-editor/dkt/runtime/createMiniCutPageSyncRuntime";
import { waitFor } from "./testUtils";

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
					pageRuntime.readAttrs(rootScope, [
						"timelineZoom",
						"cursor",
						"isPlaying",
					]),
				).toMatchObject({
					timelineZoom: 56,
					cursor: 0,
					isPlaying: false,
				});

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

				await pageRuntime.dispatchAndWait(
					"addTextClipToTimeline",
					{
						name: "Text contract clip",
						mediaKind: "text",
						start: 0,
						in: 0,
						duration: 3,
						text: { content: "Contract" },
					},
					rootScope,
				);
				await pageRuntime.waitForRuntimeSettled?.();
				await waitFor(() =>
					tracks.some((track) =>
						pageRuntime.readMany(track, "clips").some(
							(clip) =>
								pageRuntime.readAttrs(clip, ["name"]).name ===
								"Text contract clip",
						),
					),
				);
				const clip = tracks
					.flatMap((track) => pageRuntime.readMany(track, "clips"))
					.find(
						(candidate) =>
							pageRuntime.readAttrs(candidate, ["name"]).name ===
							"Text contract clip",
					);
				if (!clip) {
					throw new Error("Expected dynamically created clip scope");
				}
				expect(
					pageRuntime.readAttrs(clip, ["name", "mediaKind", "duration"]),
				).toMatchObject({
					name: "Text contract clip",
					mediaKind: "text",
					duration: 3,
				});
			} finally {
				stopShape();
			}
		} finally {
			pageRuntime.destroy();
			authority.destroy();
		}
	});
});
