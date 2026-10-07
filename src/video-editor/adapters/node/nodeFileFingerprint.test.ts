import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { fingerprintMediaFile } from "../../media/mediaContentFingerprint";
import { fingerprintNodeFile } from "./nodeFileFingerprint";

describe("fingerprintNodeFile", () => {
	let dir: string;
	beforeEach(async () => {
		dir = await mkdtemp(path.join(tmpdir(), "minicut-fp-"));
	});
	afterEach(async () => {
		await rm(dir, { recursive: true, force: true });
	});

	it("matches the Web fingerprint for the same bytes, across chunk boundaries", async () => {
		const bytes = new Uint8Array(10_000);
		for (let index = 0; index < bytes.length; index += 1) bytes[index] = index % 251;
		const file = path.join(dir, "a.bin");
		await writeFile(file, bytes);

		for (const chunkSize of [4096, 10_000, 1 << 20]) {
			const node = await fingerprintNodeFile(file, chunkSize);
			const web = await fingerprintMediaFile(new File([bytes], "a.bin"), chunkSize);
			expect(node).toEqual(web);
		}
	});

	it("fingerprints an empty file like the Web implementation", async () => {
		const file = path.join(dir, "empty.bin");
		await writeFile(file, new Uint8Array());
		expect(await fingerprintNodeFile(file)).toEqual(
			await fingerprintMediaFile(new File([], "empty.bin")),
		);
	});

	it("differs for different content", async () => {
		const first = path.join(dir, "1.bin");
		const second = path.join(dir, "2.bin");
		await writeFile(first, "one");
		await writeFile(second, "two");
		expect((await fingerprintNodeFile(first)).fingerprint).not.toBe(
			(await fingerprintNodeFile(second)).fingerprint,
		);
	});
});
