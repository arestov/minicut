const DEFAULT_CHUNK_SIZE = 4 * 1024 * 1024;
const hex = (bytes: Uint8Array) => Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");

/** Bounded-memory tree hash: SHA-256 each chunk, then SHA-256 the ordered digest list. */
export const fingerprintMediaFile = async (file: File, chunkSize = DEFAULT_CHUNK_SIZE) => {
	if (!Number.isInteger(chunkSize) || chunkSize <= 0) throw new Error("Invalid fingerprint chunk size");
	const chunkDigests: Uint8Array[] = [];
	for (let offset = 0; offset < file.size; offset += chunkSize) {
		const chunk = await file.slice(offset, Math.min(file.size, offset + chunkSize)).arrayBuffer();
		chunkDigests.push(new Uint8Array(await crypto.subtle.digest("SHA-256", chunk)));
	}
	if (chunkDigests.length === 0) chunkDigests.push(new Uint8Array(await crypto.subtle.digest("SHA-256", new Uint8Array())));
	const treeInput = new Uint8Array(chunkDigests.length * 32);
	chunkDigests.forEach((digest, index) => treeInput.set(digest, index * 32));
	const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", treeInput));
	return { fingerprint: hex(digest), version: `sha256-tree-${chunkSize}-v1` };
};
