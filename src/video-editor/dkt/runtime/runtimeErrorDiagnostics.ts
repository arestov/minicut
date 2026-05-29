export type SerializedRuntimeError = {
	name: string;
	message: string;
	stack?: string;
	cause?: unknown;
	phase?: string;
	context?: Record<string, unknown>;
};

const serializeCause = (cause: unknown): unknown => {
	if (!cause || typeof cause !== "object") {
		return cause;
	}
	return {
		name:
			typeof (cause as { name?: unknown }).name === "string"
				? (cause as { name: string }).name
				: cause.constructor?.name ?? "Error",
		message:
			typeof (cause as { message?: unknown }).message === "string"
				? (cause as { message: string }).message
				: String(cause),
	};
};

export const serializeRuntimeError = (
	error: unknown,
	phase?: string,
	context?: Record<string, unknown>,
): SerializedRuntimeError => {
	if (
		error instanceof Error ||
		(typeof DOMException !== "undefined" && error instanceof DOMException)
	) {
		return {
			name: error.name || error.constructor.name || "Error",
			message: error.message || String(error),
			...(error.stack ? { stack: error.stack } : null),
			...("cause" in error ? { cause: serializeCause(error.cause) } : null),
			...(phase ? { phase } : null),
			...(context ? { context } : null),
		};
	}
	return {
		name: "NonError",
		message: String(error),
		...(phase ? { phase } : null),
		...(context ? { context } : null),
	};
};

export const formatRuntimeErrorForConsole = (
	error: SerializedRuntimeError | unknown,
): string => {
	if (
		error &&
		typeof error === "object" &&
		typeof (error as SerializedRuntimeError).message === "string"
	) {
		const serialized = error as SerializedRuntimeError;
		const phase = serialized.phase ? `[${serialized.phase}] ` : "";
		const name = serialized.name ? `${serialized.name}: ` : "";
		return `${phase}${name}${serialized.message}${
			serialized.stack ? `\n${serialized.stack}` : ""
		}`;
	}
	return String(error);
};
