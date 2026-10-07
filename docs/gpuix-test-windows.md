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
