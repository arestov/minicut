import path from "node:path";
import { mediaContentTypeForPath, serveFile } from "./fileResponse";
import type { HostAssetRegistry } from "./assetRegistry";
import {
	MINICUT_PROTOCOL_HOST,
	MINICUT_PROTOCOL_SCHEME,
} from "../shared/ipcChannels";

export type MiniCutProtocolHandlerOptions = {
	assets: Pick<HostAssetRegistry, "resolve">;
	/** Directory of the built renderer; served under `/app/`. */
	rendererDir: string;
};

/**
 * Content security policy of the renderer bundle. Beyond the basics the app
 * needs: inline styles (React style attributes), blob: workers and media
 * (preview canvas worker, object URLs for project copies and exports),
 * blob: fetches (export download check) and wasm compilation.
 */
export const RENDERER_CONTENT_SECURITY_POLICY = [
	"default-src 'self'",
	"script-src 'self' 'wasm-unsafe-eval'",
	"style-src 'self' 'unsafe-inline'",
	"img-src 'self' data: blob:",
	"media-src 'self' blob:",
	"font-src 'self' data:",
	"worker-src 'self' blob:",
	"connect-src 'self' blob:",
	"object-src 'none'",
	"base-uri 'self'",
	"frame-ancestors 'none'",
].join("; ");

const notFound = (): Response => new Response(null, { status: 404 });

/**
 * Handler of `minicut://local/...`:
 *   /app/<file>     the renderer bundle (confined to rendererDir)
 *   /asset/<id>     a registered local media file, with HTTP Range support
 */
export const createMiniCutProtocolHandler = ({
	assets,
	rendererDir,
}: MiniCutProtocolHandlerOptions) => {
	const rootDir = path.resolve(rendererDir);
	return async (request: Request): Promise<Response> => {
		let url: URL;
		try {
			url = new URL(request.url);
		} catch {
			return notFound();
		}
		if (
			url.protocol !== `${MINICUT_PROTOCOL_SCHEME}:` ||
			url.hostname !== MINICUT_PROTOCOL_HOST
		) {
			return notFound();
		}

		if (url.pathname.startsWith("/asset/")) {
			let assetId: string;
			try {
				assetId = decodeURIComponent(url.pathname.slice("/asset/".length));
			} catch {
				return notFound();
			}
			const filePath = assets.resolve(assetId);
			// Only media is served, whatever the registry holds.
			if (!filePath || !mediaContentTypeForPath(filePath)) {
				return notFound();
			}
			return serveFile({
				filePath,
				request,
				extraHeaders: {
					"Cache-Control": "no-store",
					"X-Content-Type-Options": "nosniff",
					// A media file opened as a document cannot run anything.
					"Content-Security-Policy": "sandbox",
				},
			});
		}

		if (url.pathname === "/app" || url.pathname.startsWith("/app/")) {
			let relative: string;
			try {
				relative = decodeURIComponent(url.pathname.slice("/app/".length));
			} catch {
				return notFound();
			}
			const filePath = path.resolve(rootDir, relative || "index.html");
			if (filePath !== rootDir && !filePath.startsWith(rootDir + path.sep)) {
				return notFound();
			}
			return serveFile({
				filePath,
				request,
				extraHeaders: {
					"Content-Security-Policy": RENDERER_CONTENT_SECURITY_POLICY,
					"X-Content-Type-Options": "nosniff",
				},
			});
		}

		return notFound();
	};
};
