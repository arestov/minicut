const ASSET_URI_PREFIX = "minicut-asset:";

/**
 * Resource `url` of a local asset: a registry reference, never a file path.
 * `url` is a host-local attr (not synced). Plans blank non-portable urls, so
 * export and preview resolve files by resource id through resourceAssetIndex.
 */
export const assetUriFor = (assetId: string): string =>
	`${ASSET_URI_PREFIX}${assetId}`;
