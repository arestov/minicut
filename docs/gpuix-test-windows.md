# GPUIX test windows on Windows

Measured on Windows 11, `@gpuix/native` 0.10.0, Bun 1.4.2. State read with
`GetWindowRect` / `IsWindowVisible` / `IsIconic` / `GetForegroundWindow`.

## Which suites open native windows

| Suite | Native window | Notes |
| --- | --- | --- |
| `npm run test:gpuix` (`bun test`, `createTestRoot` / `TestRenderer`) | Yes, one titled "GPUIX Test" per `createTestRoot`, until the process exits | The native `TestGpuixRenderer` opens an "offscreen" window at (-10000, -10000), but on Windows the OS places it on screen (observed rect 184,-19 to 1736,1081, visible, not foreground, not focused). The constructor takes only width and height, so there is no `focus` / `show` option to pass. Not avoidable from MiniCut; needs a fix in `@gpuix/native`. |
| `npm run test:gpuix:window` (`automation.smoke.ts` -> `main.tsx`) | Yes, one "MiniCut GPUIX" window | Opens with `focus: false`. |
| `npm run test:gpuix:app-window` (`app/automation.app.smoke.ts` -> `app/main.tsx`) | Yes, two "MiniCut" windows (second one after the restart step) | Opens with `focus: false`. |
| `gpuix:app`, `gpuix:dev` | Yes | Focused and visible on purpose. |

## What paints

| Window state | Paints / answers automation | Result |
| --- | --- | --- |
| `focus: false` | Yes | Not foreground; app smoke passes, preview luma and element bounds work. |
| `show: false` (hidden) | No | `app-shell` bounds query times out ("Timed out after 2 seconds waiting for the automation bounds query"); no frames are produced. |
| Minimized (`minimizeWindow()`, iconic) | No | Same timeout. |
| Default (`focus` true) | Yes | Window becomes the foreground window. |

So the only background mode that keeps screenshots, element bounds and the
preview frame working is `focus: false`. The window is still visible on screen,
just not activated.

## How it is controlled

The window test scripts set `GPUIX_BACKGROUND=1` (default; `GPUIX_BACKGROUND=0 npm run test:gpuix:window`
to watch the window). `main.tsx` and `app/main.tsx` read it as `focus: process.env.GPUIX_BACKGROUND !== "1"`.
Run window suites serially; they leave no processes behind.

## Reproducing headless host checks with direct media binaries

Run these commands from the agent-owned MiniCut worktree. Keep the existing
five-second test limits. On Windows, `Get-Command ffmpeg,ffprobe` can resolve
Chocolatey ShimGen launchers rather than the media executables. Use the existing
`MINICUT_FFMPEG_PATH` / `MINICUT_FFPROBE_PATH` settings to select the real binaries;
setting an absolute path to a launcher does not remove its extra process.
The paths below are an example Chocolatey installation; verify them locally.

The two host scenarios start/restore multiple real hosts and run media probes
within one test deadline. Phase measurements on 2026-10-17 reached their outcomes
with no stalled model read: startup/reopen's body took 4.95 s through PATH versus
1.38 s with direct binaries; the GPUIX/Electron/GPUIX body took 3.48 s versus
2.26 s. These measurements locate time spent in startup and external media work;
they are not a guarantee against host load or proof that launchers caused every
prior timeout. An earlier direct-path run also timed out. A passing isolated run
is not a substitute for the original host files and the complete GPUIX suite.

For headless acceptance, keep the separately verified test-only native override
already configured for this checkout; do not install it into `node_modules`.
The commands below only change media paths for the current process and restore
them afterwards. Real app-window/compiled-load checks use the published native
with `NAPI_RS_NATIVE_LIBRARY_PATH` absent. No native/dependency change is implied.

```powershell
# In the agent-owned worktree; configure the verified headless native separately.
$mediaTools = 'C:\ProgramData\chocolatey\lib\ffmpeg\tools\ffmpeg\bin'
$mediaPaths = @{
    MINICUT_FFMPEG_PATH = Join-Path $mediaTools 'ffmpeg.exe'
    MINICUT_FFPROBE_PATH = Join-Path $mediaTools 'ffprobe.exe'
}
$savedMediaPaths = @{}
foreach ($key in $mediaPaths.Keys) {
    if (-not (Test-Path -LiteralPath $mediaPaths[$key] -PathType Leaf)) {
        throw "Missing media binary: $($mediaPaths[$key])"
    }
    $savedMediaPaths[$key] = [Environment]::GetEnvironmentVariable($key)
}
try {
    foreach ($key in $mediaPaths.Keys) {
        Set-Item -LiteralPath "Env:$key" -Value $mediaPaths[$key]
    }
    node scripts/run-gpuix-tests.mjs app/startRealHost.test.ts host/desktopHostTurns.test.ts
    if ($LASTEXITCODE -ne 0) { throw 'Host checks failed; inspect the failure.' }
    npm run test:gpuix
    if ($LASTEXITCODE -ne 0) { throw 'Full GPUIX checks failed; inspect the failure.' }
} finally {
    foreach ($key in $savedMediaPaths.Keys) {
        if ($null -eq $savedMediaPaths[$key]) {
            Remove-Item -LiteralPath "Env:$key" -ErrorAction SilentlyContinue
        } else {
            Set-Item -LiteralPath "Env:$key" -Value $savedMediaPaths[$key]
        }
    }
}
```

Do not add retries, warmup, skips, a larger timeout, or fake preflight/probe results
to make these checks green. Preserve a failing run's log before further diagnosis.