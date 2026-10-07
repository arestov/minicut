import { randomUUID } from "node:crypto";
import { statSync } from "node:fs";
import path from "node:path";
import { mediaContentTypeForPath } from "./fileResponse";

export type HostAssetRegistration =
	| { ok: true; assetId: string; name: string; size: number }
	| { ok: false; reason: string };

export type HostAssetRegistry = {
	/**
	 * Registers a local media file for an owner (a webContents id).
	 * Synchronous on purpose: the renderer needs the asset URL where it
	 * previously called `URL.createObjectURL`.
	 */
	register(filePath: unknown, ownerId: number): HostAssetRegistration;
	/** Path behind an asset id; paths never enter the DKT graph. */
	resolve(assetId: string): string | null;
	/** Releases an asset; only its owner may. */
	release(assetId: string, ownerId: number): boolean;
	/** Releases everything an owner registered (window destroyed or reloaded). */
	releaseOwner(ownerId: number): number;
	size(): number;
};

export type CreateHostAssetRegistryOptions = {
	generateId?: () => string;
};

/** UNC (`\\host\share`), device (`\\?\`, `\\.\`) and `//` network paths. */
const isNetworkOrDevicePath = (filePath: string): boolean =>
	filePath.startsWith("\\\\") || filePath.startsWith("//");

/**
 * Host asset registry of the Electron main process: asset id -> local media
 * file. It is process memory only (not persisted, not synced); only the
 * asset id and serializable metadata are meant to leave it.
 *
 * Only absolute local video, audio and raster image files are accepted.
 * Ids are random UUIDs. Electron protocol handlers do not say which window
 * is asking, so ownership limits who can release an id and ties its
 * lifetime to the window; it cannot restrict who may fetch a known id.
 */
export const createHostAssetRegistry = ({
	generateId = randomUUID,
}: CreateHostAssetRegistryOptions = {}): HostAssetRegistry => {
	const entries = new Map<string, { path: string; ownerId: number }>();
	return {
		register(filePath, ownerId) {
			if (typeof filePath !== "string" || !path.isAbsolute(filePath)) {
				return { ok: false, reason: "asset path must be an absolute path" };
			}
			if (isNetworkOrDevicePath(filePath)) {
				return { ok: false, reason: "asset path must be a local drive path" };
			}
			if (!mediaContentTypeForPath(filePath)) {
				return { ok: false, reason: "asset must be a video, audio or image file" };
			}
			let size: number;
			try {
				const info = statSync(filePath);
				if (!info.isFile()) {
					return { ok: false, reason: "asset path is not a file" };
				}
				size = info.size;
			} catch {
				return { ok: false, reason: "asset file is not readable" };
			}
			const assetId = generateId();
			entries.set(assetId, { path: filePath, ownerId });
			return { ok: true, assetId, name: path.basename(filePath), size };
		},
		resolve: (assetId) => entries.get(assetId)?.path ?? null,
		release(assetId, ownerId) {
			return entries.get(assetId)?.ownerId === ownerId ? entries.delete(assetId) : false;
		},
		releaseOwner(ownerId) {
			let released = 0;
			for (const [assetId, entry] of [...entries]) {
				if (entry.ownerId === ownerId) {
					entries.delete(assetId);
					released += 1;
				}
			}
			return released;
		},
		size: () => entries.size,
	};
};
