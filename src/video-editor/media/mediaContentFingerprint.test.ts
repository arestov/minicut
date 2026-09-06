import { describe, expect, it } from "vitest";
import { fingerprintMediaFile } from "./mediaContentFingerprint";

describe("fingerprintMediaFile", () => {
	it("is deterministic and content-sensitive across chunk boundaries", async () => {
		const first = await fingerprintMediaFile(new File(["abcdefgh"], "a"), 3);
		const same = await fingerprintMediaFile(new File(["abcdefgh"], "b"), 3);
		const different = await fingerprintMediaFile(new File(["abcdefgi"], "a"), 3);
		expect(first).toEqual(same);
		expect(first.fingerprint).not.toBe(different.fingerprint);
		expect(first.version).toBe("sha256-tree-3-v1");
	});
});
