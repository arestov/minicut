import { createHash } from "node:crypto";
import { open } from "node:fs/promises";

export const NODE_FINGERPRINT_DEFAULT_CHUNK_SIZE = 4 * 1024 * 1024;

/**
 * Same bounded-memory tree hash as the Web `fingerprintMediaFile`
 * (media/mediaContentFingerprint.ts): SHA-256 of each chunk, chained through
 * SHA-256 of (accumulator || chunk digest). Identical bytes give the same
 * fingerprint and version string on both hosts, so recovery identity checks
 * work across them.
 */
export const fingerprintNodeFile = async (
	filePath: string,
	chunkSize = NODE_FINGERPRINT_DEFAULT_CHUNK_SIZE,
	signal?: AbortSignal,
): Promise<{ fingerprint: string; version: string }> => {
	if (!Number.isInteger(chunkSize) || chunkSize <= 0) {
		throw new Error("Invalid fingerprint chunk size");
	}
	const handle = await open(filePath, "r");
	try {
		let accumulator = createHash("sha256").update(new Uint8Array()).digest();
		const buffer = Buffer.allocUnsafe(chunkSize);
		for (;;) {
			if (signal?.aborted) throw new Error("Fingerprint cancelled");
			const { bytesRead } = await handle.read(buffer, 0, chunkSize, null);
			if (bytesRead === 0) break;
			const chunkDigest = createHash("sha256")
				.update(buffer.subarray(0, bytesRead))
				.digest();
			accumulator = createHash("sha256")
				.update(accumulator)
				.update(chunkDigest)
				.digest();
		}
		return {
			fingerprint: accumulator.toString("hex"),
			version: `sha256-chain-${chunkSize}-v2`,
		};
	} finally {
		await handle.close();
	}
};
