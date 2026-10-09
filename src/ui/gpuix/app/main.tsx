// stdout carries the automation protocol of GPUIX windows, so everything the
// app prints goes to stderr.
import { appendFileSync } from "node:fs";

// MINICUT_LOG_FILE additionally appends everything printed to a file (diagnostics).
const logFile = process.env.MINICUT_LOG_FILE;
const writeStderr = console.error.bind(console);
console.error = (...args: unknown[]) => {
	writeStderr(...args);
	if (logFile) {
		try {
			appendFileSync(logFile, `${args.map((arg) => (typeof arg === "string" ? arg : Bun.inspect(arg))).join(" ")}
`);
		} catch {
			// diagnostics only
		}
	}
};
if (logFile) {
	// Diagnostics: report main-thread stalls (the UI is unresponsive during them).
	let last = performance.now();
	setInterval(() => {
		const now = performance.now();
		if (now - last > 400) console.error(`[minicut:gpuix] ${Date.now() % 100000} main thread stalled for ${Math.round(now - last)} ms`);
		last = now;
	}, 100).unref();
}
for (const method of ["log", "info", "debug"] as const) {
	console[method] = (...args: unknown[]) => console.error(...args);
}

import path from "node:path";
import { render } from "@gpuix/solid";
import { createNativeRenderer, startFrameLoop } from "@gpuix/native/runtime";
import { RootScope } from "../../../dkt-solid-sync";
import { AppShell } from "../AppShell";
import { HostServicesContext } from "../host/hostServices";
import { ClipInspector } from "../inspector/ClipInspector";
import { Sidebar } from "../panels/Sidebar";
import { colors } from "../theme";
import { Timeline } from "../timeline/Timeline";
import { resolveExportDir, resolveProfileDir } from "../../../video-editor/adapters/node/desktopProfileConfig";
import { StartupError } from "./preflight";
import { StartupErrorScreen } from "./StartupErrorScreen";
import { type RealHost, startRealHost } from "./startRealHost";
import { createGuardedPathPrompt } from "../host/nativeDialogs";

/**
 * MiniCut GPUIX app on the real host: workspace on disk (LevelDB in the
 * profile), native import, Node preview frames, FFmpeg export. The fixture
 * entry (`main.tsx`, `gpuix:dev`) stays for UI work and tests.
 *
 *   MINICUT_PROFILE_DIR   profile folder (default: per-user app data)
 *   MINICUT_EXPORT_DIR    export folder (default: <profile>/exports)
 *   MINICUT_FFMPEG_PATH / MINICUT_FFPROBE_PATH   binaries (default: PATH)
 *   MINICUT_AUDIO=off     never open the audio device (silent playback on the system clock)
 */
const windowOptions = {
	title: "MiniCut",
	width: 1280,
	height: 800,
	// GPUIX_BACKGROUND=1 (set by the window test scripts) opens the window without taking focus.
	// Not `show: false`: a hidden or minimized window does not paint (docs/gpuix-test-windows.md).
	focus: process.env.GPUIX_BACKGROUND !== "1",
};

let host: RealHost | null = null;
let exitCode = 0;
let shuttingDown = false;

/** Clean shutdown: executors and ffmpeg children stop, the DKT host closes LevelDB. */
const shutdown = async (code: number): Promise<never> => {
	if (!shuttingDown) {
		shuttingDown = true;
		exitCode = exitCode || code;
		try {
			await host?.dispose();
		} catch (error) {
			console.error("[minicut:gpuix] shutdown failed", error);
			exitCode = exitCode || 1;
		}
	}
	return process.exit(exitCode);
};

const renderer = createNativeRenderer({
	onError: (error) => console.error("[minicut:gpuix] native error", error),
});
renderer.init(windowOptions);
if (logFile) {
	// Diagnostics: time native calls that block the JS thread.
	for (const name of ["setImagePixels", "applyBatch", "tick"] as const) {
		const original = (renderer as unknown as Record<string, (...a: unknown[]) => unknown>)[name]?.bind(renderer);
		if (!original) continue;
		(renderer as unknown as Record<string, unknown>)[name] = (...args: unknown[]) => {
			const started = performance.now();
			const result = original(...args);
			const took = performance.now() - started;
			if (took > 150) console.error(`[minicut:gpuix] native ${name} took ${Math.round(took)} ms`);
			return result;
		};
	}
}
// The window closing ends the frame loop; shut down cleanly instead of exiting at once.
startFrameLoop(renderer, {
	onTerminated: () => void shutdown(0),
	onError: (error) => console.error("[minicut:gpuix] frame error", error),
});
process.on("SIGINT", () => void shutdown(0));
process.on("SIGTERM", () => void shutdown(0));

const mount = (code: () => import("solid-js").JSX.Element): void => {
	render(code, { ...windowOptions, renderer });
};

mount(() => (
	<div style={{ width: "100%", height: "100%", padding: 32, backgroundColor: colors.window }}>
		<text style={{ color: colors.textMuted }}>Starting MiniCut...</text>
	</div>
));

const showStartupError = (error: unknown): void => {
	exitCode = 1;
	const startup = error instanceof StartupError ? error : null;
	const title = startup?.message ?? (error instanceof Error ? error.message : String(error));
	const hint = startup?.hint ?? "See the console output for details.";
	console.error(`[minicut:gpuix] startup failed: ${title}\n${hint}`);
	if (error instanceof Error && error.cause) console.error(error.cause);
	mount(() => <StartupErrorScreen title={title} hint={hint} />);
};

const profileDir = resolveProfileDir();
const testHooksEnabled =
	process.env.MINICUT_GPUIX_TEST_HOOKS === "1" && process.env.NODE_ENV !== "production";

try {
	host = await startRealHost({
		profileDir,
		exportDir: resolveExportDir(profileDir),
		prompt: createGuardedPathPrompt(renderer),
		audio: process.env.MINICUT_AUDIO === "off" ? "off" : "device",
		onCrash: (error) => {
			console.error("[minicut:gpuix] the DKT worker crashed", error);
			void shutdown(1);
		},
		testHooks: testHooksEnabled
			? {
					importPaths: (process.env.MINICUT_TEST_IMPORT_PATHS ?? "")
						.split(path.delimiter)
						.filter(Boolean),
					quit: () => void shutdown(0),
				}
			: undefined,
	});
} catch (error) {
	showStartupError(error);
}

if (host) {
	const running = host;
	mount(() => (
		<HostServicesContext.Provider value={running.services}>
			<RootScope runtime={running.pageRuntime}>
				<AppShell
					sidebar={<Sidebar />}
					timeline={<Timeline />}
					inspector={<ClipInspector />}
				/>
			</RootScope>
		</HostServicesContext.Provider>
	));
}
