import path from "node:path";
import { describe, expect, it } from "vitest";
import {
	NODE_PROFILE_WORKSPACES_DIR_NAME,
	resolveNodePreviewProxyDir,
} from "./nodeProfileLayout";

describe("nodeProfileLayout", () => {
	it("places the scrub proxy cache under <profileDir>/cache/preview-proxies", () => {
		const profileDir = path.join("profile", "dir");
		expect(resolveNodePreviewProxyDir(profileDir)).toBe(
			path.join(profileDir, "cache", "preview-proxies"),
		);
	});

	it("keeps the cache outside the workspaces directory", () => {
		const dir = resolveNodePreviewProxyDir("p");
		expect(dir.startsWith(path.join("p", NODE_PROFILE_WORKSPACES_DIR_NAME))).toBe(false);
	});
});
