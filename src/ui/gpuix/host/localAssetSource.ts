/**
 * Resource source as the model declares it in effect and plan payloads
 * (`clipSources[].resourceSource`, recovery requests). The host registry id of
 * a local file is the `sourceRef` of a `local-asset` resource.
 */
export type PayloadResourceSource = {
	sourceKind?: unknown;
	sourceRef?: unknown;
	contentFingerprint?: unknown;
	fingerprintVersion?: unknown;
} | null | undefined;

/** Asset id of the local file behind the source, or null when it is not a local asset. */
export const localAssetIdOf = (source: PayloadResourceSource): string | null =>
	source?.sourceKind === "local-asset" &&
	typeof source.sourceRef === "string" &&
	source.sourceRef
		? source.sourceRef
		: null;

/** Content key (fingerprint version + fingerprint) of the source file, or null when unknown. */
export const contentKeyOf = (source: PayloadResourceSource): string | null =>
	typeof source?.contentFingerprint === "string" &&
	source.contentFingerprint &&
	typeof source.fingerprintVersion === "string"
		? `${source.fingerprintVersion}:${source.contentFingerprint}`
		: null;
