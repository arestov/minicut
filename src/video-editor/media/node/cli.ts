import { readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import type { AssetLocations } from "../contracts/assets";
import type { MediaExportFormat } from "../contracts/export";
import type { MediaJob } from "../contracts/job";
import type { ExportRange } from "../../render/exportTypes";
import type { ExportPlan } from "../../render/renderPlan";
import { MediaError, toMediaErrorInfo } from "./mediaError";
import { createMediaService } from "./mediaService";

/**
 * Headless media CLI. Usage:
 *   cli.ts probe <file>
 *   cli.ts capabilities
 *   cli.ts export --plan <plan.json> --out <file> [--format webm|mp4]
 *          [--assets <assets.json>] [--range project|clip:<id>]
 *          [--fps n] [--width n] [--height n]
 *   cli.ts proxy <file> --out <file> [--height n] [--all-intra] [--gop n]
 *
 * Plan JSON is either an ExportPlan or `{ plan, range?, assets? }`. Assets map
 * clip resourceId -> file path (or { path }). Results are one JSON document on
 * stdout; progress is JSON lines on stderr. Exit: 0 ok, 1 error, 130 cancelled.
 */

export type CliCommand =
	| { command: "probe"; file: string }
	| { command: "capabilities" }
	| {
			command: "export";
			planPath: string;
			outputPath: string;
			format?: MediaExportFormat;
			assetsPath?: string;
			range?: ExportRange;
			fps?: number;
			width?: number;
			height?: number;
	  }
	| {
			command: "proxy";
			file: string;
			outputPath: string;
			height?: number;
			allIntra?: boolean;
			gopSize?: number;
	  };

const usageError = (message: string): MediaError =>
	new MediaError("invalid-request", message);

const parseRange = (value: string): ExportRange => {
	if (value === "project") return { type: "project" };
	if (value.startsWith("clip:") && value.length > 5) {
		return { type: "clip", clipId: value.slice(5) };
	}
	throw usageError(`Invalid --range: ${value}`);
};

const parseNumber = (flag: string, value: string | undefined): number => {
	const parsed = Number(value);
	if (value === undefined || !Number.isFinite(parsed)) {
		throw usageError(`Invalid value for ${flag}: ${value}`);
	}
	return parsed;
};

export const parseCliArgs = (argv: string[]): CliCommand => {
	const [command, ...rest] = argv;
	const flags = new Map<string, string | true>();
	const positional: string[] = [];
	for (let i = 0; i < rest.length; i += 1) {
		const token = rest[i];
		if (token.startsWith("--")) {
			const next = rest[i + 1];
			if (next === undefined || next.startsWith("--")) {
				flags.set(token, true);
			} else {
				flags.set(token, next);
				i += 1;
			}
		} else {
			positional.push(token);
		}
	}
	const str = (flag: string): string | undefined => {
		const value = flags.get(flag);
		return typeof value === "string" ? value : undefined;
	};
	const need = (flag: string): string => {
		const value = str(flag);
		if (!value) throw usageError(`Missing required ${flag}`);
		return value;
	};
	const num = (flag: string): number | undefined =>
		flags.has(flag) ? parseNumber(flag, str(flag)) : undefined;

	switch (command) {
		case "probe": {
			if (!positional[0]) throw usageError("probe requires <file>");
			return { command, file: positional[0] };
		}
		case "capabilities":
			return { command };
		case "export": {
			const format = str("--format");
			if (format !== undefined && format !== "webm" && format !== "mp4") {
				throw usageError(`Invalid --format: ${format}`);
			}
			const range = str("--range");
			return {
				command,
				planPath: need("--plan"),
				outputPath: need("--out"),
				format,
				assetsPath: str("--assets"),
				range: range ? parseRange(range) : undefined,
				fps: num("--fps"),
				width: num("--width"),
				height: num("--height"),
			};
		}
		case "proxy": {
			if (!positional[0]) throw usageError("proxy requires <file>");
			return {
				command,
				file: positional[0],
				outputPath: need("--out"),
				height: num("--height"),
				allIntra: flags.has("--all-intra"),
				gopSize: num("--gop"),
			};
		}
		default:
			throw usageError(
				`Unknown command: ${command ?? "<none>"} (probe|capabilities|export|proxy)`,
			);
	}
};

const readJson = async (file: string): Promise<unknown> => {
	try {
		return JSON.parse(await readFile(file, "utf8"));
	} catch (error) {
		throw new MediaError(
			"invalid-request",
			`Cannot read JSON ${file}: ${error instanceof Error ? error.message : String(error)}`,
		);
	}
};

const normalizeAssets = (value: unknown): AssetLocations => {
	const result: AssetLocations = {};
	if (value && typeof value === "object") {
		for (const [id, entry] of Object.entries(value)) {
			if (typeof entry === "string") result[id] = { path: path.resolve(entry) };
			else if (
				entry &&
				typeof entry === "object" &&
				typeof (entry as { path?: unknown }).path === "string"
			) {
				result[id] = { path: path.resolve((entry as { path: string }).path) };
			}
		}
	}
	return result;
};

const log = (value: unknown): void => {
	process.stderr.write(`${JSON.stringify(value)}\n`);
};

const runJob = async (
	job: MediaJob<unknown>,
): Promise<{ exitCode: number; result: unknown }> => {
	job.onProgress((event) => log({ progress: event }));
	const onSigint = (): void => job.cancel();
	process.once("SIGINT", onSigint);
	const outcome = await job.outcome;
	process.off("SIGINT", onSigint);
	if (outcome.status === "done") {
		return { exitCode: 0, result: { status: "done", artifact: outcome.artifact } };
	}
	if (outcome.status === "cancelled") {
		return { exitCode: 130, result: { status: "cancelled" } };
	}
	return { exitCode: 1, result: { status: "error", error: outcome.error } };
};

export const runCli = async (
	argv: string[],
): Promise<{ exitCode: number; result: unknown }> => {
	try {
		const parsed = parseCliArgs(argv);
		const service = createMediaService();
		switch (parsed.command) {
			case "capabilities":
				return { exitCode: 0, result: await service.capabilities() };
			case "probe":
				return {
					exitCode: 0,
					result: await service.probe({
						requestId: "cli-probe",
						source: { path: path.resolve(parsed.file) },
					}),
				};
			case "proxy":
				return runJob(
					service.generateProxy({
						requestId: "cli-proxy",
						source: { path: path.resolve(parsed.file) },
						outputPath: path.resolve(parsed.outputPath),
						height: parsed.height,
						allIntra: parsed.allIntra,
						gopSize: parsed.gopSize,
					}),
				);
			case "export": {
				const document = (await readJson(parsed.planPath)) as
					| ExportPlan
					| { plan?: ExportPlan; range?: ExportRange; assets?: unknown };
				const wrapped = "plan" in document && document.plan !== undefined;
				const plan = wrapped ? (document as { plan: ExportPlan }).plan : (document as ExportPlan);
				const embedded = wrapped
					? (document as { range?: ExportRange; assets?: unknown })
					: {};
				const assets = {
					...normalizeAssets(embedded.assets),
					...(parsed.assetsPath
						? normalizeAssets(await readJson(parsed.assetsPath))
						: {}),
				};
				return runJob(
					service.exportPlan({
						requestId: "cli-export",
						plan,
						range: parsed.range ?? embedded.range ?? { type: "project" },
						format: parsed.format,
						outputPath: path.resolve(parsed.outputPath),
						fps: parsed.fps,
						width: parsed.width,
						height: parsed.height,
						assets,
					}),
				);
			}
		}
	} catch (error) {
		return {
			exitCode: 1,
			result: { status: "error", error: toMediaErrorInfo(error) },
		};
	}
};

const isMain =
	process.argv[1] !== undefined &&
	import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

if (isMain) {
	runCli(process.argv.slice(2)).then(({ exitCode, result }) => {
		process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
		process.exit(exitCode);
	});
}
