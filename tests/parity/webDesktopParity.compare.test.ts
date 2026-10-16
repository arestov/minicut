import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { probeFile } from '../../src/video-editor/media/node/ffprobe'
import { runCaptured } from '../../src/video-editor/media/node/processRunner'
import {
	audioStats,
	compareFrameAt,
	integratedLoudness,
} from '../../src/video-editor/media/node/testing/mediaMetrics'
import { PARITY_ROOT, parityDirectory, readManifest } from './artifacts'
import { ensureFixtures } from '../../src/video-editor/media/node/testing/mediaFixtures'
import { flatColorSsim, imageSsim, sourceFrameSsim } from './imageMetrics'
import { PARITY_FILES, PARITY_STEPS, PARITY_THRESHOLDS, findClip, type ParityManifest } from './sharedScenario'
import { diffSnapshots } from './snapshotDiff'

/**
 * Compares the artifacts of the web run (tests/integration/web-desktop-scenario.spec.ts)
 * with the desktop run (src/ui/gpuix/parity/desktopScenario.test.ts) for the same
 * scenario: model state at every checkpoint, preview pictures by SSIM, exports by
 * ffprobe metadata, frame SSIM and audio level / loudness. Measured values are
 * written to tmp/parity/report.json and printed as PARITY-REPORT lines.
 *
 * Differences that are known and explained are listed in KNOWN_DESKTOP_GAPS; their
 * parity assertions use `it.fails`, so the suite goes red as soon as a gap is closed
 * and the entry has to be removed.
 */

const ffprobePath = process.env.MINICUT_FFPROBE_PATH ?? 'ffprobe'

/** Why a desktop outcome differs from the web on purpose (documented in docs/web-desktop-parity.md). */
const KNOWN_DESKTOP_GAPS = {
	frames: {
		'image-half-opacity': /does not support: opacity/,
	} as Record<string, RegExp>,
	exports: {
		'with-opacity': /does not support: opacity/,
	} as Record<string, RegExp>,
}

/** Per-frame SSIM thresholds that differ from the default, each with the measured reason. */
const FRAME_SSIM_OVERRIDES: Record<string, { min: number; reason: string }> = {
	image: {
		min: 0.95,
		reason: 'card.png is 160x120 and is magnified about 7x; the browser (GPU bilinear) and swscale (bicubic) soften the edges differently. Measured 0.9687.',
	},
}

const web = readManifest('web')
const desktop = readManifest('desktop')
const report: {
	state: Record<string, string[]>
	frames: Record<string, number | string>
	exports: Record<string, unknown>
	elapsedMs: { web: number; desktop: number }
} = { state: {}, frames: {}, exports: {}, elapsedMs: { web: web.elapsedMs, desktop: desktop.elapsedMs } }

afterAll(() => {
	mkdirSync(PARITY_ROOT, { recursive: true })
	writeFileSync(path.join(PARITY_ROOT, 'report.json'), JSON.stringify(report, null, 2))
	console.log('PARITY-REPORT', JSON.stringify(report))
})

const frameBox = (manifest: ParityManifest, name: string) => {
	const frame = manifest.frames.find((candidate) => candidate.name === name)
	if (!frame) throw new Error(`${manifest.platform} has no frame ${name}`)
	return frame
}

describe('model state', () => {
	const checkpointNames = PARITY_STEPS.flatMap((step) => (step.op === 'checkpoint' ? [step.name] : []))

	it.each(checkpointNames)('checkpoint %s is the same on web and desktop', (name) => {
		const left = web.checkpoints[name]
		const right = desktop.checkpoints[name]
		expect(left, `web checkpoint ${name}`).toBeDefined()
		expect(right, `desktop checkpoint ${name}`).toBeDefined()
		const diffs = diffSnapshots(left, right, PARITY_THRESHOLDS.timeToleranceSeconds)
		report.state[name] = diffs
		expect(diffs).toEqual([])
	})

	it('applies the scenario edits to both platforms', () => {
		for (const manifest of [web, desktop]) {
			const edited = manifest.checkpoints.edited
			const video = edited.tracks.find((track) => track.name === 'V1')!.clips
			const audio = edited.tracks.find((track) => track.name === 'A1')!.clips
			const trimmed = video.find((clip) => clip.name === 'av.webm')!
			expect(trimmed.in, `${manifest.platform} av in`).toBeGreaterThan(0.3)
			expect(trimmed.start, `${manifest.platform} av start`).toBeGreaterThan(0.3)
			const blue = video.find((clip) => clip.name === 'blue.webm')!
			expect(blue.start, `${manifest.platform} blue start`).toBeLessThan(1.5)
			expect(blue.duration, `${manifest.platform} blue out point`).toBeLessThan(2)
			expect(video.find((clip) => clip.name === 'vfr.webm')!.in, `${manifest.platform} vfr in`).toBeGreaterThan(0.4)
			expect(audio[0].gain, `${manifest.platform} volume`).toBe(0.5)
			expect(manifest.checkpoints.opacity.tracks[0].clips.find((clip) => clip.name === 'card.png')!.opacity).toBe(0.5)
			expect(manifest.checkpoints.playing.session.isPlaying).toBe(true)
			expect(manifest.checkpoints.paused.session).toMatchObject({ isPlaying: false, cursor: 1.6 })
			expect(edited.session.selectedClip).toEqual({ track: 'V1', name: 'av.webm', nth: 0 })
   const color = manifest.checkpoints['inspector-color']
   const graded = findClip(color, { track: 'V1', name: 'av.webm' })!
   expect(color.session.activeInspectorTab).toBe('color')
   expect(graded).toMatchObject({ color: '#14b8a6', transform: { x: 12, y: -3, scale: 1.25, rotation: 15 }, fadeIn: 0.5, fadeOut: 0.5, correctionEffectIndices: [1, 2], hasColorCorrection: true })
   expect(graded.effects).toEqual([
    { name: 'Parity bypass blur', kind: 'blur', enabled: false, params: {} },
    { name: 'Parity grade A', kind: 'color-correction', enabled: false, params: { lookId: 'custom', exposure: { value: 0.25 }, contrast: { value: 1.2 }, saturation: { value: 0.8 }, temperature: { value: -0.1 } } },
    { name: 'Parity grade B', kind: 'color-correction', enabled: false, params: { lookId: 'custom', exposure: { value: -0.2 }, contrast: { value: 0.9 }, saturation: { value: 1.1 }, temperature: { value: 0.15 } } },
   ])
   const restored = manifest.checkpoints['inspector-edit-restored']
   expect(restored.session.activeInspectorTab).toBe('edit')
   expect(findClip(restored, { track: 'V1', name: 'av.webm' })).toMatchObject({ transform: { x: 0, y: 0, scale: 1, rotation: 0 }, fadeIn: 0, fadeOut: 0 })
   const audioInspector = manifest.checkpoints['inspector-audio']
   expect(audioInspector.session).toMatchObject({ activeInspectorTab: 'audio', selectedClip: { track: 'A1', name: 'Embedded audio', nth: 0 } })
   expect(findClip(audioInspector, { track: 'A1', name: 'Embedded audio' })).toMatchObject({ gain: 0.75, pan: 0.25 })
   const exportInspector = manifest.checkpoints['inspector-export']
   expect(exportInspector.session).toMatchObject({ activeInspectorTab: 'export', selectedClip: { track: 'V1', name: 'av.webm', nth: 0 } })
   expect(findClip(exportInspector, { track: 'A1', name: 'Embedded audio' })).toMatchObject({ gain: 0.5, pan: 0 })
   expect(manifest.checkpoints['inspector-restored'].session).toMatchObject({ activeInspectorTab: 'edit', selectedClip: { track: 'V1', name: 'av.webm', nth: 0 } })
		}
	})
})

describe('preview frames', () => {
	const frameNames = PARITY_STEPS.flatMap((step) => (step.op === 'frame' ? [step.name] : []))
	const pictureOf = (manifest: ParityManifest, name: string) => {
		const frame = frameBox(manifest, name)
		if (!frame.file) throw new Error(`${manifest.platform} has no picture for ${name}: ${frame.error}`)
		return { file: path.join(parityDirectory(manifest.platform), frame.file), box: frame.content }
	}
	const compareFrame = async (name: string): Promise<number> => {
		const ssim = await imageSsim(pictureOf(web, name), pictureOf(desktop, name))
		report.frames[name] = ssim
		return ssim
	}

	/** Presentation times of the video frames of a file, in order. */
	const framePts = async (file: string): Promise<number[]> => {
		const result = await runCaptured(
			ffprobePath,
			['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'frame=pts_time', '-of', 'csv=p=0', file],
			{ timeoutMs: 30_000 },
		)
		return result.stdout.split('\n').map((line) => line.trim()).filter(Boolean).map(Number).sort((a, b) => a - b)
	}

	/**
	 * Which source frame a platform's picture is made of, as an offset in source frames from
	 * the frame the timeline time selects (the last frame at or before it). The picture is scored
	 * against the neighbouring source frames; ties within 0.002 prefer the smaller offset.
	 */
	const shownSourceOffset = async (manifest: ParityManifest, name: string, time: number) => {
		const clips = manifest.checkpoints.paused.tracks.find((track) => track.name === 'V1')!.clips
		const top = clips.filter((clip) => time >= clip.start && time < clip.start + clip.duration).at(-1)
		if (!top || top.mediaKind !== 'video') return null
		const file = PARITY_FILES.find((candidate) => candidate.name === top.resource)!
		const source = (await ensureFixtures([file.fixture]))[file.fixture]
		const pts = await framePts(source)
		const expected = top.in + time - top.start
		const index = pts.reduce((found, value, position) => (value <= expected + 1e-6 ? position : found), 0)
		const scores: Record<number, number> = {}
		for (const offset of [-2, -1, 0, 1, 2]) {
			const target = pts[Math.min(pts.length - 1, Math.max(0, index + offset))]
			// ffmpeg's -ss outputs the first frame at or after the position; aim just before the frame.
			scores[offset] = await sourceFrameSsim(pictureOf(manifest, name), source, target - 0.002)
		}
		const best = Math.max(...Object.values(scores))
		const shown = Number(
			Object.entries(scores)
				.filter(([, score]) => score >= best - 0.002)
				.map(([offset]) => offset)
				.sort((a, b) => Math.abs(Number(a)) - Math.abs(Number(b)))[0],
		)
		return { scores, shown, best }
	}

	for (const name of frameNames) {
		const time = frameBox(web, name).time
		const gap = KNOWN_DESKTOP_GAPS.frames[name]
		if (gap) {
			it(`${name}: the desktop reports the unsupported operation, the web renders the picture`, () => {
				expect(frameBox(web, name).error).toBeNull()
				expect(frameBox(desktop, name).error).toMatch(gap)
				report.frames[name] = `desktop: ${frameBox(desktop, name).error}`
			})
			it.fails(`${name}: the desktop picture matches the web (known gap)`, async () => {
				expect(await compareFrame(name)).toBeGreaterThanOrEqual(PARITY_THRESHOLDS.frameSsimMin)
			})
			continue
		}
		if (frameBox(web, name).placeholder) {
			// The web stage writes "No frame at cursor" where nothing is under the cursor; the desktop shows the background.
			it(`${name}: nothing is under the cursor; the web shows its placeholder, the desktop the plain background`, async () => {
				expect(frameBox(web, name).placeholder).toBe(true)
				const flat = await flatColorSsim(pictureOf(desktop, name), '09090b')
				report.frames[name] = `placeholder; desktop flat-background SSIM ${flat}`
				expect(flat).toBeGreaterThanOrEqual(PARITY_THRESHOLDS.frameSsimMin)
			})
			continue
		}
		it(`${name}: the desktop picture matches the web`, async () => {
			const override = FRAME_SSIM_OVERRIDES[name]
			expect(await compareFrame(name)).toBeGreaterThanOrEqual(override?.min ?? PARITY_THRESHOLDS.frameSsimMin)
		})
		it(`${name}: both platforms show the expected source frame`, async () => {
			const [left, right] = [await shownSourceOffset(web, name, time), await shownSourceOffset(desktop, name, time)]
			report.frames[`${name}:source-offset`] = JSON.stringify({ web: left?.shown, desktop: right?.shown, webScores: left?.scores, desktopScores: right?.scores })
			// The desktop picks the frame the export picks (exact); the web seeks a media element within a tolerance.
			if (right) expect(right.shown, 'desktop source frame offset').toBe(0)
			if (left) expect(Math.abs(left.shown), 'web source frame offset').toBeLessThanOrEqual(1)
		})
	}
})

describe('export', () => {
	const exportNames = PARITY_STEPS.flatMap((step) => (step.op === 'export' ? [step.name] : []))
	const frameTimes = [0.2, 0.9, 1.5, 2.2, 3.5, 4.5, 6.0, 6.9]
	const toneWindow = { start: 0.3, duration: 1.5 }

	const outcome = (manifest: ParityManifest, name: string) => {
		const entry = manifest.exports.find((candidate) => candidate.name === name)
		if (!entry) throw new Error(`${manifest.platform} has no export ${name}`)
		return entry
	}

	const compareExport = async (name: string): Promise<void> => {
		const left = outcome(web, name)
		const right = outcome(desktop, name)
		if (!left.file || !right.file) {
			throw new Error(`no file to compare: web ${left.error ?? 'ok'}, desktop ${right.error ?? 'ok'}`)
		}
		const webPath = path.join(parityDirectory('web'), left.file)
		const desktopPath = path.join(parityDirectory('desktop'), right.file)
		const [webProbe, desktopProbe] = await Promise.all([
			probeFile('web', webPath, { ffprobePath, countFrames: true }),
			probeFile('desktop', desktopPath, { ffprobePath, countFrames: true }),
		])
		const frames: Array<{ at: number; ssim: number; psnr: number }> = []
		for (const at of frameTimes) {
			const size = { width: 480, height: 270 }
			frames.push({
				at,
				ssim: await compareFrameAt(webPath, desktopPath, { at, metric: 'ssim', ...size }),
				psnr: await compareFrameAt(webPath, desktopPath, { at, metric: 'psnr', ...size }),
			})
		}
		const [webAudio, desktopAudio, webTone, desktopTone, webLufs, desktopLufs] = await Promise.all([
			audioStats(webPath),
			audioStats(desktopPath),
			audioStats(webPath, toneWindow),
			audioStats(desktopPath, toneWindow),
			integratedLoudness(webPath),
			integratedLoudness(desktopPath),
		])
		report.exports[name] = {
			web: { w: webProbe.video?.width, h: webProbe.video?.height, fps: webProbe.video?.fps, frames: webProbe.video?.frameCount, duration: webProbe.durationSeconds, audio: webProbe.audio },
			desktop: { w: desktopProbe.video?.width, h: desktopProbe.video?.height, fps: desktopProbe.video?.fps, frames: desktopProbe.video?.frameCount, duration: desktopProbe.durationSeconds, audio: desktopProbe.audio },
			frames,
			audio: { webAudio, desktopAudio, webTone, desktopTone, webLufs, desktopLufs },
		}

		expect(desktopProbe.video?.width).toBe(webProbe.video?.width)
		expect(desktopProbe.video?.height).toBe(webProbe.video?.height)
		expect(desktopProbe.video?.fps).toBeCloseTo(webProbe.video?.fps ?? 0, 1)
		expect(Math.abs(desktopProbe.durationSeconds - webProbe.durationSeconds)).toBeLessThanOrEqual(PARITY_THRESHOLDS.exportDurationToleranceSeconds)
		expect(Math.abs((desktopProbe.video?.frameCount ?? 0) - (webProbe.video?.frameCount ?? 0))).toBeLessThanOrEqual(PARITY_THRESHOLDS.exportFrameCountTolerance)
		expect(desktopProbe.audio?.sampleRate).toBe(webProbe.audio?.sampleRate)
		expect(desktopProbe.audio?.channels).toBe(webProbe.audio?.channels)
		for (const frame of frames) {
			expect(frame.ssim, `export SSIM at ${frame.at}s`).toBeGreaterThanOrEqual(PARITY_THRESHOLDS.exportFrameSsimMin)
		}
		expect(Math.abs(desktopAudio.rmsDb - webAudio.rmsDb), 'overall RMS dB').toBeLessThan(PARITY_THRESHOLDS.exportRmsToleranceDb)
		expect(Math.abs(desktopTone.rmsDb - webTone.rmsDb), 'tone window RMS dB').toBeLessThan(PARITY_THRESHOLDS.exportRmsToleranceDb)
		expect(Math.abs(desktopLufs - webLufs), 'integrated LUFS').toBeLessThan(PARITY_THRESHOLDS.exportLufsTolerance)
	}

	for (const name of exportNames) {
		const gap = KNOWN_DESKTOP_GAPS.exports[name]
		if (gap) {
			it(`${name}: the desktop reports the unsupported operation, the web exports the file`, () => {
				expect(outcome(web, name).error).toBeNull()
				expect(outcome(web, name).file).not.toBeNull()
				expect(outcome(desktop, name).error).toMatch(gap)
				report.exports[name] = { desktop: outcome(desktop, name).error }
			})
			it.fails(`${name}: the desktop export matches the web (known gap)`, async () => {
				await compareExport(name)
			})
			continue
		}
		it(`${name}: the desktop export matches the web within the explicit tolerances`, async () => {
			await compareExport(name)
		})
	}
})
