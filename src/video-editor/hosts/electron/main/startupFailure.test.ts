import { describe, expect, it } from "vitest";
import { NodeLevelDbStorageOpenError } from "../../../adapters/node/createNodeLevelDbStoragePackage";
import { MediaServiceStartError } from "./mediaServiceProcess";
import { describeStartupFailure } from "./startupFailure";

const lockedCause = Object.assign(new Error("Database failed to open"), {
	code: "LEVEL_DATABASE_NOT_OPEN",
	cause: Object.assign(new Error("IO error: LockFile"), { code: "LEVEL_LOCKED" }),
});

describe("describeStartupFailure", () => {
	it("explains a held profile and how to resolve it", () => {
		const failure = describeStartupFailure(
			new NodeLevelDbStorageOpenError("/profile/db", lockedCause),
			"/profile",
		);

		expect(failure.kind).toBe("profile-locked");
		expect(failure.title).toBe("MiniCut is already open with this profile");
		expect(failure.detail).toContain("MINICUT_PROFILE_DIR");
		expect(failure.detail).toContain("GPUIX");
		expect(failure.detail).toContain("/profile");
	});

	it("does not call an unreadable database a lock", () => {
		const failure = describeStartupFailure(
			new NodeLevelDbStorageOpenError("/profile/db", new Error("corrupted")),
			"/profile",
		);

		expect(failure.kind).toBe("database-unreadable");
		expect(failure.detail).toContain("/profile/db");
	});

	it("reports a media service that cannot start with its own reason", () => {
		const failure = describeStartupFailure(
			new MediaServiceStartError("ffmpeg was not found"),
			"/profile",
		);

		expect(failure).toMatchObject({ kind: "media-service", detail: "ffmpeg was not found" });
	});

	it("shows any other error as it is", () => {
		expect(describeStartupFailure(new Error("boom"), "/profile")).toMatchObject({
			kind: "other",
			detail: "boom",
		});
		expect(describeStartupFailure("text", "/profile").detail).toBe("text");
	});
});
