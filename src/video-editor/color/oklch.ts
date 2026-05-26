export interface RgbColor {
	r: number;
	g: number;
	b: number;
}

export interface OklchValue {
	l: number;
	c: number;
	h: number;
}

export interface ContrastResult {
	ratio: number;
	status: "readable" | "low" | "unsafe";
}

const clamp = (value: number, min: number, max: number): number =>
	Math.min(max, Math.max(min, value));
const round = (value: number, precision = 4): number =>
	Number(value.toFixed(precision));

const srgbToLinear = (value: number): number => {
	const normalized = clamp(value, 0, 255) / 255;
	return normalized <= 0.04045
		? normalized / 12.92
		: ((normalized + 0.055) / 1.055) ** 2.4;
};

const linearToSrgb = (value: number): number => {
	const normalized =
		value <= 0.0031308 ? value * 12.92 : 1.055 * value ** (1 / 2.4) - 0.055;
	return Math.round(clamp(normalized, 0, 1) * 255);
};

export const parseHexColor = (value: string): RgbColor | null => {
	const normalized = value.trim().replace(/^#/, "");
	if (/^[0-9a-fA-F]{3}$/.test(normalized)) {
		return {
			r: Number.parseInt(normalized[0] + normalized[0], 16),
			g: Number.parseInt(normalized[1] + normalized[1], 16),
			b: Number.parseInt(normalized[2] + normalized[2], 16),
		};
	}
	if (/^[0-9a-fA-F]{6}$/.test(normalized)) {
		return {
			r: Number.parseInt(normalized.slice(0, 2), 16),
			g: Number.parseInt(normalized.slice(2, 4), 16),
			b: Number.parseInt(normalized.slice(4, 6), 16),
		};
	}
	return null;
};

export const rgbToHex = ({ r, g, b }: RgbColor): string => {
	const toHex = (channel: number) =>
		clamp(Math.round(channel), 0, 255).toString(16).padStart(2, "0");
	return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
};

export const rgbToOklch = (rgb: RgbColor): OklchValue => {
	const red = srgbToLinear(rgb.r);
	const green = srgbToLinear(rgb.g);
	const blue = srgbToLinear(rgb.b);

	const l = Math.cbrt(
		0.4122214708 * red + 0.5363325363 * green + 0.0514459929 * blue,
	);
	const m = Math.cbrt(
		0.2119034982 * red + 0.6806995451 * green + 0.1073969566 * blue,
	);
	const s = Math.cbrt(
		0.0883024619 * red + 0.2817188376 * green + 0.6299787005 * blue,
	);

	const okL = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
	const okA = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
	const okB = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
	const chroma = Math.sqrt(okA * okA + okB * okB);
	const hue =
		chroma < 0.00001 ? 0 : ((Math.atan2(okB, okA) * 180) / Math.PI + 360) % 360;

	return { l: round(okL), c: round(chroma), h: round(hue, 2) };
};

const oklchToRgbRaw = ({
	l,
	c,
	h,
}: OklchValue): { r: number; g: number; b: number } => {
	const hueRadians = (h * Math.PI) / 180;
	const a = Math.cos(hueRadians) * c;
	const b = Math.sin(hueRadians) * c;

	const lPrime = l + 0.3963377774 * a + 0.2158037573 * b;
	const mPrime = l - 0.1055613458 * a - 0.0638541728 * b;
	const sPrime = l - 0.0894841775 * a - 1.291485548 * b;

	const l3 = lPrime ** 3;
	const m3 = mPrime ** 3;
	const s3 = sPrime ** 3;

	return {
		r: 4.0767416621 * l3 - 3.3077115913 * m3 + 0.2309699292 * s3,
		g: -1.2684380046 * l3 + 2.6097574011 * m3 - 0.3413193965 * s3,
		b: -0.0041960863 * l3 - 0.7034186147 * m3 + 1.707614701 * s3,
	};
};

export const isOklchInSrgbGamut = (value: OklchValue): boolean => {
	const rgb = oklchToRgbRaw(value);
	const epsilon = 0.001;
	return (
		rgb.r >= -epsilon &&
		rgb.r <= 1 + epsilon &&
		rgb.g >= -epsilon &&
		rgb.g <= 1 + epsilon &&
		rgb.b >= -epsilon &&
		rgb.b <= 1 + epsilon
	);
};

export const fitOklchToSrgb = (value: OklchValue): OklchValue => {
	let fitted = {
		l: clamp(value.l, 0, 1),
		c: Math.max(0, value.c),
		h: ((value.h % 360) + 360) % 360,
	};
	if (isOklchInSrgbGamut(fitted)) {
		return { l: round(fitted.l), c: round(fitted.c), h: round(fitted.h, 2) };
	}
	let low = 0;
	let high = fitted.c;
	for (let index = 0; index < 24; index += 1) {
		const mid = (low + high) / 2;
		const candidate = { ...fitted, c: mid };
		if (isOklchInSrgbGamut(candidate)) {
			low = mid;
		} else {
			high = mid;
		}
	}
	fitted = { ...fitted, c: Math.max(0, low - 0.001) };
	return { l: round(fitted.l), c: round(fitted.c), h: round(fitted.h, 2) };
};

export const oklchToRgb = (value: OklchValue): RgbColor => {
	const raw = oklchToRgbRaw(fitOklchToSrgb(value));
	return {
		r: linearToSrgb(raw.r),
		g: linearToSrgb(raw.g),
		b: linearToSrgb(raw.b),
	};
};

export const oklchToHex = (value: OklchValue): string =>
	rgbToHex(oklchToRgb(value));

export const hexToOklch = (value: string): OklchValue | null => {
	const rgb = parseHexColor(value);
	return rgb ? rgbToOklch(rgb) : null;
};

const relativeLuminance = (rgb: RgbColor): number =>
	0.2126 * srgbToLinear(rgb.r) +
	0.7152 * srgbToLinear(rgb.g) +
	0.0722 * srgbToLinear(rgb.b);

export const getContrastRatio = (
	foreground: string,
	background: string,
): number => {
	const fg = parseHexColor(foreground);
	const bg = parseHexColor(background);
	if (!fg || !bg) {
		return 1;
	}
	const lighter = Math.max(relativeLuminance(fg), relativeLuminance(bg));
	const darker = Math.min(relativeLuminance(fg), relativeLuminance(bg));
	return (lighter + 0.05) / (darker + 0.05);
};

export const getContrastResult = (
	foreground: string,
	background: string,
): ContrastResult => {
	const ratio = getContrastRatio(foreground, background);
	return {
		ratio: round(ratio, 2),
		status: ratio >= 4.5 ? "readable" : ratio >= 3 ? "low" : "unsafe",
	};
};

export const suggestReadableTextColor = (
	foreground: string,
	background: string,
): string => {
	const fgOklch = hexToOklch(foreground);
	const bgOklch = hexToOklch(background);
	if (!fgOklch || !bgOklch) {
		return getContrastRatio("#ffffff", background) >=
			getContrastRatio("#000000", background)
			? "#ffffff"
			: "#000000";
	}

	const shouldLighten = bgOklch.l < 0.52;
	for (let step = 0; step <= 20; step += 1) {
		const l = shouldLighten
			? clamp(fgOklch.l + step * 0.035, 0, 1)
			: clamp(fgOklch.l - step * 0.035, 0, 1);
		const candidate = oklchToHex(fitOklchToSrgb({ ...fgOklch, l }));
		if (getContrastRatio(candidate, background) >= 4.5) {
			return candidate;
		}
	}

	return getContrastRatio("#ffffff", background) >=
		getContrastRatio("#000000", background)
		? "#ffffff"
		: "#000000";
};
