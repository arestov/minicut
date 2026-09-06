const DEFAULT_CHUNK_SIZE = 4 * 1024 * 1024;
const hex = (bytes: Uint8Array) => Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");

/** Bounded-memory tree hash: SHA-256 each chunk, then SHA-256 the ordered digest list. */
const throwIfAborted = (signal?: AbortSignal) => {
	if (signal?.aborted) throw new DOMException("Fingerprint cancelled", "AbortError");
};

export const fingerprintMediaFile = async (file: File, chunkSize = DEFAULT_CHUNK_SIZE, signal?: AbortSignal) => {
	if (!Number.isInteger(chunkSize) || chunkSize <= 0) throw new Error("Invalid fingerprint chunk size");
	let accumulator = new Uint8Array(await crypto.subtle.digest("SHA-256", new Uint8Array()));
	for (let offset = 0; offset < file.size; offset += chunkSize) {
		throwIfAborted(signal);
		const chunk = await file.slice(offset, Math.min(file.size, offset + chunkSize)).arrayBuffer();
		throwIfAborted(signal);
		const chunkDigest = new Uint8Array(await crypto.subtle.digest("SHA-256", chunk));
		const pair = new Uint8Array(64); pair.set(accumulator); pair.set(chunkDigest, 32);
		accumulator = new Uint8Array(await crypto.subtle.digest("SHA-256", pair));
	}
	throwIfAborted(signal);
	return { fingerprint: hex(accumulator), version: `sha256-chain-${chunkSize}-v2` };
};
