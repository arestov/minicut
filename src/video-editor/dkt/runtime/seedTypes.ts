export type MiniCutDktProjectSeed = {
	title?: string;
	fps?: number;
	width?: number;
	height?: number;
	duration?: number;
	createdAt?: number;
	updatedAt?: number;
	tracks?: MiniCutDktTrackSeed[];
	autoCreateDefaultTracks?: boolean;
};

export type MiniCutDktTrackSeed = {
	kind?: "video" | "audio";
	name?: string;
	muted?: boolean;
	locked?: boolean;
	height?: number;
};

export type MiniCutDktResourceSeed = {
	name?: string;
	kind?: string;
	url?: string;
	mime?: string;
	duration?: number;
	width?: number;
	height?: number;
	size?: number;
	source?: Record<string, unknown>;
	status?: string;
	data?: Record<string, unknown>;
};

export type MiniCutDktClipSeed = {
	resourceId?: string | null;
	textId?: string | null;
	name?: string;
	color?: string;
	mediaKind?: string;
	start?: number;
	in?: number;
	duration?: number;
	fadeIn?: number;
	fadeOut?: number;
	audio?: { gain: number; pan: number };
	opacity?: { value: number };
	transform?: {
		x: { value: number };
		y: { value: number };
		scale: { value: number };
		rotation: { value: number };
	};
};

export type MiniCutDktTextSeed = {
	content?: string;
	style?: Record<string, unknown>;
	box?: Record<string, unknown>;
};

export type MiniCutDktEffectSeed = {
	name?: string;
	kind?: string;
	enabled?: boolean;
	amount?: number;
	params?: Record<string, unknown>;
	color?: Record<string, unknown>;
};
