interface LookThumbnailRequest {
	type: "render-look-thumbnails";
	width: number;
	height: number;
	pixels: Uint8ClampedArray;
	looks: Array<{
		id: string;
		params: {
			exposure: number;
			contrast: number;
			saturation: number;
			temperature: number;
			hue: number;
			gamma: number;
		};
	}>;
}

interface LookThumbnailResponse {
	type: "look-thumbnails-rendered";
	thumbnails: Record<string, string>;
}

const clamp = (value: number, min = 0, max = 255): number =>
	Math.min(max, Math.max(min, value));

const applySaturation = (
	red: number,
	green: number,
	blue: number,
	saturation: number,
): [number, number, number] => {
	const luminance = 0.2126 * red + 0.7152 * green + 0.0722 * blue;
	return [
		luminance + (red - luminance) * saturation,
		luminance + (green - luminance) * saturation,
		luminance + (blue - luminance) * saturation,
	];
};

const applySepia = (
	red: number,
	green: number,
	blue: number,
	amount: number,
): [number, number, number] => {
	const sepiaRed = red * 0.393 + green * 0.769 + blue * 0.189;
	const sepiaGreen = red * 0.349 + green * 0.686 + blue * 0.168;
	const sepiaBlue = red * 0.272 + green * 0.534 + blue * 0.131;
	return [
		red + (sepiaRed - red) * amount,
		green + (sepiaGreen - green) * amount,
		blue + (sepiaBlue - blue) * amount,
	];
};

const applyHueRotate = (
	red: number,
	green: number,
	blue: number,
	degrees: number,
): [number, number, number] => {
	const angle = (degrees * Math.PI) / 180;
	const cos = Math.cos(angle);
	const sin = Math.sin(angle);
	return [
		red * (0.213 + cos * 0.787 - sin * 0.213) +
			green * (0.715 - cos * 0.715 - sin * 0.715) +
			blue * (0.072 - cos * 0.072 + sin * 0.928),
		red * (0.213 - cos * 0.213 + sin * 0.143) +
			green * (0.715 + cos * 0.285 + sin * 0.14) +
			blue * (0.072 - cos * 0.072 - sin * 0.283),
		red * (0.213 - cos * 0.213 - sin * 0.787) +
			green * (0.715 - cos * 0.715 + sin * 0.715) +
			blue * (0.072 + cos * 0.928 + sin * 0.072),
	];
};

const transformPixel = (
	red: number,
	green: number,
	blue: number,
	params: LookThumbnailRequest["looks"][number]["params"],
): [number, number, number] => {
	const brightness = 1 + params.exposure;
	const contrast = params.contrast * params.gamma;
	const saturation = params.saturation + Math.max(0, params.temperature) * 0.08;
	const sepia = Math.max(0, params.temperature) * 0.25;
	const hue = params.hue + Math.min(0, params.temperature) * 18;
	let nextRed = (red * brightness - 128) * contrast + 128;
	let nextGreen = (green * brightness - 128) * contrast + 128;
	let nextBlue = (blue * brightness - 128) * contrast + 128;
	[nextRed, nextGreen, nextBlue] = applySaturation(
		nextRed,
		nextGreen,
		nextBlue,
		saturation,
	);
	[nextRed, nextGreen, nextBlue] = applySepia(
		nextRed,
		nextGreen,
		nextBlue,
		sepia,
	);
	[nextRed, nextGreen, nextBlue] = applyHueRotate(
		nextRed,
		nextGreen,
		nextBlue,
		hue,
	);
	return [clamp(nextRed), clamp(nextGreen), clamp(nextBlue)];
};

const svgThumbnail = (
	message: LookThumbnailRequest,
	params: LookThumbnailRequest["looks"][number]["params"],
): string => {
	const columns = 12;
	const rows = Math.max(
		1,
		Math.round((columns * message.height) / message.width),
	);
	const cellWidth = 96 / columns;
	const cellHeight = 54 / rows;
	const rects: string[] = [];
	for (let row = 0; row < rows; row += 1) {
		for (let column = 0; column < columns; column += 1) {
			const x = Math.min(
				message.width - 1,
				Math.floor((column * message.width) / columns),
			);
			const y = Math.min(
				message.height - 1,
				Math.floor((row * message.height) / rows),
			);
			const offset = (y * message.width + x) * 4;
			const [red, green, blue] = transformPixel(
				message.pixels[offset],
				message.pixels[offset + 1],
				message.pixels[offset + 2],
				params,
			);
			rects.push(
				`<rect x="${(column * cellWidth).toFixed(2)}" y="${(row * cellHeight).toFixed(2)}" width="${cellWidth.toFixed(2)}" height="${cellHeight.toFixed(2)}" fill="rgb(${Math.round(red)},${Math.round(green)},${Math.round(blue)})"/>`,
			);
		}
	}
	return `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="96" height="54" viewBox="0 0 96 54">${rects.join("")}</svg>`)}`;
};

self.onmessage = (event: MessageEvent<LookThumbnailRequest>) => {
	const message = event.data;
	if (message.type !== "render-look-thumbnails") {
		return;
	}
	const thumbnails = Object.fromEntries(
		message.looks.map((look) => [
			look.id,
			`url("${svgThumbnail(message, look.params)}")`,
		]),
	);
	const response: LookThumbnailResponse = {
		type: "look-thumbnails-rendered",
		thumbnails,
	};
	self.postMessage(response);
};
