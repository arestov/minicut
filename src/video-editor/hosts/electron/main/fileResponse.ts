import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";

const CONTENT_TYPES: Record<string, string> = {
	".html": "text/html; charset=utf-8",
	".js": "text/javascript; charset=utf-8",
	".mjs": "text/javascript; charset=utf-8",
	".css": "text/css; charset=utf-8",
	".json": "application/json; charset=utf-8",
	".map": "application/json; charset=utf-8",
	".txt": "text/plain; charset=utf-8",
	".svg": "image/svg+xml",
	".png": "image/png",
	".jpg": "image/jpeg",
	".jpeg": "image/jpeg",
	".gif": "image/gif",
	".webp": "image/webp",
	".ico": "image/x-icon",
	".woff": "font/woff",
	".woff2": "font/woff2",
	".wasm": "application/wasm",
	".mp4": "video/mp4",
	".m4v": "video/mp4",
	".mov": "video/quicktime",
	".webm": "video/webm",
	".mkv": "video/x-matroska",
	".mp3": "audio/mpeg",
	".m4a": "audio/mp4",
	".aac": "audio/aac",
	".wav": "audio/wav",
	".ogg": "audio/ogg",
	".flac": "audio/flac",
};

export const contentTypeForPath = (filePath: string): string =>
	CONTENT_TYPES[path.extname(filePath).toLowerCase()] ??
	"application/octet-stream";

/**
 * Content type of a file the asset protocol may serve: video, audio or
 * raster image (never svg, which can carry script). Null for anything else.
 */
export const mediaContentTypeForPath = (filePath: string): string | null => {
	const type = CONTENT_TYPES[path.extname(filePath).toLowerCase()];
	return type && /^(video|audio|image)\//.test(type) && !type.startsWith("image/svg")
		? type
		: null;
};

export type ByteRange = { start: number; end: number };

/**
 * Parses a single `bytes=` range against a file size.
 * Returns null when the header is absent or not a single byte range (the
 * caller then serves the whole file) and "unsatisfiable" for a range that
 * cannot be served.
 */
export const parseRangeHeader = (
	header: string | null,
	size: number,
): ByteRange | "unsatisfiable" | null => {
	if (!header) {
		return null;
	}
	const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
	if (!match) {
		return null;
	}
	const [, rawStart, rawEnd] = match;
	if (rawStart === "" && rawEnd === "") {
		return "unsatisfiable";
	}
	if (rawStart === "") {
		const suffix = Number(rawEnd);
		if (suffix === 0 || size === 0) {
			return "unsatisfiable";
		}
		return { start: Math.max(0, size - suffix), end: size - 1 };
	}
	const start = Number(rawStart);
	const end = rawEnd === "" ? size - 1 : Math.min(Number(rawEnd), size - 1);
	if (start >= size || start > end) {
		return "unsatisfiable";
	}
	return { start, end };
};

export type ServeFileOptions = {
	filePath: string;
	request: Request;
	extraHeaders?: Record<string, string>;
};

/**
 * Serves a local file as a fetch Response with HTTP Range support, so a
 * `<video>` element can seek without reading the whole file.
 */
export const serveFile = async ({
	filePath,
	request,
	extraHeaders,
}: ServeFileOptions): Promise<Response> => {
	if (request.method !== "GET" && request.method !== "HEAD") {
		return new Response(null, {
			status: 405,
			headers: { Allow: "GET, HEAD" },
		});
	}
	let size: number;
	try {
		const info = await stat(filePath);
		if (!info.isFile()) {
			return new Response(null, { status: 404 });
		}
		size = info.size;
	} catch {
		return new Response(null, { status: 404 });
	}

	const headers: Record<string, string> = {
		"Content-Type": contentTypeForPath(filePath),
		"Accept-Ranges": "bytes",
		...extraHeaders,
	};
	const range = parseRangeHeader(request.headers.get("range"), size);
	if (range === "unsatisfiable") {
		return new Response(null, {
			status: 416,
			headers: { ...headers, "Content-Range": `bytes */${size}` },
		});
	}

	const start = range?.start ?? 0;
	const end = range?.end ?? size - 1;
	const length = size === 0 ? 0 : end - start + 1;
	headers["Content-Length"] = String(length);
	if (range) {
		headers["Content-Range"] = `bytes ${start}-${end}/${size}`;
	}
	const status = range ? 206 : 200;
	if (request.method === "HEAD" || length === 0) {
		return new Response(null, { status, headers });
	}
	const body = Readable.toWeb(
		createReadStream(filePath, { start, end }),
	) as ReadableStream<Uint8Array>;
	return new Response(body, { status, headers });
};
