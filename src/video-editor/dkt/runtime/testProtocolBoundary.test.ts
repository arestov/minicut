import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = resolve(__dirname, "../../../..");

const readRepoFile = (path: string): string =>
	readFileSync(resolve(repoRoot, path), "utf8");

describe("DKT test protocol boundary", () => {
	it("keeps idle and debug messages out of production DKT_MSG", () => {
		const messageTypes = readRepoFile(
			"src/video-editor/dkt/shared/messageTypes.ts",
		);

		expect(messageTypes).not.toMatch(/:\s*["']dkt:wait-idle["']/);
		expect(messageTypes).not.toMatch(/:\s*["']dkt:idle["']/);
		expect(messageTypes).not.toMatch(
			/:\s*["']dkt:debug-dump-(request|response)["']/,
		);
		expect(messageTypes).toContain("test:dkt:wait-idle");
		expect(messageTypes).toContain("test:dkt:debug-dump-request");
	});

	it("keeps production runtime dispatch free of settle/debug handlers", () => {
		const runtimeSource = readRepoFile(
			"src/video-editor/dkt/runtime/createMiniCutDktRuntime.ts",
		);

		expect(runtimeSource).not.toContain("DKT_MSG.WAIT_IDLE");
		expect(runtimeSource).not.toContain("DKT_MSG.IDLE");
		expect(runtimeSource).not.toContain("DKT_MSG.DEBUG_DUMP_REQUEST");
		expect(runtimeSource).not.toContain("DKT_MSG.DEBUG_DUMP_RESPONSE");
		expect(runtimeSource).not.toContain("DISPATCH_ACTION_AND_SETTLE");
		expect(runtimeSource).not.toMatch(/appModel\.input\?\(\(\) => resolve\(\)\)/);
		expect(runtimeSource).not.toMatch(/whenAllReady\(\(\) => resolve\(\)\)/);
		expect(runtimeSource).toContain("createMiniCutDktTestRuntimeProtocol");
	});

	it("keeps media transfer independent from DKT settle protocol", () => {
		const mediaSource = readRepoFile(
			"src/video-editor/media/resourceTransferManager.ts",
		);

		expect(mediaSource).not.toContain("waitForRuntimeSettled");
		expect(mediaSource).not.toContain("DKT_TEST_MSG");
		expect(mediaSource).not.toContain("WAIT_IDLE");
		expect(mediaSource).not.toContain("DEBUG_DUMP");
	});
});
