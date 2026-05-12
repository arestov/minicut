import { defaultClipTransform } from "../Clip/actions";
import { defaultTextBox, defaultTextStyle } from "../Text/defaults";
import { numberOr, numberOrNull, objectOr, stringOr } from "../valueGuards";

export const reduceCreateProjectModel = (payload: unknown) => {
	const value = payload as {
		title?: unknown;
		fps?: unknown;
		width?: unknown;
		height?: unknown;
		duration?: unknown;
		createdAt?: unknown;
		updatedAt?: unknown;
		tracks?: unknown;
		autoCreateDefaultTracks?: unknown;
	} | null;

	const tracks = Array.isArray(value?.tracks)
		? value.tracks
				.map((track) => {
					const item = track as {
						kind?: unknown;
						name?: unknown;
						muted?: unknown;
						locked?: unknown;
						height?: unknown;
					} | null;
					if (!item || typeof item !== "object") {
						return null;
					}
					return {
						attrs: {
							kind: item.kind === "audio" ? "audio" : "video",
							name: stringOr(item.name, "Track"),
							muted: item.muted === true,
							locked: item.locked === true,
							height: numberOr(item.height, 84),
						},
					};
				})
				.filter(
					(
						track,
					): track is {
						attrs: {
							kind: "audio" | "video";
							name: string;
							muted: boolean;
							locked: boolean;
							height: number;
						};
					} => Boolean(track),
				)
		: [];

	return {
		attrs: {
			title: stringOr(value?.title, "Untitled project"),
			fps: numberOr(value?.fps, 30),
			width: numberOr(value?.width, 1920),
			height: numberOr(value?.height, 1080),
			duration: numberOr(value?.duration, 0),
			createdAt: numberOr(value?.createdAt, 0),
			updatedAt: numberOr(value?.updatedAt, 0),
			autoCreateDefaultTracks: value?.autoCreateDefaultTracks === true,
		},
		rels: tracks.length > 0 ? { tracks } : undefined,
	};
};

export const reduceCreateTrackModel = (payload: unknown) => {
	const value = payload as {
		kind?: unknown;
		name?: unknown;
		muted?: unknown;
		locked?: unknown;
		height?: unknown;
	} | null;
	return {
		attrs: {
			kind: value?.kind === "audio" ? "audio" : "video",
			name: stringOr(value?.name, "Track"),
			muted: value?.muted === true,
			locked: value?.locked === true,
			height: numberOr(value?.height, 84),
		},
	};
};

export const reduceCreateResourceModel = (payload: unknown) => {
	const value = payload as {
		name?: unknown;
		kind?: unknown;
		url?: unknown;
		mime?: unknown;
		duration?: unknown;
		width?: unknown;
		height?: unknown;
		size?: unknown;
		source?: unknown;
		status?: unknown;
		data?: unknown;
	} | null;

	return {
		attrs: {
			name: stringOr(value?.name, "Resource"),
			kind: stringOr(value?.kind, "video"),
			url: stringOr(value?.url, ""),
			mime: stringOr(value?.mime, "application/octet-stream"),
			duration: numberOr(value?.duration, 0),
			width: numberOrNull(value?.width),
			height: numberOrNull(value?.height),
			size: numberOrNull(value?.size),
			source: objectOr(value?.source, { kind: "local" }),
			status: stringOr(value?.status, "missing"),
			data: objectOr(value?.data, null),
		},
	};
};

export const reduceCreateTextModel = (payload: unknown) => {
	const value = payload as {
		content?: unknown;
		style?: unknown;
		box?: unknown;
	} | null;
	return {
		attrs: {
			content: stringOr(value?.content, "Text"),
			style: objectOr(value?.style, defaultTextStyle),
			box: objectOr(value?.box, defaultTextBox),
		},
	};
};

export const reduceCreateEffectModel = (payload: unknown) => {
	const value = payload as {
		name?: unknown;
		kind?: unknown;
		enabled?: unknown;
		amount?: unknown;
		params?: unknown;
		color?: unknown;
	} | null;
	return {
		attrs: {
			name: stringOr(value?.name, "Effect"),
			kind: stringOr(value?.kind, "blur"),
			enabled: typeof value?.enabled === "boolean" ? value.enabled : true,
			amount: numberOrNull(value?.amount),
			params: objectOr(value?.params, null),
			color: objectOr(value?.color, null),
		},
	};
};

export const reduceCreateClipModel = (payload: unknown) => {
	const value = payload as {
		name?: unknown;
		color?: unknown;
		mediaKind?: unknown;
		start?: unknown;
		in?: unknown;
		duration?: unknown;
		fadeIn?: unknown;
		fadeOut?: unknown;
		audio?: unknown;
		opacity?: unknown;
		transform?: unknown;
	} | null;

	return {
		attrs: {
			name: stringOr(value?.name, "Clip"),
			color: stringOr(value?.color, "#2563eb"),
			mediaKind: stringOr(value?.mediaKind, "") || null,
			start: numberOr(value?.start, 0),
			in: numberOr(value?.in, 0),
			duration: numberOr(value?.duration, 0),
			fadeIn: numberOr(value?.fadeIn, 0),
			fadeOut: numberOr(value?.fadeOut, 0),
			audio: objectOr(value?.audio, { gain: 1, pan: 0 }),
			opacity: objectOr(value?.opacity, { value: 1 }),
			transform: objectOr(value?.transform, defaultClipTransform),
		},
	};
};

export const reduceSetActiveProjectHint = (payload: unknown) => ({
	activeProjectHint: typeof payload === "string" && payload ? payload : null,
});
