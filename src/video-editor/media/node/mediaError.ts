import type { MediaErrorCode, MediaErrorInfo } from "../contracts/errors";

export class MediaError extends Error {
	readonly code: MediaErrorCode;
	readonly details?: Record<string, unknown>;

	constructor(
		code: MediaErrorCode,
		message: string,
		details?: Record<string, unknown>,
	) {
		super(message);
		this.name = "MediaError";
		this.code = code;
		this.details = details;
	}

	toInfo(): MediaErrorInfo {
		return {
			code: this.code,
			message: this.message,
			...(this.details ? { details: this.details } : {}),
		};
	}
}

export const toMediaErrorInfo = (error: unknown): MediaErrorInfo =>
	error instanceof MediaError
		? error.toInfo()
		: {
				code: "process-failed",
				message: error instanceof Error ? error.message : String(error),
			};
