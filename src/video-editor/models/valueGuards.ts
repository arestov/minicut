export const objectOr = <Value>(
	value: unknown,
	fallback: Value,
): Value => (value && typeof value === "object" ? (value as Value) : fallback);

export const objectOrNull = <Value extends object>(
	value: unknown,
): Value | null => (value && typeof value === "object" ? (value as Value) : null);

export const stringOr = (value: unknown, fallback: string): string =>
	typeof value === "string" ? value : fallback;

export const finiteNumberOr = (value: unknown, fallback: number): number =>
	typeof value === "number" && Number.isFinite(value) ? value : fallback;

export const finiteNumberOrUndefined = (
	value: unknown,
): number | undefined =>
	typeof value === "number" && Number.isFinite(value) ? value : undefined;

export const numberOr = (value: unknown, fallback: number): number =>
	typeof value === "number" ? value : fallback;

export const numberOrNull = (value: unknown): number | null =>
	typeof value === "number" ? value : null;
