import { stat } from "node:fs/promises";
import type {
	ProbeAudioStream,
	ProbeResult,
	ProbeStream,
	ProbeVideoStream,
} from "../contracts/probe";
import { MediaError } from "./mediaError";
import { runCaptured } from "./processRunner";

interface RawStream {
	index?: number;
	codec_type?: string;
	codec_name?: string;
	width?: number;
	height?: number;
	r_frame_rate?: string;
	avg_frame_rate?: string;
	duration?: string;
	start_time?: string;
	nb_frames?: string;
	nb_read_packets?: string;
	sample_rate?: string;
	channels?: number;
	side_data_list?: Array<{ rotation?: number }>;
}

interface RawFormat {
	format_name?: string;
	duration?: string;
	start_time?: string;
	size?: string;
}

interface RawPacket {
	pts_time?: string;
	dts_time?: string;
}

const num = (value: string | number | undefined): number | null => {
	if (value === undefined || value === "N/A") return null;
	const parsed = Number(value);
	return Number.isFinite(parsed) ? parsed : null;
};

export const parseRate = (value: string | undefined): number | null => {
	if (!value || value === "N/A") return null;
	const [n, d] = value.split("/");
	const numerator = Number(n);
	const denominator = d === undefined ? 1 : Number(d);
	if (!Number.isFinite(numerator) || !Number.isFinite(denominator)) return null;
	if (denominator === 0 || numerator === 0) return null;
	return numerator / denominator;
};

/**
 * VFR detection: packet timestamp deltas that are not (nearly) constant.
 * Falls back to nominal vs average rate disagreement when packets are absent.
 */
export const detectVariableFrameRate = (
	packetTimes: number[],
	nominalFps: number | null,
	averageFps: number | null,
): boolean => {
	const sorted = [...packetTimes].sort((a, b) => a - b);
	if (sorted.length >= 4) {
		const deltas: number[] = [];
		for (let i = 1; i < sorted.length; i += 1) {
			deltas.push(sorted[i] - sorted[i - 1]);
		}
		const min = Math.min(...deltas);
		const max = Math.max(...deltas);
		// Tolerate millisecond timestamp rounding in constant-rate containers.
		return max - min > Math.max(0.0025, min * 0.15);
	}
	if (nominalFps && averageFps) {
		return Math.abs(nominalFps - averageFps) / nominalFps > 0.02;
	}
	return false;
};

const mapStream = (raw: RawStream, packetTimes: number[]): ProbeStream => {
	const index = raw.index ?? 0;
	const codec = raw.codec_name ?? "unknown";
	if (raw.codec_type === "video") {
		const nominalFps = parseRate(raw.r_frame_rate);
		const averageFps = parseRate(raw.avg_frame_rate);
		const rotation = raw.side_data_list?.find(
			(item) => typeof item.rotation === "number",
		)?.rotation;
		const stream: ProbeVideoStream = {
			kind: "video",
			index,
			codec,
			width: raw.width ?? 0,
			height: raw.height ?? 0,
			fps: averageFps ?? nominalFps,
			nominalFps,
			variableFrameRate: detectVariableFrameRate(
				packetTimes,
				nominalFps,
				averageFps,
			),
			durationSeconds: num(raw.duration),
			frameCount: num(raw.nb_read_packets) ?? num(raw.nb_frames),
			startTimeSeconds: num(raw.start_time) ?? 0,
			rotation: rotation ?? 0,
		};
		return stream;
	}
	if (raw.codec_type === "audio") {
		const stream: ProbeAudioStream = {
			kind: "audio",
			index,
			codec,
			sampleRate: num(raw.sample_rate) ?? 0,
			channels: raw.channels ?? 0,
			durationSeconds: num(raw.duration),
			startTimeSeconds: num(raw.start_time) ?? 0,
		};
		return stream;
	}
	return { kind: "other", index, codec };
};

export interface ProbeOptions {
	ffprobePath: string;
	timeoutMs?: number;
	/** Count packets (exact frame totals); slower. */
	countFrames?: boolean;
}

export const probeFile = async (
	requestId: string,
	path: string,
	options: ProbeOptions,
): Promise<ProbeResult> => {
	let sizeBytes: number;
	try {
		sizeBytes = (await stat(path)).size;
	} catch {
		throw new MediaError("asset-not-found", `File not found: ${path}`, { path });
	}
	const timeoutMs = options.timeoutMs ?? 30_000;
	const baseArgs = ["-v", "error", "-print_format", "json"];
	const main = await runCaptured(
		options.ffprobePath,
		[
			...baseArgs,
			"-show_format",
			"-show_streams",
			...(options.countFrames ? ["-count_packets"] : []),
			path,
		],
		{ timeoutMs },
	);
	if (main.exitCode !== 0) {
		throw new MediaError("probe-failed", `ffprobe failed for ${path}`, {
			path,
			exitCode: main.exitCode,
			stderr: main.stderr.slice(0, 2000),
		});
	}
	let parsed: { streams?: RawStream[]; format?: RawFormat };
	try {
		parsed = JSON.parse(main.stdout);
	} catch {
		throw new MediaError("probe-failed", "ffprobe returned invalid JSON", {
			path,
		});
	}

	const rawStreams = parsed.streams ?? [];
	const firstVideo = rawStreams.find((s) => s.codec_type === "video");
	let packetTimes: number[] = [];
	if (firstVideo) {
		const packets = await runCaptured(
			options.ffprobePath,
			[
				...baseArgs,
				"-select_streams",
				`${firstVideo.index ?? 0}`,
				"-show_entries",
				"packet=pts_time,dts_time",
				"-read_intervals",
				"%+#300",
				path,
			],
			{ timeoutMs },
		);
		if (packets.exitCode === 0) {
			try {
				const raw = (JSON.parse(packets.stdout) as { packets?: RawPacket[] })
					.packets;
				packetTimes = (raw ?? [])
					.map((p) => num(p.pts_time) ?? num(p.dts_time))
					.filter((t): t is number => t !== null);
			} catch {
				packetTimes = [];
			}
		}
	}

	const streams = rawStreams.map((s) =>
		mapStream(s, s === firstVideo ? packetTimes : []),
	);
	const video =
		streams.find((s): s is ProbeVideoStream => s.kind === "video") ?? null;
	const audio =
		streams.find((s): s is ProbeAudioStream => s.kind === "audio") ?? null;
	const format = parsed.format ?? {};
	const durationSeconds =
		num(format.duration) ??
		video?.durationSeconds ??
		audio?.durationSeconds ??
		0;
	return {
		requestId,
		path,
		formatName: format.format_name ?? "unknown",
		durationSeconds,
		startTimeSeconds: num(format.start_time) ?? 0,
		sizeBytes: num(format.size) ?? sizeBytes,
		streams,
		video,
		audio,
	};
};
