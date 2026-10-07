import type { MediaErrorInfo } from "./errors";

export interface AssetLocation {
	/** Absolute path on the host filesystem. */
	path: string;
}

export type AssetResolution =
	| { ok: true; location: AssetLocation }
	| { ok: false; error: MediaErrorInfo };

/**
 * Host-provided lookup from asset id to a local file. Stage 2 provides an
 * Electron implementation; the media service depends only on this interface.
 */
export interface AssetResolver {
	resolve(assetId: string): Promise<AssetResolution> | AssetResolution;
}

/** Asset id -> location map supplied inside a request (already resolved). */
export type AssetLocations = Record<string, AssetLocation>;
