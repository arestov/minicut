import { expect, test, type Page } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import {
	analyzeExportedAudio,
	expectToneEnergy,
	measureChannelFrequencyPower,
	measureFrequencyPower,
	probeMedia,
	sampleVideoFramePixelRgba,
	sampleVideoFrameRgba,
} from './audio-analysis'

const timelineZoomPxPerSecond = 56

interface PlaywrightFilePayload {
	name: string
	mimeType: string
	buffer: Buffer
}

interface ToneSegment {
	start: number
	end: number
	frequency: number
	leftGain?: number
	rightGain?: number
}

const createProjectFromMenu = async (page: Page): Promise<void> => {
	const projectsRegion = page.getByLabel('Projects')
	await projectsRegion.getByRole('button').click()
	await projectsRegion.getByRole('button', { name: 'New project' }).click()
	await expect(projectsRegion.getByRole('button', { name: /Project \d+/i })).toBeVisible()
}

const createSolidPngFile = async (
	page: Page,
	name: string,
	fillStyle: string,
): Promise<PlaywrightFilePayload> => {
	const bytes = await page.evaluate(async (color) => {
		const canvas = document.createElement('canvas')
		canvas.width = 96
		canvas.height = 96
		const context = canvas.getContext('2d')
		if (!context) {
			throw new Error('Unable to create PNG fixture canvas')
		}
		context.fillStyle = color
		context.fillRect(0, 0, canvas.width, canvas.height)
		const blob = await new Promise<Blob>((resolve, reject) => {
			canvas.toBlob((result) => result ? resolve(result) : reject(new Error('Unable to encode PNG fixture')), 'image/png')
		})
		return Array.from(new Uint8Array(await blob.arrayBuffer()))
	}, fillStyle)

	return { name, mimeType: 'image/png', buffer: Buffer.from(bytes) }
}

const createToneWavFile = ({
	name,
	durationSeconds,
	segments,
	channels = 2,
}: {
	name: string
	durationSeconds: number
	segments: ToneSegment[]
	channels?: 1 | 2
}): PlaywrightFilePayload => {
	const sampleRate = 48_000
	const sampleCount = Math.floor(sampleRate * durationSeconds)
	const bytesPerSample = 2
	const blockAlign = channels * bytesPerSample
	const buffer = Buffer.alloc(44 + sampleCount * blockAlign)
	buffer.write('RIFF', 0)
	buffer.writeUInt32LE(36 + sampleCount * blockAlign, 4)
	buffer.write('WAVE', 8)
	buffer.write('fmt ', 12)
	buffer.writeUInt32LE(16, 16)
	buffer.writeUInt16LE(1, 20)
	buffer.writeUInt16LE(channels, 22)
	buffer.writeUInt32LE(sampleRate, 24)
	buffer.writeUInt32LE(sampleRate * blockAlign, 28)
	buffer.writeUInt16LE(blockAlign, 32)
	buffer.writeUInt16LE(16, 34)
	buffer.write('data', 36)
	buffer.writeUInt32LE(sampleCount * blockAlign, 40)

	for (let frame = 0; frame < sampleCount; frame += 1) {
		const time = frame / sampleRate
		let left = 0
		let right = 0
		for (const segment of segments) {
			if (time < segment.start || time >= segment.end) {
				continue
			}
			const sample = Math.sin(time * Math.PI * 2 * segment.frequency) * 0x1fff
			left += sample * (segment.leftGain ?? 1)
			right += sample * (segment.rightGain ?? segment.leftGain ?? 1)
		}
		const clampedLeft = Math.max(-0x7fff, Math.min(0x7fff, Math.round(left)))
		const clampedRight = Math.max(-0x7fff, Math.min(0x7fff, Math.round(right)))
		const offset = 44 + frame * blockAlign
		buffer.writeInt16LE(clampedLeft, offset)
		if (channels > 1) {
			buffer.writeInt16LE(clampedRight, offset + bytesPerSample)
		}
	}

	return { name, mimeType: 'audio/wav', buffer }
}

const createVideoWithToneFile = async (
	page: Page,
	options: { name?: string; durationSeconds?: number; segments?: ToneSegment[] } = {},
): Promise<PlaywrightFilePayload> => {
	const durationSeconds = options.durationSeconds ?? 1
	const segments = options.segments ?? [{ start: 0, end: durationSeconds, frequency: 440 }]
	const result = await page.evaluate(async ({ durationSeconds, segments }) => {
		const mimeType = ['video/webm;codecs=vp8,opus', 'video/webm;codecs=vp8', 'video/webm']
			.find((candidate) => MediaRecorder.isTypeSupported(candidate))
		if (!mimeType) {
			throw new Error('MediaRecorder WebM is not supported in this browser')
		}

		const canvas = document.createElement('canvas')
		canvas.width = 96
		canvas.height = 96
		const context = canvas.getContext('2d')
		if (!context) {
			throw new Error('Unable to create video fixture canvas')
		}
		const stream = canvas.captureStream(10)
		const videoTrack = stream.getVideoTracks()[0] as CanvasCaptureMediaStreamTrack | undefined
		const audioContext = new AudioContext()
		await audioContext.resume().catch(() => undefined)
		const oscillator = audioContext.createOscillator()
		const gain = audioContext.createGain()
		const destination = audioContext.createMediaStreamDestination()
		const baseTime = audioContext.currentTime
		for (const segment of segments) {
			oscillator.frequency.setValueAtTime(segment.frequency, baseTime + segment.start)
		}
		gain.gain.value = 0.08
		oscillator.connect(gain).connect(destination)
		for (const track of destination.stream.getAudioTracks()) {
			stream.addTrack(track)
		}

		const chunks: BlobPart[] = []
		const recorder = new MediaRecorder(stream, { mimeType })
		const stopped = new Promise<void>((resolve, reject) => {
			recorder.addEventListener('dataavailable', (event) => {
				if (event.data.size > 0) {
					chunks.push(event.data)
				}
			})
			recorder.addEventListener('stop', () => resolve())
			recorder.addEventListener('error', () => reject(recorder.error ?? new Error('Fixture recorder failed')))
		})

		recorder.start()
		oscillator.start()
		const frameCount = Math.ceil(durationSeconds * 10)
		for (let frame = 0; frame < frameCount; frame += 1) {
			context.fillStyle = '#dc2626'
			context.fillRect(0, 0, canvas.width, canvas.height)
			videoTrack?.requestFrame?.()
			await new Promise((resolve) => setTimeout(resolve, 100))
		}
		oscillator.stop()
		recorder.stop()
		await stopped
		for (const track of stream.getTracks()) {
			track.stop()
		}
		await audioContext.close().catch(() => undefined)

		const blob = new Blob(chunks, { type: recorder.mimeType || mimeType })
		return { mimeType: blob.type || 'video/webm', bytes: Array.from(new Uint8Array(await blob.arrayBuffer())) }
	}, { durationSeconds, segments })

	return { name: options.name ?? 'linked-tone-video.webm', mimeType: result.mimeType, buffer: Buffer.from(result.bytes) }
}

const addResourceToTimeline = async (page: Page, resourceName: string): Promise<void> => {
	const timeline = page.getByRole('region', { name: 'Timeline' })
	if (await timeline.getByRole('button', { name: new RegExp(resourceName, 'i') }).count() > 0) {
		return
	}

	await page
		.getByLabel('Media bin')
		.locator('.ve-resource-row')
		.filter({ hasText: resourceName })
		.getByRole('button', { name: 'Add to timeline' })
		.click()
	await expect(timeline.getByRole('button', { name: new RegExp(resourceName, 'i') })).toBeVisible()
}

const importMediaFiles = async (page: Page, files: PlaywrightFilePayload[]): Promise<void> => {
	await page.getByLabel('Import media files').setInputFiles(files)
	for (const file of files) {
		await expect(page.getByLabel('Media bin').locator('strong').filter({ hasText: file.name })).toBeVisible()
	}
}

const exportProject = async (page: Page): Promise<string> => {
	const downloadPromise = page.waitForEvent('download')
	await page.getByRole('button', { name: 'Export project' }).click()
	const download = await downloadPromise
	const downloadPath = await download.path()
	expect(downloadPath).toBeTruthy()
	return downloadPath as string
}

const exportSelectedClip = async (page: Page): Promise<string> => {
	const inspector = page.getByRole('complementary', { name: 'Inspector' })
	await inspector.getByRole('tab', { name: 'Export' }).click()
	await inspector.getByRole('button', { name: 'Queue clip export' }).click()
	await expect(inspector.getByRole('status')).toContainText('Export ready', { timeout: 30_000 })
	const downloadPromise = page.waitForEvent('download')
	await inspector.getByRole('link', { name: 'Download file' }).click()
	const download = await downloadPromise
	const downloadPath = await download.path()
	expect(downloadPath).toBeTruthy()
	return downloadPath as string
}

const selectTimelineClip = async (page: Page, name: RegExp): Promise<void> => {
	const clip = page.getByRole('region', { name: 'Timeline' }).getByRole('button', { name }).first()
	await expect(clip).toBeVisible()
	await clip.click()
}

const setSelectedAudio = async (page: Page, { gain, pan }: { gain?: number; pan?: number }): Promise<void> => {
	const inspector = page.getByRole('complementary', { name: 'Inspector' })
	await inspector.getByRole('tab', { name: 'Audio' }).click()
	if (gain !== undefined) {
		await inspector.getByLabel('Gain').fill(String(Math.round(gain * 100)))
	}
	if (pan !== undefined) {
		await inspector.getByLabel('Pan').fill(String(Math.round(pan * 100)))
	}
}

const setSelectedOpacity = async (page: Page, opacityPercent: number): Promise<void> => {
	const inspector = page.getByRole('complementary', { name: 'Inspector' })
	await inspector.getByRole('tab', { name: 'Edit' }).click()
	await inspector.getByLabel('Opacity').fill(String(opacityPercent))
}

const setSelectedTransform = async (
	page: Page,
	transform: Partial<Record<'X' | 'Y' | 'Scale' | 'Rotate', number>>,
): Promise<void> => {
	const inspector = page.getByRole('complementary', { name: 'Inspector' })
	await inspector.getByRole('tab', { name: 'Edit' }).click()
	for (const [label, value] of Object.entries(transform)) {
		await inspector.getByLabel(label).fill(String(value))
	}
}

const addSelectedEffect = async (page: Page, effectName: 'Blur' | 'Sharpen' | 'Tint'): Promise<void> => {
	const inspector = page.getByRole('complementary', { name: 'Inspector' })
	await inspector.getByRole('tab', { name: 'Edit' }).click()
	await inspector.getByRole('button', { name: effectName }).click()
}

const nudgeSelectedClip = async (page: Page, count: number): Promise<void> => {
	const inspector = page.getByRole('complementary', { name: 'Inspector' })
	await inspector.getByRole('tab', { name: 'Edit' }).click()
	for (let index = 0; index < count; index += 1) {
		await inspector.getByRole('button', { name: 'Nudge +0.5s' }).click()
	}
}

const forceMediaRecorderFallback = async (page: Page, options: { removeRequestFrame?: boolean } = {}): Promise<void> => {
	await page.addInitScript(({ removeRequestFrame }) => {
		Object.defineProperty(window, 'VideoEncoder', { value: undefined, configurable: true })
		Object.defineProperty(window, 'VideoFrame', { value: undefined, configurable: true })
		Object.defineProperty(window, 'AudioEncoder', { value: undefined, configurable: true })
		Object.defineProperty(window, 'AudioData', { value: undefined, configurable: true })
		if (removeRequestFrame && 'CanvasCaptureMediaStreamTrack' in window) {
			Object.defineProperty(CanvasCaptureMediaStreamTrack.prototype, 'requestFrame', { value: undefined, configurable: true })
		}
	}, options)
}

const expectAnalyzableExport = async (filePath: string): Promise<void> => {
	const media = await probeMedia(filePath)
	expect(media.videoStreams.length).toBeGreaterThan(0)
	expect(media.audioStreams.length).toBeGreaterThan(0)
	expect(media.formatDuration).toBeGreaterThan(0.7)
	const { samples, analysis } = await analyzeExportedAudio(filePath, { windowSeconds: 0.25 })
	expect(samples.length).toBeGreaterThan(0)
	expect(analysis.rms).toBeGreaterThan(0.001)
	expect(analysis.peak).toBeLessThanOrEqual(1)
}

test.describe('exported audio artifacts', () => {
	test.describe.configure({ timeout: 120_000 })

	test('exports image plus wav audio as a measurable media artifact', async ({ page }) => {
		await page.goto('/')
		await createProjectFromMenu(page)

		const imageFile = await createSolidPngFile(page, 'artifact-green.png', '#16a34a')
		const audioFile = createToneWavFile({
			name: 'artifact-tone-440.wav',
			durationSeconds: 1,
			segments: [{ start: 0, end: 1, frequency: 440 }],
		})
		await importMediaFiles(page, [imageFile, audioFile])
		await addResourceToTimeline(page, audioFile.name)

		const exportPath = await exportProject(page)
		await expectAnalyzableExport(exportPath)
		const media = await probeMedia(exportPath)
		expect(media.videoStreams[0].width).toBeGreaterThan(0)
		expect(media.audioStreams[0].channels).toBeGreaterThan(0)
		const { samples } = await analyzeExportedAudio(exportPath)
		expectToneEnergy(samples, { channels: 2, sampleRate: 48_000, frequency: 440, start: 0.1, end: 0.9 })
		const [red, green, blue] = await sampleVideoFrameRgba(exportPath, { time: 0.5 })
		expect(green).toBeGreaterThan(90)
		expect(green).toBeGreaterThan(red + 20)
		expect(green).toBeGreaterThan(blue + 20)
	})

	test('forced fallback without requestFrame keeps exported audio alive', async ({ page }) => {
		await forceMediaRecorderFallback(page, { removeRequestFrame: true })
		await page.goto('/')
		await createProjectFromMenu(page)

		const imageFile = await createSolidPngFile(page, 'fallback-green.png', '#16a34a')
		const audioFile = createToneWavFile({
			name: 'fallback-tone.wav',
			durationSeconds: 1,
			segments: [{ start: 0, end: 1, frequency: 440 }],
		})
		await importMediaFiles(page, [imageFile, audioFile])
		await addResourceToTimeline(page, audioFile.name)

		const exportPath = await exportProject(page)
		await expectAnalyzableExport(exportPath)
	})

	test('bad audio source exports manifest diagnostics instead of a silent successful file', async ({ page }) => {
		await page.addInitScript(() => {
			Object.defineProperty(window, 'MediaRecorder', { value: undefined, configurable: true })
		})
		await page.goto('/')
		await createProjectFromMenu(page)

		const imageFile = await createSolidPngFile(page, 'bad-audio-green.png', '#16a34a')
		const badAudioFile: PlaywrightFilePayload = {
			name: 'bad-audio-source.wav',
			mimeType: 'audio/wav',
			buffer: Buffer.from('this is not a wav file'),
		}
		await importMediaFiles(page, [imageFile, badAudioFile])
		await addResourceToTimeline(page, badAudioFile.name)

		const exportPath = await exportProject(page)
		const manifest = JSON.parse(await readFile(exportPath, 'utf8')) as {
			format?: string
			diagnostics?: { backend?: string; fallbackReason?: string; resolvedClipIds?: string[] }
			clips?: Array<{ type?: string; source?: string }>
		}
		expect(manifest.format).toBe('json-manifest')
		expect(manifest.diagnostics).toMatchObject({
			backend: 'manifest',
			fallbackReason: 'webcodecs-audio-mix-failed',
		})
		expect(manifest.diagnostics?.resolvedClipIds?.length).toBeGreaterThanOrEqual(2)
		expect(manifest.clips).toEqual(expect.arrayContaining([
			expect.objectContaining({ type: 'ef-audio' }),
		]))
	})

	test('selected video clip export includes linked embedded audio', async ({ page }) => {
		await page.goto('/')
		await createProjectFromMenu(page)

		const videoFile = await createVideoWithToneFile(page)
		await importMediaFiles(page, [videoFile])
		await expect(page.getByRole('region', { name: 'Timeline' }).getByRole('button', { name: /Embedded audio/i })).toBeVisible()
		await selectTimelineClip(page, /linked-tone-video\.webm/i)

		const exportPath = await exportSelectedClip(page)
		const media = await probeMedia(exportPath)
		expect(media.audioStreams.length).toBeGreaterThan(0)
		const { samples, analysis } = await analyzeExportedAudio(exportPath, { windowSeconds: 0.25 })
		expect(analysis.rms).toBeGreaterThan(0.001)
		expectToneEnergy(samples, { channels: 2, sampleRate: 48_000, frequency: 440, start: 0.1, end: 0.8, minPower: 0.001 })
	})

	test('selected video export uses trimmed linked audio timing from the produced file', async ({ page }) => {
		await page.goto('/')
		await createProjectFromMenu(page)

		const videoFile = await createVideoWithToneFile(page, {
			name: 'linked-two-tone-video.webm',
			durationSeconds: 2,
			segments: [
				{ start: 0, end: 1, frequency: 440 },
				{ start: 1, end: 2, frequency: 880 },
			],
		})
		await importMediaFiles(page, [videoFile])
		await selectTimelineClip(page, /Embedded audio/i)
		const inspector = page.getByRole('complementary', { name: 'Inspector' })
		await inspector.getByRole('button', { name: 'Start +0.5s' }).click()
		await inspector.getByRole('button', { name: 'Start +0.5s' }).click()
		await selectTimelineClip(page, /linked-two-tone-video\.webm/i)

		const exportPath = await exportSelectedClip(page)
		const { samples, analysis } = await analyzeExportedAudio(exportPath, { windowSeconds: 0.25 })
		const silentBeforeLinkedAudio = analysis.windows.filter((window) => window.start >= 0.2 && window.end <= 0.8)
		expect(Math.max(...silentBeforeLinkedAudio.map((window) => window.rms))).toBeLessThan(0.002)
		const power440 = measureFrequencyPower(samples, 2, 48_000, 440, { start: 1.1, end: 1.8 })
		const power880 = measureFrequencyPower(samples, 2, 48_000, 880, { start: 1.1, end: 1.8 })
		expect(power880).toBeGreaterThan(0.001)
		expect(power880).toBeGreaterThan(power440 * 3)
	})

	test('gain and pan edits are measurable in decoded PCM', async ({ page }) => {
		await page.goto('/')
		await createProjectFromMenu(page)

		const imageFile = await createSolidPngFile(page, 'gain-pan-green.png', '#16a34a')
		const audioFile = createToneWavFile({
			name: 'gain-pan-tone.wav',
			durationSeconds: 1,
			segments: [{ start: 0, end: 1, frequency: 440 }],
		})
		await importMediaFiles(page, [imageFile, audioFile])
		await addResourceToTimeline(page, audioFile.name)
		await selectTimelineClip(page, /gain-pan-tone\.wav/i)

		await setSelectedAudio(page, { gain: 1, pan: 0 })
		const fullGainPath = await exportProject(page)
		const fullGain = (await analyzeExportedAudio(fullGainPath)).analysis

		await selectTimelineClip(page, /gain-pan-tone\.wav/i)
		await setSelectedAudio(page, { gain: 0.5, pan: 0 })
		const halfGainPath = await exportProject(page)
		const halfGain = (await analyzeExportedAudio(halfGainPath)).analysis
		expect(halfGain.rms / fullGain.rms).toBeGreaterThan(0.35)
		expect(halfGain.rms / fullGain.rms).toBeLessThan(0.75)

		await selectTimelineClip(page, /gain-pan-tone\.wav/i)
		await setSelectedAudio(page, { gain: 1, pan: -1 })
		const leftPath = await exportProject(page)
		const left = (await analyzeExportedAudio(leftPath)).analysis
		expect(left.leftRms).toBeGreaterThan(left.rightRms * 3)

		await selectTimelineClip(page, /gain-pan-tone\.wav/i)
		await setSelectedAudio(page, { gain: 1, pan: 1 })
		const rightPath = await exportProject(page)
		const right = (await analyzeExportedAudio(rightPath)).analysis
		expect(right.rightRms).toBeGreaterThan(right.leftRms * 3)
	})

	test('selected trimmed audio export starts from the source in-point', async ({ page }) => {
		await page.goto('/')
		await createProjectFromMenu(page)

		const audioFile = createToneWavFile({
			name: 'trimmed-two-tone.wav',
			durationSeconds: 2,
			segments: [
				{ start: 0, end: 1, frequency: 440 },
				{ start: 1, end: 2, frequency: 880 },
			],
		})
		await importMediaFiles(page, [audioFile])
		await selectTimelineClip(page, /trimmed-two-tone\.wav/i)

		const inspector = page.getByRole('complementary', { name: 'Inspector' })
		await inspector.getByRole('button', { name: 'Start +0.5s' }).click()
		await inspector.getByRole('button', { name: 'Start +0.5s' }).click()
		const exportPath = await exportSelectedClip(page)
		const { samples, analysis } = await analyzeExportedAudio(exportPath, { windowSeconds: 0.25 })
		expect(analysis.duration).toBeGreaterThan(0.8)
		const power440 = measureFrequencyPower(samples, 2, 48_000, 440, { start: 0.1, end: 0.7 })
		const power880 = measureFrequencyPower(samples, 2, 48_000, 880, { start: 0.1, end: 0.7 })
		expect(power880).toBeGreaterThan(power440 * 3)
	})

	test('overlapping audio clips mix both tones without clipping', async ({ page }) => {
		await page.goto('/')
		await createProjectFromMenu(page)

		const imageFile = await createSolidPngFile(page, 'mix-green.png', '#16a34a')
		const toneA = createToneWavFile({
			name: 'mix-tone-a.wav',
			durationSeconds: 1,
			segments: [{ start: 0, end: 1, frequency: 440, leftGain: 0.55, rightGain: 0.55 }],
		})
		const toneB = createToneWavFile({
			name: 'mix-tone-b.wav',
			durationSeconds: 1,
			segments: [{ start: 0, end: 1, frequency: 880, leftGain: 0.55, rightGain: 0.55 }],
		})
		await importMediaFiles(page, [imageFile, toneA, toneB])
		await addResourceToTimeline(page, toneA.name)
		await addResourceToTimeline(page, toneB.name)

		const secondClip = page.getByRole('region', { name: 'Timeline' }).getByRole('button', { name: /mix-tone-b\.wav/i }).first()
		const box = await secondClip.boundingBox()
		expect(box).not.toBeNull()
		if (!box) {
			return
		}
		await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
		await page.mouse.down()
		await page.mouse.move(box.x + box.width / 2 - timelineZoomPxPerSecond * 0.75, box.y + box.height / 2, { steps: 6 })
		await page.mouse.up()
		await expect(secondClip).toContainText(/0\.3s/)

		const exportPath = await exportProject(page)
		const { samples, analysis } = await analyzeExportedAudio(exportPath, { windowSeconds: 0.25 })
		expect(analysis.peak).toBeLessThanOrEqual(1)
		const power440 = measureFrequencyPower(samples, 2, 48_000, 440, { start: 0.35, end: 0.9 })
		const power880 = measureFrequencyPower(samples, 2, 48_000, 880, { start: 0.35, end: 0.9 })
		expect(power440).toBeGreaterThan(0.001)
		expect(power880).toBeGreaterThan(0.001)
	})

	test('overlapping audio clips preserve independent gain and pan in one mixed export', async ({ page }) => {
		await page.goto('/')
		await createProjectFromMenu(page)

		const imageFile = await createSolidPngFile(page, 'combo-green.png', '#16a34a')
		const toneA = createToneWavFile({
			name: 'combo-tone-left-440.wav',
			durationSeconds: 1,
			segments: [{ start: 0, end: 1, frequency: 440 }],
		})
		const toneB = createToneWavFile({
			name: 'combo-tone-right-880.wav',
			durationSeconds: 1,
			segments: [{ start: 0, end: 1, frequency: 880 }],
		})
		await importMediaFiles(page, [imageFile, toneA, toneB])
		await addResourceToTimeline(page, toneA.name)
		await addResourceToTimeline(page, toneB.name)

		await selectTimelineClip(page, /combo-tone-left-440\.wav/i)
		await setSelectedAudio(page, { gain: 0.8, pan: -1 })
		await selectTimelineClip(page, /combo-tone-right-880\.wav/i)
		await setSelectedAudio(page, { gain: 0.5, pan: 1 })

		const rightClip = page.getByRole('region', { name: 'Timeline' }).getByRole('button', { name: /combo-tone-right-880\.wav/i }).first()
		const box = await rightClip.boundingBox()
		expect(box).not.toBeNull()
		if (!box) {
			return
		}
		await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
		await page.mouse.down()
		await page.mouse.move(box.x + box.width / 2 - timelineZoomPxPerSecond * 0.75, box.y + box.height / 2, { steps: 6 })
		await page.mouse.up()
		await expect(rightClip).toContainText(/0\.3s/)

		const exportPath = await exportProject(page)
		const { samples, analysis } = await analyzeExportedAudio(exportPath, { windowSeconds: 0.25 })
		expect(analysis.peak).toBeLessThanOrEqual(1)
		const left440 = measureChannelFrequencyPower(samples, 2, 48_000, 440, 0, { start: 0.35, end: 0.9 })
		const right440 = measureChannelFrequencyPower(samples, 2, 48_000, 440, 1, { start: 0.35, end: 0.9 })
		const left880 = measureChannelFrequencyPower(samples, 2, 48_000, 880, 0, { start: 0.35, end: 0.9 })
		const right880 = measureChannelFrequencyPower(samples, 2, 48_000, 880, 1, { start: 0.35, end: 0.9 })
		expect(left440).toBeGreaterThan(0.001)
		expect(right880).toBeGreaterThan(0.001)
		expect(left440).toBeGreaterThan(right440 * 3)
		expect(right880).toBeGreaterThan(left880 * 3)
	})

	test('overlapping visual clips preserve layer order and opacity in exported frames', async ({ page }) => {
		await page.goto('/')
		await createProjectFromMenu(page)

		const green = await createSolidPngFile(page, 'layer-green.png', '#16a34a')
		const red = await createSolidPngFile(page, 'layer-red.png', '#dc2626')
		await importMediaFiles(page, [green, red])
		await addResourceToTimeline(page, red.name)

		const redClip = page.getByRole('region', { name: 'Timeline' }).getByRole('button', { name: /layer-red\.png/i }).first()
		const box = await redClip.boundingBox()
		expect(box).not.toBeNull()
		if (!box) {
			return
		}
		await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
		await page.mouse.down()
		await page.mouse.move(box.x + box.width / 2 - timelineZoomPxPerSecond * 0.75, box.y + box.height / 2, { steps: 6 })
		await page.mouse.up()
		await redClip.click()
		await setSelectedOpacity(page, 50)

		const exportPath = await exportProject(page)
		const [redChannel, greenChannel, blueChannel] = await sampleVideoFramePixelRgba(exportPath, { time: 0.5, x: 640, y: 360 })
		expect(redChannel).toBeGreaterThan(80)
		expect(greenChannel).toBeGreaterThan(60)
		expect(redChannel).toBeGreaterThan(blueChannel + 20)
		expect(greenChannel).toBeGreaterThan(blueChannel + 20)
	})

	test('fade settings change exported frame opacity over clip time', async ({ page }) => {
		await page.goto('/')
		await createProjectFromMenu(page)

		const red = await createSolidPngFile(page, 'fade-red.png', '#dc2626')
		await importMediaFiles(page, [red])
		await selectTimelineClip(page, /fade-red\.png/i)
		const inspector = page.getByRole('complementary', { name: 'Inspector' })
		await inspector.getByRole('button', { name: 'Fade in +0.5s' }).click()
		await inspector.getByRole('button', { name: 'Fade out +0.5s' }).click()

		const exportPath = await exportProject(page)
		const early = await sampleVideoFramePixelRgba(exportPath, { time: 0.05, x: 640, y: 360 })
		const middle = await sampleVideoFramePixelRgba(exportPath, { time: 0.5, x: 640, y: 360 })
		const late = await sampleVideoFramePixelRgba(exportPath, { time: 0.95, x: 640, y: 360 })
		expect(middle[0]).toBeGreaterThan(early[0] + 40)
		expect(middle[0]).toBeGreaterThan(late[0] + 40)
	})

	test('transform settings move pixels in exported frames', async ({ page }) => {
		await page.goto('/')
		await createProjectFromMenu(page)

		const red = await createSolidPngFile(page, 'transform-red.png', '#dc2626')
		await importMediaFiles(page, [red])
		await selectTimelineClip(page, /transform-red\.png/i)
		await setSelectedTransform(page, { X: 500 })

		const exportPath = await exportProject(page)
		const center = await sampleVideoFramePixelRgba(exportPath, { time: 0.5, x: 640, y: 360 })
		const shifted = await sampleVideoFramePixelRgba(exportPath, { time: 0.5, x: 1000, y: 360 })
		expect(center[0]).toBeLessThan(80)
		expect(shifted[0]).toBeGreaterThan(140)
		expect(shifted[0]).toBeGreaterThan(shifted[1] + 40)
	})

	test('tint effect is visible in exported frame pixels', async ({ page }) => {
		await page.goto('/')
		await createProjectFromMenu(page)

		const gray = await createSolidPngFile(page, 'effect-gray.png', '#808080')
		await importMediaFiles(page, [gray])
		await selectTimelineClip(page, /effect-gray\.png/i)
		await addSelectedEffect(page, 'Tint')

		const exportPath = await exportProject(page)
		const [redChannel, greenChannel, blueChannel] = await sampleVideoFramePixelRgba(exportPath, { time: 0.5, x: 640, y: 360 })
		expect(redChannel).toBeGreaterThan(blueChannel + 20)
		expect(greenChannel).toBeGreaterThan(blueChannel + 10)
	})

	test('audio gaps remain silent between separated clips in the exported file', async ({ page }) => {
		await page.goto('/')
		await createProjectFromMenu(page)

		const image = await createSolidPngFile(page, 'gap-green.png', '#16a34a')
		const firstTone = createToneWavFile({
			name: 'gap-tone-a.wav',
			durationSeconds: 1,
			segments: [{ start: 0, end: 1, frequency: 440 }],
		})
		const secondTone = createToneWavFile({
			name: 'gap-tone-b.wav',
			durationSeconds: 1,
			segments: [{ start: 0, end: 1, frequency: 880 }],
		})
		await importMediaFiles(page, [image, firstTone, secondTone])
		await addResourceToTimeline(page, firstTone.name)
		await addResourceToTimeline(page, secondTone.name)
		await selectTimelineClip(page, /gap-tone-b\.wav/i)
		await nudgeSelectedClip(page, 1)

		const exportPath = await exportProject(page)
		const { analysis } = await analyzeExportedAudio(exportPath, { windowSeconds: 0.1 })
		const activeA = analysis.windows.filter((window) => window.start >= 0.2 && window.end <= 0.8)
		const gap = analysis.windows.filter((window) => window.start >= 1.1 && window.end <= 1.4)
		const activeB = analysis.windows.filter((window) => window.start >= 1.7 && window.end <= 2.3)
		expect(Math.max(...activeA.map((window) => window.rms))).toBeGreaterThan(0.01)
		expect(Math.max(...gap.map((window) => window.rms))).toBeLessThan(0.002)
		expect(Math.max(...activeB.map((window) => window.rms))).toBeGreaterThan(0.01)
	})

	test('multiple separated audio regions keep every inactive window silent', async ({ page }) => {
		await page.goto('/')
		await createProjectFromMenu(page)

		const image = await createSolidPngFile(page, 'multi-gap-green.png', '#16a34a')
		const firstTone = createToneWavFile({
			name: 'multi-gap-tone-a.wav',
			durationSeconds: 1,
			segments: [{ start: 0, end: 1, frequency: 330 }],
		})
		const secondTone = createToneWavFile({
			name: 'multi-gap-tone-b.wav',
			durationSeconds: 1,
			segments: [{ start: 0, end: 1, frequency: 550 }],
		})
		const thirdTone = createToneWavFile({
			name: 'multi-gap-tone-c.wav',
			durationSeconds: 1,
			segments: [{ start: 0, end: 1, frequency: 770 }],
		})
		await importMediaFiles(page, [image, firstTone, secondTone, thirdTone])
		await addResourceToTimeline(page, firstTone.name)
		await addResourceToTimeline(page, secondTone.name)
		await addResourceToTimeline(page, thirdTone.name)
		await selectTimelineClip(page, /multi-gap-tone-b\.wav/i)
		await nudgeSelectedClip(page, 1)
		await selectTimelineClip(page, /multi-gap-tone-c\.wav/i)
		await nudgeSelectedClip(page, 2)

		const exportPath = await exportProject(page)
		const { analysis } = await analyzeExportedAudio(exportPath, { windowSeconds: 0.1 })
		const windowPeak = (start: number, end: number): number => Math.max(...analysis.windows
			.filter((window) => window.start >= start && window.end <= end)
			.map((window) => window.rms))

		expect(windowPeak(0.2, 0.8)).toBeGreaterThan(0.01)
		expect(windowPeak(1.1, 1.4)).toBeLessThan(0.002)
		expect(windowPeak(1.7, 2.3)).toBeGreaterThan(0.01)
		expect(windowPeak(2.6, 2.9)).toBeLessThan(0.002)
		expect(windowPeak(3.2, 3.8)).toBeGreaterThan(0.01)
	})

	test('selected audio clip export excludes unrelated timeline audio', async ({ page }) => {
		await page.goto('/')
		await createProjectFromMenu(page)

		const firstTone = createToneWavFile({
			name: 'range-tone-440.wav',
			durationSeconds: 1,
			segments: [{ start: 0, end: 1, frequency: 440 }],
		})
		const secondTone = createToneWavFile({
			name: 'range-tone-880.wav',
			durationSeconds: 1,
			segments: [{ start: 0, end: 1, frequency: 880 }],
		})
		await importMediaFiles(page, [firstTone, secondTone])
		await addResourceToTimeline(page, secondTone.name)
		await selectTimelineClip(page, /range-tone-440\.wav/i)

		const exportPath = await exportSelectedClip(page)
		const { samples } = await analyzeExportedAudio(exportPath)
		const power440 = measureFrequencyPower(samples, 2, 48_000, 440, { start: 0.1, end: 0.8 })
		const power880 = measureFrequencyPower(samples, 2, 48_000, 880, { start: 0.1, end: 0.8 })
		expect(power440).toBeGreaterThan(0.001)
		expect(power880).toBeLessThan(power440 * 0.2)
	})
})
