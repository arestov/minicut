import path from "node:path";
import { describe, expect, it } from "vitest";
import { resolveExportDir, resolveProfileDir } from "./desktopProfileConfig";

describe("desktop profile resolution (shared by GPUIX and Electron)", () => {
	it("uses MINICUT_PROFILE_DIR when it is set", () => {
		const profile = path.resolve("shared", "profile");

		expect(resolveProfileDir({ MINICUT_PROFILE_DIR: profile }, "win32", "C:\\Users\\u")).toBe(profile);
		expect(resolveProfileDir({ MINICUT_PROFILE_DIR: profile }, "linux", "/home/u")).toBe(profile);
	});

	it("falls back to one per-user folder per platform", () => {
		expect(resolveProfileDir({ APPDATA: "C:\\Roaming" }, "win32", "C:\\Users\\u")).toBe(
			path.join("C:\\Roaming", "MiniCut", "gpuix-profile"),
		);
		expect(resolveProfileDir({}, "darwin", "/Users/u")).toBe(
			path.join("/Users/u", "Library", "Application Support", "MiniCut", "gpuix-profile"),
		);
		expect(resolveProfileDir({ XDG_DATA_HOME: "/data" }, "linux", "/home/u")).toBe(
			path.join("/data", "minicut", "gpuix-profile"),
		);
		expect(resolveProfileDir({}, "linux", "/home/u")).toBe(
			path.join("/home/u", ".local", "share", "minicut", "gpuix-profile"),
		);
	});

	it("puts exports next to the profile unless MINICUT_EXPORT_DIR says otherwise", () => {
		const profile = path.resolve("profile");

		expect(resolveExportDir(profile, {})).toBe(path.join(profile, "exports"));
		expect(resolveExportDir(profile, { MINICUT_EXPORT_DIR: "out" })).toBe(path.resolve("out"));
	});
});
