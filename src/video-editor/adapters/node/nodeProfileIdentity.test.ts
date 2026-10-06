import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createMiniCutRoomPeerId } from "../../dkt/storage/minicutWorkspaceManifest";
import {
	getOrCreateNodeProfileIdentity,
	NodeProfileIdentityError,
} from "./nodeProfileIdentity";
import {
	NODE_PROFILE_METADATA_FILE_NAME,
	NODE_PROFILE_WORKSPACES_DIR_NAME,
} from "./nodeProfileLayout";

const createSequenceGenerator = (prefix: string) => {
	let counter = 0;
	const generate = () => {
		counter += 1;
		return `${prefix}-${counter}`;
	};
	return { generate, calls: () => counter };
};

const readFailure = async (promise: Promise<unknown>) => {
	const error = await promise.then(
		() => null,
		(reason: unknown) => reason,
	);
	expect(error).toBeInstanceOf(NodeProfileIdentityError);
	return error as NodeProfileIdentityError;
};

describe("getOrCreateNodeProfileIdentity", () => {
	let tempDir: string;
	let profileDir: string;

	beforeEach(async () => {
		tempDir = await mkdtemp(path.join(tmpdir(), "minicut-profile-"));
		profileDir = path.join(tempDir, "profile");
	});

	afterEach(async () => {
		await rm(tempDir, { recursive: true, force: true });
	});

	it("creates and persists identity on the first run", async () => {
		const ids = createSequenceGenerator("id");

		const identity = await getOrCreateNodeProfileIdentity({
			profileDir,
			generateUuid: ids.generate,
			now: () => "2026-01-01T00:00:00.000Z",
		});

		expect(identity).toMatchObject({
			created: true,
			localIdentity: "id-1",
			roomId: "id-2",
			workspaceId: "harness:room:id-2",
			peerId: createMiniCutRoomPeerId("harness:room:id-2", "id-1"),
		});
		expect(identity.storagePath).toBe(
			path.join(profileDir, NODE_PROFILE_WORKSPACES_DIR_NAME, "id-2", "leveldb"),
		);
		const persisted = JSON.parse(
			await readFile(path.join(profileDir, NODE_PROFILE_METADATA_FILE_NAME), "utf8"),
		);
		expect(persisted).toMatchObject({
			kind: "minicut-profile",
			profileVersion: 1,
			localIdentity: "id-1",
			roomId: "id-2",
		});
	});

	it("reads the saved identity on restart without generating ids", async () => {
		const first = await getOrCreateNodeProfileIdentity({
			profileDir,
			generateUuid: createSequenceGenerator("first").generate,
		});
		const unused = createSequenceGenerator("second");

		const second = await getOrCreateNodeProfileIdentity({
			profileDir,
			generateUuid: unused.generate,
		});

		expect(unused.calls()).toBe(0);
		expect(second).toEqual({ ...first, created: false });
	});

	it("gives a new profile a different local identity and room", async () => {
		const other = path.join(tempDir, "other-profile");
		const first = await getOrCreateNodeProfileIdentity({ profileDir });
		const second = await getOrCreateNodeProfileIdentity({ profileDir: other });

		expect(second.localIdentity).not.toBe(first.localIdentity);
		expect(second.roomId).not.toBe(first.roomId);
		expect(second.peerId).not.toBe(first.peerId);
	});

	it("reports corrupted metadata instead of creating another workspace", async () => {
		await mkdir(profileDir, { recursive: true });
		const metadataPath = path.join(profileDir, NODE_PROFILE_METADATA_FILE_NAME);
		await writeFile(metadataPath, "{ not json", "utf8");
		const ids = createSequenceGenerator("never");

		const error = await readFailure(
			getOrCreateNodeProfileIdentity({ profileDir, generateUuid: ids.generate }),
		);

		expect(error.code).toBe("metadata_corrupted");
		expect(ids.calls()).toBe(0);
		expect(await readFile(metadataPath, "utf8")).toBe("{ not json");
	});

	it("reports metadata with missing identity fields", async () => {
		await mkdir(profileDir, { recursive: true });
		await writeFile(
			path.join(profileDir, NODE_PROFILE_METADATA_FILE_NAME),
			JSON.stringify({ kind: "minicut-profile", profileVersion: 1, roomId: "r" }),
			"utf8",
		);

		const error = await readFailure(getOrCreateNodeProfileIdentity({ profileDir }));

		expect(error.code).toBe("metadata_corrupted");
	});

	it("rejects ids that are unsafe as path segments", async () => {
		await mkdir(profileDir, { recursive: true });
		await writeFile(
			path.join(profileDir, NODE_PROFILE_METADATA_FILE_NAME),
			JSON.stringify({
				kind: "minicut-profile",
				profileVersion: 1,
				localIdentity: "local",
				roomId: "../escape",
				createdAt: "2026-01-01T00:00:00.000Z",
			}),
			"utf8",
		);

		const error = await readFailure(getOrCreateNodeProfileIdentity({ profileDir }));

		expect(error.code).toBe("metadata_corrupted");
	});

	it("reports metadata written by a newer version", async () => {
		await mkdir(profileDir, { recursive: true });
		await writeFile(
			path.join(profileDir, NODE_PROFILE_METADATA_FILE_NAME),
			JSON.stringify({
				kind: "minicut-profile",
				profileVersion: 99,
				localIdentity: "local",
				roomId: "room",
				createdAt: "2026-01-01T00:00:00.000Z",
			}),
			"utf8",
		);

		const error = await readFailure(getOrCreateNodeProfileIdentity({ profileDir }));

		expect(error.code).toBe("metadata_unsupported_version");
	});

	it("refuses to create a new workspace when metadata is missing but data exists", async () => {
		await mkdir(path.join(profileDir, NODE_PROFILE_WORKSPACES_DIR_NAME, "old-room"), {
			recursive: true,
		});
		const ids = createSequenceGenerator("never");

		const error = await readFailure(
			getOrCreateNodeProfileIdentity({ profileDir, generateUuid: ids.generate }),
		);

		expect(error.code).toBe("metadata_missing_with_data");
		expect(ids.calls()).toBe(0);
	});

	it("reports an unreadable metadata path", async () => {
		await mkdir(path.join(profileDir, NODE_PROFILE_METADATA_FILE_NAME), {
			recursive: true,
		});

		const error = await readFailure(getOrCreateNodeProfileIdentity({ profileDir }));

		expect(error.code).toBe("metadata_unreadable");
	});

	it("reports a write failure and leaves no metadata behind", async () => {
		const blocker = path.join(tempDir, "blocker");
		await writeFile(blocker, "file, not a directory", "utf8");

		const error = await readFailure(
			getOrCreateNodeProfileIdentity({ profileDir: path.join(blocker, "profile") }),
		);

		expect(error.code).toBe("metadata_write_failed");
	});

	it("returns the same ids for concurrent first runs on an empty profile", async () => {
		const results = await Promise.all(
			Array.from({ length: 8 }, () =>
				getOrCreateNodeProfileIdentity({ profileDir }),
			),
		);

		expect(new Set(results.map((identity) => identity.peerId)).size).toBe(1);
		expect(new Set(results.map((identity) => identity.roomId)).size).toBe(1);
		expect(results.filter((identity) => identity.created)).toHaveLength(1);
		const persisted = JSON.parse(
			await readFile(path.join(profileDir, NODE_PROFILE_METADATA_FILE_NAME), "utf8"),
		);
		expect(persisted.roomId).toBe(results[0]?.roomId);
		expect(await readdir(profileDir)).toEqual([NODE_PROFILE_METADATA_FILE_NAME]);
	});
});
