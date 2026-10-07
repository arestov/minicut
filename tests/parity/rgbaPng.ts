import { deflateSync } from "node:zlib";

const CRC_TABLE = (() => {
	const table = new Uint32Array(256);
	for (let n = 0; n < 256; n += 1) {
		let c = n;
		for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
		table[n] = c >>> 0;
	}
	return table;
})();

const crc32 = (bytes: Uint8Array): number => {
	let crc = 0xffffffff;
	for (const byte of bytes) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
	return (crc ^ 0xffffffff) >>> 0;
};

const chunk = (type: string, data: Uint8Array): Buffer => {
	const body = Buffer.concat([Buffer.from(type, "ascii"), Buffer.from(data)]);
	const out = Buffer.alloc(body.length + 8);
	out.writeUInt32BE(data.length, 0);
	body.copy(out, 4);
	out.writeUInt32BE(crc32(body), body.length + 4);
	return out;
};

/** Encodes straight-alpha RGBA pixels (tight rows) as an 8-bit RGBA PNG. */
export const encodeRgbaPng = (width: number, height: number, pixels: Uint8Array): Buffer => {
	if (pixels.length < width * height * 4) throw new Error("pixel buffer is smaller than width * height * 4");
	const header = Buffer.alloc(13);
	header.writeUInt32BE(width, 0);
	header.writeUInt32BE(height, 4);
	header[8] = 8; // bit depth
	header[9] = 6; // RGBA
	const rowBytes = width * 4;
	const raw = Buffer.alloc((rowBytes + 1) * height);
	for (let y = 0; y < height; y += 1) {
		raw[y * (rowBytes + 1)] = 0; // filter: none
		Buffer.from(pixels.buffer, pixels.byteOffset + y * rowBytes, rowBytes).copy(raw, y * (rowBytes + 1) + 1);
	}
	return Buffer.concat([
		Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
		chunk("IHDR", header),
		chunk("IDAT", deflateSync(raw)),
		chunk("IEND", new Uint8Array(0)),
	]);
};
