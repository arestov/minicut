export type MediaErrorCode =
	| "binary-not-found"
	| "asset-not-found"
	| "asset-unreadable"
	| "invalid-request"
	| "unsupported-operation"
	| "unsupported-format"
	| "probe-failed"
	| "process-failed"
	| "process-timeout"
	| "output-failed"
	| "cancelled";

/** Serializable error shape carried by job events and results. */
export interface MediaErrorInfo {
	code: MediaErrorCode;
	message: string;
	/** Machine-readable extras, e.g. unsupported operation names, exit code. */
	details?: Record<string, unknown>;
}
