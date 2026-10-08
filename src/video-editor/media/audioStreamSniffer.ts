/**
 * Header-only detection of audio streams in a media container.
 *
 * Reads container headers through byte ranges (never the media payload), so it
 * is cheap for any file size and works the same in Node and in a browser
 * (`Blob.slice`). Supports MP4/MOV (ISO BMFF) and WebM/Matroska; anything else,
 * or a container whose track list cannot be reached within the read caps,
 * yields `null` ("unknown"), never a guess.
 */

export type ByteRangeSource = {
	/** Total size in bytes. */
	size: number;
	/** Bytes `[start, end)`; clamped to the file size by the implementation. */
	readRange(start: number, end: number): Promise<Uint8Array>;
};

export type AudioStreamsInfo = {
	audioStreams: number;
	/** Of the first audio stream, when the header carries it. */
	audioChannels: number | null;
	audioSampleRate: number | null;
};

/** The track list (`moov` / `Tracks`) is read whole, up to this size. */
const MAX_TRACK_LIST_BYTES = 16 * 1024 * 1024;
/** Upper bound of top-level elements walked to find the track list. */
const MAX_TOP_LEVEL_ELEMENTS = 256;

const ascii = (bytes: Uint8Array, at: number, length: number): string => {
	let out = "";
	for (let i = 0; i < length; i += 1) out += String.fromCharCode(bytes[at + i] ?? 0);
	return out;
};
const u16 = (b: Uint8Array, at: number) => ((b[at] ?? 0) << 8) | (b[at + 1] ?? 0);
const u32 = (b: Uint8Array, at: number) =>
	((b[at] ?? 0) * 0x1000000) + (((b[at + 1] ?? 0) << 16) | ((b[at + 2] ?? 0) << 8) | (b[at + 3] ?? 0));
const u64 = (b: Uint8Array, at: number) => u32(b, at) * 0x100000000 + u32(b, at + 4);

// ---------------------------------------------------------------- MP4 / MOV

type Mp4Box = { type: string; payloadStart: number; end: number };

/** Boxes of `bytes[start, end)`; a box that overruns `end` is clamped. */
const mp4Boxes = (bytes: Uint8Array, start: number, end: number): Mp4Box[] => {
	const boxes: Mp4Box[] = [];
	let at = start;
	while (at + 8 <= end) {
		let size = u32(bytes, at);
		const type = ascii(bytes, at + 4, 4);
		let header = 8;
		if (size === 1) {
			if (at + 16 > end) break;
			size = u64(bytes, at + 8);
			header = 16;
		} else if (size === 0) {
			size = end - at;
		}
		if (size < header) break;
		boxes.push({ type, payloadStart: at + header, end: Math.min(at + size, end) });
		at += size;
	}
	return boxes;
};

const findBox = (bytes: Uint8Array, parent: Mp4Box, type: string): Mp4Box | null =>
	mp4Boxes(bytes, parent.payloadStart, parent.end).find((box) => box.type === type) ?? null;

const mp4AudioSampleEntry = (bytes: Uint8Array, trak: Mp4Box): { channels: number | null; sampleRate: number | null } => {
	const empty = { channels: null, sampleRate: null };
	const mdia = findBox(bytes, trak, "mdia");
	const minf = mdia && findBox(bytes, mdia, "minf");
	const stbl = minf && findBox(bytes, minf, "stbl");
	const stsd = stbl && findBox(bytes, stbl, "stsd");
	if (!stsd) return empty;
	// stsd: version/flags (4), entry count (4), then sample entries.
	const entry = mp4Boxes(bytes, stsd.payloadStart + 8, stsd.end)[0];
	if (!entry || entry.payloadStart + 28 > entry.end) return empty;
	// AudioSampleEntry payload: reserved(6) dataRef(2) version(2) revision(2) vendor(4) channels(2) sampleSize(2) compression(2) packet(2) rate(16.16)
	const channels = u16(bytes, entry.payloadStart + 16);
	const sampleRate = u16(bytes, entry.payloadStart + 24);
	return { channels: channels > 0 ? channels : null, sampleRate: sampleRate > 0 ? sampleRate : null };
};

const sniffMp4 = async (source: ByteRangeSource): Promise<AudioStreamsInfo | null> => {
	let offset = 0;
	for (let i = 0; i < MAX_TOP_LEVEL_ELEMENTS && offset + 8 <= source.size; i += 1) {
		const header = await source.readRange(offset, Math.min(offset + 16, source.size));
		let size = u32(header, 0);
		const type = ascii(header, 4, 4);
		let headerSize = 8;
		if (size === 1) {
			if (header.length < 16) return null;
			size = u64(header, 8);
			headerSize = 16;
		} else if (size === 0) {
			size = source.size - offset;
		}
		if (size < headerSize) return null;
		if (type === "moov") {
			const length = Math.min(size, source.size - offset);
			if (length > MAX_TRACK_LIST_BYTES) return null;
			const bytes = await source.readRange(offset, offset + length);
			const moov: Mp4Box = { type, payloadStart: headerSize, end: bytes.length };
			let audioStreams = 0;
			let channels: number | null = null;
			let sampleRate: number | null = null;
			for (const trak of mp4Boxes(bytes, moov.payloadStart, moov.end)) {
				if (trak.type !== "trak") continue;
				const mdia = findBox(bytes, trak, "mdia");
				const hdlr = mdia && findBox(bytes, mdia, "hdlr");
				// hdlr payload: version/flags (4), pre_defined (4), handler_type (4).
				if (!hdlr || ascii(bytes, hdlr.payloadStart + 8, 4) !== "soun") continue;
				if (audioStreams === 0) ({ channels, sampleRate } = mp4AudioSampleEntry(bytes, trak));
				audioStreams += 1;
			}
			return { audioStreams, audioChannels: channels, audioSampleRate: sampleRate };
		}
		offset += size;
	}
	return null;
};

// ------------------------------------------------------------- WebM / Matroska

const ID_EBML = 0x1a45dfa3;
const ID_SEGMENT = 0x18538067;
const ID_TRACKS = 0x1654ae6b;
const ID_TRACK_ENTRY = 0xae;
const ID_TRACK_TYPE = 0x83;
const ID_AUDIO = 0xe1;
const ID_SAMPLING_FREQUENCY = 0xb5;
const ID_CHANNELS = 0x9f;
const TRACK_TYPE_AUDIO = 2;

type EbmlElement = { id: number; payloadStart: number; /** null: unknown size */ end: number | null };

/** Element header at `at`, or null when truncated/invalid. */
const ebmlHeader = (bytes: Uint8Array, at: number, limit: number): EbmlElement | null => {
	const first = bytes[at];
	if (first === undefined || first === 0) return null;
	const idLength = Math.clz32(first) - 24 + 1;
	if (idLength > 4 || at + idLength >= limit) return null;
	let id = 0;
	for (let i = 0; i < idLength; i += 1) id = id * 256 + (bytes[at + i] ?? 0);
	const sizeAt = at + idLength;
	const sizeFirst = bytes[sizeAt];
	if (sizeFirst === undefined || sizeFirst === 0) return null;
	const sizeLength = Math.clz32(sizeFirst) - 24 + 1;
	if (sizeAt + sizeLength > limit) return null;
	let size = sizeFirst & (0xff >> sizeLength);
	let allOnes = size === (0xff >> sizeLength);
	for (let i = 1; i < sizeLength; i += 1) {
		const byte = bytes[sizeAt + i] ?? 0;
		if (byte !== 0xff) allOnes = false;
		size = size * 256 + byte;
	}
	const payloadStart = sizeAt + sizeLength;
	return { id, payloadStart, end: allOnes ? null : payloadStart + size };
};

const ebmlUint = (bytes: Uint8Array, start: number, end: number): number => {
	let value = 0;
	for (let i = start; i < end; i += 1) value = value * 256 + (bytes[i] ?? 0);
	return value;
};
const ebmlFloat = (bytes: Uint8Array, start: number, end: number): number | null => {
	const length = end - start;
	if (length !== 4 && length !== 8) return null;
	const view = new DataView(bytes.buffer, bytes.byteOffset + start, length);
	return length === 4 ? view.getFloat32(0) : view.getFloat64(0);
};

const ebmlChildren = (bytes: Uint8Array, start: number, end: number): Array<EbmlElement & { end: number }> => {
	const out: Array<EbmlElement & { end: number }> = [];
	let at = start;
	while (at < end) {
		const element = ebmlHeader(bytes, at, end);
		if (!element) break;
		const elementEnd = Math.min(element.end ?? end, end);
		out.push({ ...element, end: elementEnd });
		at = elementEnd;
	}
	return out;
};

const sniffEbml = async (source: ByteRangeSource): Promise<AudioStreamsInfo | null> => {
	const head = await source.readRange(0, Math.min(64, source.size));
	const ebml = ebmlHeader(head, 0, head.length);
	if (!ebml || ebml.id !== ID_EBML || ebml.end === null) return null;
	let offset = ebml.end;
	let inSegment = false;
	for (let i = 0; i < MAX_TOP_LEVEL_ELEMENTS && offset + 2 <= source.size; i += 1) {
		const bytes = await source.readRange(offset, Math.min(offset + 16, source.size));
		const element = ebmlHeader(bytes, 0, bytes.length);
		if (!element) return null;
		if (element.id === ID_SEGMENT) {
			// Children follow immediately; an unknown-size segment simply runs on.
			inSegment = true;
			offset += element.payloadStart;
			continue;
		}
		if (!inSegment || element.end === null) return null;
		if (element.id !== ID_TRACKS) {
			offset += element.end;
			continue;
		}
		if (element.end - element.payloadStart > MAX_TRACK_LIST_BYTES) return null;
		const tracks = await source.readRange(offset + element.payloadStart, Math.min(offset + element.end, source.size));
		let audioStreams = 0;
		let channels: number | null = null;
		let sampleRate: number | null = null;
		for (const entry of ebmlChildren(tracks, 0, tracks.length)) {
			if (entry.id !== ID_TRACK_ENTRY) continue;
			const fields = ebmlChildren(tracks, entry.payloadStart, entry.end);
			const type = fields.find((field) => field.id === ID_TRACK_TYPE);
			if (!type || ebmlUint(tracks, type.payloadStart, type.end) !== TRACK_TYPE_AUDIO) continue;
			if (audioStreams === 0) {
				const audio = fields.find((field) => field.id === ID_AUDIO);
				for (const field of audio ? ebmlChildren(tracks, audio.payloadStart, audio.end) : []) {
					if (field.id === ID_CHANNELS) channels = ebmlUint(tracks, field.payloadStart, field.end) || null;
					if (field.id === ID_SAMPLING_FREQUENCY) {
						const rate = ebmlFloat(tracks, field.payloadStart, field.end);
						sampleRate = rate && rate > 0 ? Math.round(rate) : null;
					}
				}
			}
			audioStreams += 1;
		}
		return { audioStreams, audioChannels: channels, audioSampleRate: sampleRate };
	}
	return null;
};

// ------------------------------------------------------------------------ API

const MP4_TOP_LEVEL = new Set(["ftyp", "moov", "mdat", "free", "skip", "wide", "pnot"]);

/**
 * Counts the audio streams of a file from its container headers.
 * Returns null when the container is unsupported or the track list is out of reach.
 */
export const sniffAudioStreams = async (source: ByteRangeSource): Promise<AudioStreamsInfo | null> => {
	if (source.size < 12) return null;
	const head = await source.readRange(0, 12);
	if (u32(head, 0) === ID_EBML) return sniffEbml(source);
	if (MP4_TOP_LEVEL.has(ascii(head, 4, 4))) return sniffMp4(source);
	return null;
};

/** Browser adapter: a `Blob`/`File` read through `slice`. */
export const byteRangeSourceFromBlob = (blob: Blob): ByteRangeSource => ({
	size: blob.size,
	readRange: async (start, end) => new Uint8Array(await blob.slice(start, end).arrayBuffer()),
});
