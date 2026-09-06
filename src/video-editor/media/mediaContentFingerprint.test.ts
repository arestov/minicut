import { describe, expect, it } from "vitest";
import { fingerprintMediaFile } from "./mediaContentFingerprint";

describe("fingerprintMediaFile", () => {
	it("is deterministic and content-sensitive across chunk boundaries", async () => {
		const first = await fingerprintMediaFile(new File(["abcdefgh"], "a"), 3);
		const same = await fingerprintMediaFile(new File(["abcdefgh"], "b"), 3);
		const different = await fingerprintMediaFile(new File(["abcdefgi"], "a"), 3);
		expect(first).toEqual(same);
		expect(first.fingerprint).not.toBe(different.fingerprint);
		expect(first.version).toBe("sha256-chain-3-v2");
	});

	it("supports cancellation", async () => {
		const controller = new AbortController(); controller.abort();
		await expect(fingerprintMediaFile(new File(["abcdefgh"], "a"), 2, controller.signal)).rejects.toMatchObject({ name: "AbortError" });
	});
});
