import type { ExportPlan } from "../../render/renderPlan";
import type { ExportRange } from "../../render/exportTypes";
import type { AssetLocations } from "./assets";

export type MediaExportFormat = "webm" | "mp4";

export interface MediaExportRequest {
	requestId: string;
	plan: ExportPlan;
	range: ExportRange;
	/** Default "webm". */
	format?: MediaExportFormat;
	/** Final output file; written atomically (temp file + rename). */
	outputPath: string;
	/** Overrides plan.fps when set. */
	fps?: number;
	/** Overrides plan size when set. */
	width?: number;
	height?: number;
	/**
	 * Resolved file locations by clip resourceId. Ids missing here are looked up
	 * through the service's AssetResolver.
	 */
	assets?: AssetLocations;
}
