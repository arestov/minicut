import { type ChildProcess, execFile, spawn } from "node:child_process";
import { MediaError } from "./mediaError";

/** Kill a process and its children. Windows: taskkill /T /F; elsewhere SIGKILL. */
export const killProcessTree = (child: ChildProcess): Promise<void> =>
	new Promise((resolve) => {
		const pid = child.pid;
		if (!pid || child.exitCode !== null || child.signalCode !== null) {
			resolve();
			return;
		}
		if (process.platform === "win32") {
			execFile("taskkill", ["/pid", String(pid), "/T", "/F"], () => resolve());
			return;
		}
		try {
			child.kill("SIGKILL");
		} catch {
			// already gone
		}
		resolve();
	});

export interface CapturedProcess {
	stdout: string;
	stderr: string;
	exitCode: number | null;
}

/** Run a short-lived tool capturing output, with a bounded timeout. */
export const runCaptured = (
	command: string,
	args: string[],
	options: { timeoutMs: number; maxBuffer?: number } = { timeoutMs: 30_000 },
): Promise<CapturedProcess> =>
	new Promise((resolve, reject) => {
		const child = spawn(command, args, { windowsHide: true });
		let stdout = "";
		let stderr = "";
		let settled = false;
		const maxBuffer = options.maxBuffer ?? 64 * 1024 * 1024;
		const timer = setTimeout(() => {
			if (settled) return;
			settled = true;
			void killProcessTree(child);
			reject(
				new MediaError("process-timeout", `${command} timed out`, {
					timeoutMs: options.timeoutMs,
				}),
			);
		}, options.timeoutMs);
		child.stdout.setEncoding("utf8");
		child.stderr.setEncoding("utf8");
		child.stdout.on("data", (chunk: string) => {
			if (stdout.length < maxBuffer) stdout += chunk;
		});
		child.stderr.on("data", (chunk: string) => {
			if (stderr.length < maxBuffer) stderr += chunk;
		});
		child.on("error", (error: NodeJS.ErrnoException) => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			reject(
				error.code === "ENOENT"
					? new MediaError("binary-not-found", `Binary not found: ${command}`, {
							command,
						})
					: new MediaError("process-failed", error.message, { command }),
			);
		});
		child.on("close", (exitCode) => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			resolve({ stdout, stderr, exitCode });
		});
	});
