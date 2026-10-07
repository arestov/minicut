import { PCM_BYTES_PER_FRAME } from "./pcmSource";

/** FIFO of raw f32 stereo bytes with frame-exact reads. */
export type PcmBuffer = {
	/** Whole frames currently held. */
	readonly frames: number;
	push(chunk: Uint8Array): void;
	/** Removes and returns exactly `count` frames (caller checks `frames`). */
	take(count: number): Float32Array;
	clear(): void;
};

export const createPcmBuffer = (): PcmBuffer => {
	let chunks: Uint8Array[] = [];
	let bytes = 0;
	return {
		get frames() {
			return Math.floor(bytes / PCM_BYTES_PER_FRAME);
		},
		push(chunk) {
			chunks.push(chunk);
			bytes += chunk.length;
		},
		take(count) {
			const need = count * PCM_BYTES_PER_FRAME;
			const out = new Uint8Array(need);
			let offset = 0;
			while (offset < need) {
				const head = chunks[0] as Uint8Array;
				const part = Math.min(head.length, need - offset);
				out.set(head.subarray(0, part), offset);
				offset += part;
				if (part === head.length) chunks.shift();
				else chunks[0] = head.subarray(part);
			}
			bytes -= need;
			return new Float32Array(out.buffer, 0, count * 2);
		},
		clear() {
			chunks = [];
			bytes = 0;
		},
	};
};
