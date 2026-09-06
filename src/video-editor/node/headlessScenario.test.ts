import { describe, expect, it } from "vitest";
import { runHeadlessScenario } from "./headlessScenario";

describe("headless DKT scenario", () => {
	it("creates, imports, places, and exports through the DKT owner graph", async () => {
		const result = await runHeadlessScenario({
			operations: [
				{ op: "project:create", title: "Headless test" },
				{
					op: "resource:import",
					projectRef: "lastProject",
					name: "Sample clip",
					kind: "video",
					duration: 2,
				},
				{
					op: "timeline:add-clip",
					projectRef: "lastProject",
					resourceRef: "lastResource",
				},
			],
			export: { type: "project" },
		});

		expect(result).toMatchObject({
			projectCount: 1,
			resourceCount: 1,
			exported: {
				mimeType: "application/vnd.minicut.export+json",
				duration: 2,
				frameCount: 60,
				range: { type: "project" },
			},
		});
		expect(result.activeProjectId).toBeTruthy();
	});
});
