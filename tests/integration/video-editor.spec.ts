import { expect, test } from '@playwright/test'
import fs from 'node:fs/promises'
import path from 'node:path'

const timelineTimeOriginPx = 167

const createProjectFromMenu = async (page: import('@playwright/test').Page) => {
	const projectsRegion = page.getByLabel('Projects')
	await projectsRegion.getByRole('button').click()
	await projectsRegion.getByRole('button', { name: 'New project' }).click()
	await expect(projectsRegion.getByRole('button', { name: /Project \d+/i })).toBeVisible()
}

const importFixtureMedia = async (page: import('@playwright/test').Page) => {
	const importInput = page.getByLabel('Import media files')
	await expect(importInput).toBeEnabled()
	await importInput.setInputFiles([
		path.resolve('tests/fixtures/media/fixture-video.webm'),
		path.resolve('tests/fixtures/media/fixture-image.png'),
		path.resolve('tests/fixtures/media/fixture-audio.wav'),
	])
}

const importFixtureVideo = async (page: import('@playwright/test').Page) => {
	await page.getByLabel('Import media files').setInputFiles(path.resolve('tests/fixtures/media/fixture-video.webm'))
}

const createSolidPngFile = async (
	page: import('@playwright/test').Page,
	name: string,
	fillStyle: string,
): Promise<{ name: string; mimeType: string; buffer: Buffer }> => {
	const bytes = await page.evaluate(async (color) => {
		const canvas = document.createElement('canvas')
		canvas.width = 80
		canvas.height = 80
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

const createSolidVideoFile = async (
	page: import('@playwright/test').Page,
): Promise<{ name: string; mimeType: string; buffer: Buffer }> => {
	const result = await page.evaluate(async () => {
		const mimeType = ['video/webm;codecs=vp8,opus', 'video/webm;codecs=vp8', 'video/webm']
			.find((candidate) => MediaRecorder.isTypeSupported(candidate))
		if (!mimeType) {
			throw new Error('MediaRecorder WebM is not supported in this browser')
		}

		const canvas = document.createElement('canvas')
		canvas.width = 80
		canvas.height = 80
		const context = canvas.getContext('2d')
		if (!context) {
			throw new Error('Unable to create video fixture canvas')
		}
		const stream = canvas.captureStream(8)
		const videoTrack = stream.getVideoTracks()[0] as CanvasCaptureMediaStreamTrack | undefined
		const audioContext = new AudioContext()
		await audioContext.resume().catch(() => undefined)
		const oscillator = audioContext.createOscillator()
		const gain = audioContext.createGain()
		const destination = audioContext.createMediaStreamDestination()
		oscillator.frequency.value = 220
		gain.gain.value = 0.02
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
		for (let frame = 0; frame < 12; frame += 1) {
			context.fillStyle = '#e11d48'
			context.fillRect(0, 0, canvas.width, canvas.height)
			videoTrack?.requestFrame?.()
			await new Promise((resolve) => setTimeout(resolve, 125))
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
	})

	return { name: 'solid-red-video.webm', mimeType: result.mimeType, buffer: Buffer.from(result.bytes) }
}

const createToneWavFile = (name = 'solid-tone.wav'): { name: string; mimeType: string; buffer: Buffer } => {
	const sampleRate = 44_100
	const durationSeconds = 1
	const sampleCount = sampleRate * durationSeconds
	const bytesPerSample = 2
	const buffer = Buffer.alloc(44 + sampleCount * bytesPerSample)
	buffer.write('RIFF', 0)
	buffer.writeUInt32LE(36 + sampleCount * bytesPerSample, 4)
	buffer.write('WAVE', 8)
	buffer.write('fmt ', 12)
	buffer.writeUInt32LE(16, 16)
	buffer.writeUInt16LE(1, 20)
	buffer.writeUInt16LE(1, 22)
	buffer.writeUInt32LE(sampleRate, 24)
	buffer.writeUInt32LE(sampleRate * bytesPerSample, 28)
	buffer.writeUInt16LE(bytesPerSample, 32)
	buffer.writeUInt16LE(16, 34)
	buffer.write('data', 36)
	buffer.writeUInt32LE(sampleCount * bytesPerSample, 40)

	for (let index = 0; index < sampleCount; index += 1) {
		const sample = Math.round(Math.sin((index / sampleRate) * Math.PI * 2 * 440) * 0x1fff)
		buffer.writeInt16LE(sample, 44 + index * bytesPerSample)
	}

	return { name, mimeType: 'audio/wav', buffer }
}

const sampleWebmFrame = async (
	page: import('@playwright/test').Page,
	buffer: Buffer,
): Promise<{ duration: number; rgba: [number, number, number, number]; audioTrackCount: number; audioRms: number }> =>
	page.evaluate(async (bytes) => {
		const blob = new Blob([new Uint8Array(bytes)], { type: 'video/webm' })
		const url = URL.createObjectURL(blob)
		const video = document.createElement('video')
		video.muted = true
		video.playsInline = true
		video.preload = 'auto'
		video.src = url
		video.style.cssText = 'position:fixed;left:-9999px;top:-9999px;width:80px;height:80px;'
		document.body.append(video)

		try {
			await new Promise<void>((resolve, reject) => {
				const timeout = window.setTimeout(() => reject(new Error('Exported video metadata timed out')), 3000)
				video.addEventListener('loadedmetadata', () => {
					window.clearTimeout(timeout)
					resolve()
				}, { once: true })
				video.addEventListener('error', () => reject(new Error('Exported video failed to load')), { once: true })
			})
			const duration = Number.isFinite(video.duration) ? video.duration : 0
			const capturedStream = 'captureStream' in video ? video.captureStream() : null
			const audioTrackCount = capturedStream?.getAudioTracks().length ?? 0
			let audioRms = 0
			if (audioTrackCount > 0) {
				const AudioContextConstructor = window.AudioContext ?? window.webkitAudioContext
				if (AudioContextConstructor) {
					const audioContext = new AudioContextConstructor()
					const decodedAudio = await audioContext.decodeAudioData(new Uint8Array(bytes).buffer.slice(0)).catch(() => null)
					if (decodedAudio) {
						const channel = decodedAudio.getChannelData(0)
						const step = Math.max(1, Math.floor(channel.length / 20_000))
						let sum = 0
						let count = 0
						for (let index = 0; index < channel.length; index += step) {
							sum += channel[index] * channel[index]
							count += 1
						}
						audioRms = count > 0 ? Math.sqrt(sum / count) : 0
					}
					await audioContext.close().catch(() => undefined)
				}
			}
			const targetTime = Math.max(0, duration - 0.25)
			await new Promise<void>((resolve) => {
				const timeout = window.setTimeout(() => resolve(), 1500)
				video.addEventListener('seeked', () => {
					window.clearTimeout(timeout)
					resolve()
				}, { once: true })
				video.currentTime = targetTime
			})

			const canvas = document.createElement('canvas')
			canvas.width = 80
			canvas.height = 80
			const context = canvas.getContext('2d')
			if (!context) {
				throw new Error('Unable to sample exported video frame')
			}
			context.drawImage(video, 0, 0, canvas.width, canvas.height)
			const data = Array.from(context.getImageData(40, 40, 1, 1).data) as [number, number, number, number]
			for (const track of capturedStream?.getTracks() ?? []) {
				track.stop()
			}
			return { duration, rgba: data, audioTrackCount, audioRms }
		} finally {
			video.remove()
			URL.revokeObjectURL(url)
		}
	}, Array.from(buffer))

const installExportPathProbe = async (page: import('@playwright/test').Page): Promise<void> => {
	await page.addInitScript(() => {
		const target = window as Window & { __minicutMediaRecorderCount?: number }
		target.__minicutMediaRecorderCount = 0
		const OriginalMediaRecorder = window.MediaRecorder
		if (!OriginalMediaRecorder) {
			return
		}

		class InstrumentedMediaRecorder extends OriginalMediaRecorder {
			constructor(stream: MediaStream, options?: MediaRecorderOptions) {
				super(stream, options)
				target.__minicutMediaRecorderCount = (target.__minicutMediaRecorderCount ?? 0) + 1
			}
		}

		Object.defineProperty(InstrumentedMediaRecorder, 'isTypeSupported', {
			value: OriginalMediaRecorder.isTypeSupported.bind(OriginalMediaRecorder),
		})
		window.MediaRecorder = InstrumentedMediaRecorder as typeof MediaRecorder
	})
}

const supportsWebCodecsAudio = async (page: import('@playwright/test').Page): Promise<boolean> =>
	page.evaluate(async () => {
		if (typeof VideoEncoder === 'undefined' || typeof AudioEncoder === 'undefined' || typeof AudioData === 'undefined') {
			return false
		}

		try {
			const videoSupport = await VideoEncoder.isConfigSupported({
				codec: 'vp8',
				width: 80,
				height: 80,
				bitrate: 500_000,
				framerate: 8,
			})
			const audioSupport = await AudioEncoder.isConfigSupported({
				codec: 'opus',
				numberOfChannels: 2,
				sampleRate: 48_000,
				bitrate: 128_000,
			})
			return videoSupport.supported && audioSupport.supported
		} catch {
			return false
		}
	})

const expectExportPathForAudio = async (
	page: import('@playwright/test').Page,
	mode: 'prefer-webcodecs' | 'allow-fallback' = 'allow-fallback',
): Promise<void> => {
	const mediaRecorderCount = await page.evaluate(() => {
		const target = window as Window & { __minicutMediaRecorderCount?: number }
		return target.__minicutMediaRecorderCount ?? 0
	})
	const webCodecsAudioAvailable = await supportsWebCodecsAudio(page)
	if (mode === 'prefer-webcodecs' && webCodecsAudioAvailable) {
		expect(mediaRecorderCount).toBe(0)
		return
	}

	if (webCodecsAudioAvailable && mediaRecorderCount === 0) {
		return
	}

	expect(mediaRecorderCount).toBeGreaterThan(0)
}

const setTimelineCursor = async (
	page: import('@playwright/test').Page,
	seconds: number,
): Promise<void> => {
	const timeline = page.getByRole('region', { name: 'Timeline' })
	const zoomText = await timeline.getByText(/px\/s$/i).first().textContent()
	const zoom = Number.parseFloat((zoomText ?? '56').replace(/[^0-9.]/g, '')) || 56
	const laneScroll = timeline.locator('.ve-track-lane-scroll')
	const laneBox = await laneScroll.boundingBox()
	if (!laneBox) {
		throw new Error('Timeline lane scroll area is unavailable')
	}

	await laneScroll.click({
		position: {
			x: Math.max(8, seconds * zoom),
			y: Math.max(12, laneBox.height - 12),
		},
	})
}

test('user can finish the harness happy path in the browser', async ({ page }) => {
	await page.goto('/')

	await expect(page.getByRole('heading', { name: 'minicut' })).toBeVisible()
	await expect(page.getByLabel('Projects').getByRole('button', { name: /Project \d+/i })).toBeVisible()

	await createProjectFromMenu(page)
	await expect(page.getByRole('button', { name: /Project \d+/i })).toBeVisible()

	await importFixtureVideo(page)
	await expect(
		page.getByLabel('Media bin').locator('strong').filter({ hasText: 'fixture-video.webm' }),
	).toBeVisible()

	const clip = page.getByRole('button', { name: /fixture-video.webm/i }).first()
	await expect(clip).toBeVisible()

	await clip.click()
	const inspector = page.getByRole('complementary', { name: 'Inspector' })
	const opacitySlider = inspector.getByLabel('Opacity')
	await opacitySlider.focus()
	for (const value of ['90', '80', '70', '60']) {
		await opacitySlider.press('ArrowLeft')
		await expect(opacitySlider).toHaveValue(value)
	}
	await expect(inspector.getByText('Opacity 60%')).toBeVisible()
	await setTimelineCursor(page, 0.5)
	const timeline = page.getByRole('region', { name: 'Timeline' })
	const clipActions = timeline.getByLabel('Clip edit actions')

	await clipActions.getByRole('button', { name: 'Split clip' }).click()
	await expect(page.getByRole('button', { name: /fixture-video.webm/i })).toHaveCount(2)

	await clipActions.getByRole('button', { name: 'Nudge +0.5s' }).click()
	await expect(inspector.getByText(/Clip 2 - V1 - 1\.0s - Duration/)).toBeVisible()
})

test('split clip follows playhead and reflects resulting durations in timeline widths', async ({ page }) => {
	await page.goto('/')
	await createProjectFromMenu(page)
	await importFixtureVideo(page)

	const timeline = page.getByRole('region', { name: 'Timeline' })
	const clip = timeline.getByRole('button', { name: /fixture-video.webm/i }).first()
	await clip.click()
	await setTimelineCursor(page, 0.5)

	await timeline.getByLabel('Clip edit actions').getByRole('button', { name: 'Split clip' }).click()

	const clips = timeline.getByRole('button', { name: /fixture-video.webm/i })
	await expect(clips).toHaveCount(2)
	const leftWidth = await clips.nth(0).evaluate((element) => Number.parseFloat(getComputedStyle(element).width))
	const rightWidth = await clips.nth(1).evaluate((element) => Number.parseFloat(getComputedStyle(element).width))
	expect(leftWidth).toBeGreaterThan(34)
	expect(leftWidth).toBeLessThan(42)
	expect(rightWidth).toBeGreaterThan(34)
	expect(rightWidth).toBeLessThan(42)
})

test('project dropdown shows items when opened', async ({ page }) => {
	await page.goto('/')

	await createProjectFromMenu(page)
	await createProjectFromMenu(page)

	const projectsRegion = page.getByLabel('Projects')
	await projectsRegion.getByRole('button', { name: /Project \d+/i }).click()
	const projectList = projectsRegion.getByRole('list')

	await expect(projectList.getByRole('button', { name: /Project 1/i })).toBeVisible()
	await expect(projectList.getByRole('button', { name: /Project 2/i })).toBeVisible()
})

test('importing into an empty timeline auto-adds the first resource', async ({ page }) => {
	await page.goto('/')
	await createProjectFromMenu(page)

	await expect(page.getByRole('button', { name: 'Add first resource' })).toHaveCount(0)

	await importFixtureVideo(page)

	await expect(page.getByRole('button', { name: /fixture-video.webm/i }).first()).toBeVisible()
	await expect(page.getByRole('region', { name: 'Timeline' }).getByRole('button', { name: /Embedded audio/i })).toBeVisible()
})

test('video resources add linked audio clips that play, inspect, and export settings', async ({ page }) => {
	await page.goto('/')
	await createProjectFromMenu(page)
	await importFixtureVideo(page)

	const timeline = page.getByRole('region', { name: 'Timeline' })
	const audioClip = timeline.getByRole('button', { name: /Embedded audio/i })
	await expect(audioClip).toContainText('0.0s / 1.0s')
	await audioClip.click()

	const inspector = page.getByRole('complementary', { name: 'Inspector' })
	await inspector.getByRole('tab', { name: 'Audio' }).click()
	await inspector.getByLabel('Gain').fill('65')
	await expect(inspector.getByText('Gain 65%')).toBeVisible()

	await setTimelineCursor(page, 0.5)
	const renderer = page.getByLabel('Renderer stage')
	const audio = renderer.locator('audio')
	await expect(audio).toHaveCount(1)
	await expect(renderer.locator('.ve-renderer__layer--audio')).toHaveCount(0)
	await expect(renderer.getByLabel('Audio preview')).toHaveCount(0)
	await expect(audio).not.toHaveAttribute('controls', '')
	await expect(audio).toHaveAttribute('data-resource-name', 'fixture-video.webm')
	await expect(audio).toHaveAttribute('data-gain', '0.65')
	await expect(audio).toHaveAttribute('data-pan', '0')
	await expect.poll(async () => audio.evaluate((element) => (element as HTMLAudioElement).volume)).toBeCloseTo(0.65, 2)
	await page.getByRole('region', { name: 'Preview panel' }).getByRole('button', { name: 'Play' }).click()
	await expect.poll(async () => audio.evaluate((element) => (element as HTMLAudioElement).currentTime)).toBeGreaterThan(0.5)
	await page.getByRole('region', { name: 'Preview panel' }).getByRole('button', { name: 'Pause' }).click()

	const downloadPromise = page.waitForEvent('download')
	await page.getByRole('button', { name: 'Export project' }).click()
	const download = await downloadPromise
	const downloadPath = await download.path()
	expect(downloadPath).toBeTruthy()
	const videoBytes = await fs.readFile(downloadPath as string)
	expect(videoBytes.length).toBeGreaterThan(1000)
})

test('exports generated solid video, trailing image, and audio with audible output', async ({ page }) => {
	await installExportPathProbe(page)

	await page.goto('/')
	await createProjectFromMenu(page)

	const videoFile = await createSolidVideoFile(page)
	const imageFile = await createSolidPngFile(page, 'solid-green-image.png', '#16a34a')
	const audioFile = createToneWavFile()

	await page.getByLabel('Import media files').setInputFiles(videoFile)
	const timeline = page.getByRole('region', { name: 'Timeline' })
	const mediaBin = page.getByLabel('Media bin')
	const videoClip = timeline.getByRole('button', { name: /solid-red-video.webm/i }).first()
	await expect(videoClip).toBeVisible()
	await expect(timeline.getByRole('button', { name: /Embedded audio/i })).toBeVisible()

	await page.getByLabel('Import media files').setInputFiles([imageFile, audioFile])
	await expect(mediaBin.locator('strong').filter({ hasText: 'solid-green-image.png' })).toBeVisible()
	await expect(mediaBin.locator('strong').filter({ hasText: 'solid-tone.wav' })).toBeVisible()
	await mediaBin.locator('.ve-resource-row').filter({ hasText: 'solid-green-image.png' }).getByRole('button', { name: 'Add to timeline' }).click()
	await mediaBin.locator('.ve-resource-row').filter({ hasText: 'solid-tone.wav' }).getByRole('button', { name: 'Add to timeline' }).click()
	await expect(timeline.getByRole('button', { name: /solid-green-image.png/i })).toBeVisible()
	await expect(timeline.getByRole('button', { name: /solid-tone.wav/i })).toBeVisible()

	await videoClip.click()
	await page.getByRole('complementary', { name: 'Inspector' }).getByRole('button', { name: 'Start +0.5s' }).click()
	await expect(videoClip).toHaveText(/0\.5s/)

	const downloadPromise = page.waitForEvent('download')
	await page.getByRole('button', { name: 'Export project' }).click()
	const download = await downloadPromise
	const downloadPath = await download.path()
	expect(downloadPath).toBeTruthy()
	const exportedBytes = await fs.readFile(downloadPath as string)
	expect(exportedBytes.length).toBeGreaterThan(1000)
	await expectExportPathForAudio(page, 'allow-fallback')

	const sample = await sampleWebmFrame(page, exportedBytes)
	expect(sample.duration).toBeGreaterThan(1.4)
	expect(sample.duration).toBeLessThan(3.2)
	expect(sample.audioTrackCount).toBeGreaterThan(0)
	expect(sample.audioRms).toBeGreaterThan(0.001)
	expect(exportedBytes.includes(Buffer.from('A_OPUS')) || exportedBytes.includes(Buffer.from('A_VORBIS'))).toBe(true)
	expect(sample.rgba[1]).toBeGreaterThan(120)
	expect(sample.rgba[1]).toBeGreaterThan(sample.rgba[0] + 30)
	expect(sample.rgba[1]).toBeGreaterThan(sample.rgba[2] + 30)
})

test('exports image plus wav audio via WebCodecs when available', async ({ page }) => {
	await installExportPathProbe(page)
	await page.goto('/')
	await createProjectFromMenu(page)

	const imageFile = await createSolidPngFile(page, 'webcodecs-green-image.png', '#16a34a')
	const audioFile = createToneWavFile('webcodecs-tone.wav')
	await page.getByLabel('Import media files').setInputFiles([imageFile, audioFile])

	const timeline = page.getByRole('region', { name: 'Timeline' })
	const mediaBin = page.getByLabel('Media bin')
	await expect(timeline.getByRole('button', { name: /webcodecs-green-image.png/i })).toBeVisible()
	await expect(mediaBin.locator('strong').filter({ hasText: 'webcodecs-tone.wav' })).toBeVisible()
	if (await timeline.getByRole('button', { name: /webcodecs-tone.wav/i }).count() === 0) {
		await mediaBin.locator('.ve-resource-row').filter({ hasText: 'webcodecs-tone.wav' }).getByRole('button', { name: 'Add to timeline' }).click()
	}
	await expect(timeline.getByRole('button', { name: /webcodecs-tone.wav/i })).toBeVisible()

	const downloadPromise = page.waitForEvent('download')
	await page.getByRole('button', { name: 'Export project' }).click()
	const download = await downloadPromise
	const downloadPath = await download.path()
	expect(downloadPath).toBeTruthy()
	const exportedBytes = await fs.readFile(downloadPath as string)
	expect(exportedBytes.length).toBeGreaterThan(1000)
	await expectExportPathForAudio(page, 'prefer-webcodecs')

	const sample = await sampleWebmFrame(page, exportedBytes)
	expect(sample.audioTrackCount).toBeGreaterThan(0)
	expect(sample.audioRms).toBeGreaterThan(0.001)
	expect(sample.rgba[1]).toBeGreaterThan(120)
	expect(sample.rgba[1]).toBeGreaterThan(sample.rgba[0] + 30)
	expect(sample.rgba[1]).toBeGreaterThan(sample.rgba[2] + 30)
})

test('imports a video with embedded audio as linked tracks and exports audible audio', async ({ page }) => {
	await page.addInitScript(() => {
		const descriptor = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'currentTime')
		if (!descriptor?.get || !descriptor.set) {
			return
		}
		const originalPlay = HTMLMediaElement.prototype.play
		const writes: Array<{ tag: string; value: number }> = []
		const playCalls: string[] = []
		Object.defineProperty(window, '__previewCurrentTimeWrites', { value: writes, configurable: true })
		Object.defineProperty(window, '__previewPlayCalls', { value: playCalls, configurable: true })
		Object.defineProperty(HTMLMediaElement.prototype, 'currentTime', {
			configurable: descriptor.configurable,
			enumerable: descriptor.enumerable,
			get: descriptor.get,
			set(value: number) {
				writes.push({ tag: this.tagName.toLowerCase(), value })
				descriptor.set?.call(this, value)
			},
		})
		HTMLMediaElement.prototype.play = function play() {
			playCalls.push(this.tagName.toLowerCase())
			return originalPlay.call(this)
		}
	})
	await installExportPathProbe(page)

	await page.goto('/')
	await createProjectFromMenu(page)

	const videoFile = await createSolidVideoFile(page)
	await page.getByLabel('Import media files').setInputFiles(videoFile)

	const timeline = page.getByRole('region', { name: 'Timeline' })
	const videoClip = timeline.getByRole('button', { name: /solid-red-video.webm/i }).first()
	const embeddedAudioClip = timeline.getByRole('button', { name: /Embedded audio/i }).first()
	await expect(videoClip).toBeVisible()
	await expect(embeddedAudioClip).toBeVisible()
	const parseStartDuration = (text: string): { start: number; duration: number } | null => {
		const match = text.match(/·\s*(\d+(?:\.\d+)?)s\s*\/\s*(\d+(?:\.\d+)?)s/)
		if (!match) {
			return null
		}
		return { start: Number(match[1]), duration: Number(match[2]) }
	}
	const videoTiming = parseStartDuration(await videoClip.innerText())
	const audioTiming = parseStartDuration(await embeddedAudioClip.innerText())
	expect(videoTiming).not.toBeNull()
	expect(audioTiming).not.toBeNull()
	expect(videoTiming?.start ?? -1).toBe(0)
	expect(audioTiming?.start ?? -1).toBe(0)
	expect(videoTiming?.duration ?? 0).toBeGreaterThan(1.3)
	expect(Math.abs((videoTiming?.duration ?? 0) - (audioTiming?.duration ?? 0))).toBeLessThan(0.2)

	await setTimelineCursor(page, 0.4)
	await page.evaluate(() => {
		const instrumentedWindow = window as Window & {
			__previewCurrentTimeWrites?: Array<{ tag: string; value: number }>
			__previewPlayCalls?: string[]
		}
		instrumentedWindow.__previewCurrentTimeWrites?.splice(0)
		instrumentedWindow.__previewPlayCalls?.splice(0)
	})
	await page.getByRole('region', { name: 'Preview panel' }).getByRole('button', { name: 'Play' }).click()
	const previewAudio = page.getByLabel('Renderer stage').locator('audio').first()
	await expect.poll(async () => previewAudio.evaluate((element) => (element as HTMLAudioElement).currentTime)).toBeGreaterThan(0.45)
	const audioSyncStats = await page.evaluate(() => {
		const instrumentedWindow = window as Window & {
			__previewCurrentTimeWrites?: Array<{ tag: string; value: number }>
			__previewPlayCalls?: string[]
		}
		return {
			seekWrites: instrumentedWindow.__previewCurrentTimeWrites?.filter((write) => write.tag === 'audio').length ?? 0,
			playCalls: instrumentedWindow.__previewPlayCalls?.filter((tag) => tag === 'audio').length ?? 0,
		}
	})
	expect(audioSyncStats.seekWrites).toBeLessThanOrEqual(3)
	expect(audioSyncStats.playCalls).toBeLessThanOrEqual(2)
	await page.getByRole('region', { name: 'Preview panel' }).getByRole('button', { name: 'Pause' }).click()
	await expect.poll(async () => previewAudio.evaluate((element) => (element as HTMLAudioElement).paused)).toBe(true)

	const downloadPromise = page.waitForEvent('download')
	await page.getByRole('button', { name: 'Export project' }).click()
	const download = await downloadPromise
	const downloadPath = await download.path()
	expect(downloadPath).toBeTruthy()
	const exportedBytes = await fs.readFile(downloadPath as string)
	expect(exportedBytes.length).toBeGreaterThan(1000)
	await expectExportPathForAudio(page, 'allow-fallback')

	const sample = await sampleWebmFrame(page, exportedBytes)
	expect(sample.audioTrackCount).toBeGreaterThan(0)
	expect(sample.audioRms).toBeGreaterThan(0.001)
	expect(exportedBytes.includes(Buffer.from('A_OPUS')) || exportedBytes.includes(Buffer.from('A_VORBIS'))).toBe(true)
})

test('preview playback lets video decode forward without seeking every cursor tick', async ({ page }) => {
	await page.addInitScript(() => {
		const descriptor = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'currentTime')
		if (!descriptor?.get || !descriptor.set) {
			return
		}
		const originalPlay = HTMLMediaElement.prototype.play
		const writes: Array<{ tag: string; value: number }> = []
		const playCalls: string[] = []
		Object.defineProperty(window, '__previewCurrentTimeWrites', { value: writes, configurable: true })
		Object.defineProperty(window, '__previewPlayCalls', { value: playCalls, configurable: true })
		Object.defineProperty(HTMLMediaElement.prototype, 'currentTime', {
			configurable: descriptor.configurable,
			enumerable: descriptor.enumerable,
			get: descriptor.get,
			set(value: number) {
				writes.push({ tag: this.tagName.toLowerCase(), value })
				descriptor.set?.call(this, value)
			},
		})
		HTMLMediaElement.prototype.play = function play() {
			playCalls.push(this.tagName.toLowerCase())
			return originalPlay.call(this)
		}
	})

	await page.goto('/')
	await createProjectFromMenu(page)
	await importFixtureVideo(page)
	await setTimelineCursor(page, 0.2)

	const renderer = page.getByLabel('Renderer stage')
	const video = renderer.locator('video')
	await expect(video).toHaveCount(1)
	await expect.poll(async () => video.evaluate((element) => (element as HTMLVideoElement).currentTime)).toBeGreaterThan(0.15)
	await page.evaluate(() => {
		const instrumentedWindow = window as Window & {
			__previewCurrentTimeWrites?: Array<{ tag: string; value: number }>
			__previewPlayCalls?: string[]
		}
		instrumentedWindow.__previewCurrentTimeWrites?.splice(0)
		instrumentedWindow.__previewPlayCalls?.splice(0)
	})

	await page.getByRole('region', { name: 'Preview panel' }).getByRole('button', { name: 'Play' }).click()
	await expect.poll(async () => video.evaluate((element) => (element as HTMLVideoElement).currentTime)).toBeGreaterThan(0.55)
	const videoSeekWrites = await page.evaluate(() => {
		const instrumentedWindow = window as Window & { __previewCurrentTimeWrites?: Array<{ tag: string; value: number }> }
		return instrumentedWindow.__previewCurrentTimeWrites?.filter((write) => write.tag === 'video').length ?? 0
	})
	const videoPlayCalls = await page.evaluate(() => {
		const instrumentedWindow = window as Window & { __previewPlayCalls?: string[] }
		return instrumentedWindow.__previewPlayCalls?.filter((tag) => tag === 'video').length ?? 0
	})
	expect(videoSeekWrites).toBeLessThanOrEqual(2)
	expect(videoPlayCalls).toBeLessThanOrEqual(2)
})

test('imports real media files, edits timeline clips, and previews actual media elements', async ({ page }) => {
	await page.goto('/')
	await createProjectFromMenu(page)

	await importFixtureMedia(page)

	const mediaBin = page.getByLabel('Media bin')
	await expect(mediaBin.locator('strong').filter({ hasText: 'fixture-video.webm' })).toBeVisible()
	await expect(mediaBin.locator('strong').filter({ hasText: 'fixture-image.png' })).toBeVisible()
	await expect(mediaBin.locator('strong').filter({ hasText: 'fixture-audio.wav' })).toBeVisible()
	await expect(mediaBin.getByLabel('fixture-video.webm thumbnail')).toBeVisible()
	await expect(mediaBin.locator('img[alt="fixture-image.png thumbnail"]')).toBeVisible()
	await expect(mediaBin.getByLabel('audio thumbnail')).toBeVisible()

	const timeline = page.getByRole('region', { name: 'Timeline' })
	for (const resourceName of ['fixture-video.webm', 'fixture-image.png', 'fixture-audio.wav']) {
		if (await timeline.getByRole('button', { name: new RegExp(resourceName, 'i') }).count() === 0) {
			await mediaBin.locator('.ve-resource-row').filter({ hasText: resourceName }).getByRole('button', { name: 'Add to timeline' }).click()
		}
	}

	await expect(timeline.getByRole('button', { name: /fixture-video.webm/i })).toBeVisible()
	await expect(timeline.getByRole('button', { name: /fixture-image.png/i })).toBeVisible()
	await expect(timeline.getByRole('button', { name: /fixture-audio.wav/i })).toBeVisible()

	await timeline.getByRole('button', { name: /fixture-image.png/i }).click()
	const inspector = page.getByRole('complementary', { name: 'Inspector' })
	await inspector.getByLabel('Opacity').fill('60')
	await inspector.getByLabel('X').fill('24')
	await expect(inspector.getByText('Opacity 60%')).toBeVisible()

	await setTimelineCursor(page, 0.5)
	const renderer = page.getByLabel('Renderer stage')
	await expect(renderer.getByLabel('Offscreen preview canvas')).toHaveAttribute('data-render-mode', 'offscreen')
	await expect(renderer.locator('video')).toHaveCount(1)
	await expect.poll(async () =>
		renderer.locator('video').evaluate((element) => (element as HTMLVideoElement).currentTime),
	).toBeGreaterThan(0.4)

	const imageClipText = await timeline.getByRole('button', { name: /fixture-image.png/i }).innerText()
	const imageClipStart = Number(imageClipText.match(/· (\d+(?:\.\d+)?)s \//)?.[1] ?? 0)
	await setTimelineCursor(page, imageClipStart + 0.5)
	await expect(renderer.locator('img[alt="fixture-image.png"]')).toBeVisible()
	await expect(renderer.locator('.ve-renderer__layer--image')).toHaveCSS('opacity', '0.6')

	await setTimelineCursor(page, 0.5)
	await expect(renderer.locator('audio')).toHaveCount(1)
	await expect(renderer.locator('audio')).toHaveAttribute('data-resource-name', 'fixture-video.webm')
	await expect(renderer.locator('.ve-renderer__layer--audio')).toHaveCount(0)

	const audioClipText = await timeline.getByRole('button', { name: /fixture-audio.wav/i }).innerText()
	const audioClipStart = Number(audioClipText.match(/· (\d+(?:\.\d+)?)s \//)?.[1] ?? 0)
	await setTimelineCursor(page, audioClipStart + 0.5)
	await expect(renderer.locator('audio')).toHaveCount(1)
	await expect(renderer.locator('audio')).toHaveAttribute('data-resource-name', 'fixture-audio.wav')
})

test('timeline uses one shared current step and keeps many tracks scrollable', async ({ page }) => {
	await page.goto('/')
	await createProjectFromMenu(page)

	const timeline = page.getByRole('region', { name: 'Timeline' })
	for (let index = 0; index < 10; index += 1) {
		await timeline.getByRole('button', { name: 'Add video track' }).click()
		await timeline.getByRole('button', { name: 'Add audio track' }).click()
	}

	await expect(timeline.getByText('22 tracks')).toBeVisible()
	await setTimelineCursor(page, 8)
	await expect(timeline.getByLabel('Current step')).toHaveCount(1)
	await expect(timeline.getByLabel('Current time')).toHaveText('8.00s')

	const scrollMetrics = await timeline.locator('.ve-timeline-scroll-area').evaluate((element) => ({
		clientHeight: element.clientHeight,
		scrollHeight: element.scrollHeight,
	}))
	expect(scrollMetrics.scrollHeight).toBeGreaterThan(scrollMetrics.clientHeight)

	await timeline.locator('.ve-timeline-scroll-area').evaluate((element) => {
		element.scrollTop = element.scrollHeight
	})
	await expect(timeline.getByText('A11')).toBeVisible()
})

test('inspector feature controls combine trim, color, effects, audio, export, and delete', async ({ page }) => {
	await page.goto('/')
	await createProjectFromMenu(page)
	await importFixtureVideo(page)

	const clip = page.getByRole('button', { name: /fixture-video.webm/i }).first()
	await clip.click()
	const inspector = page.getByRole('complementary', { name: 'Inspector' })

	await inspector.getByRole('button', { name: 'Start +0.5s' }).click()
	await expect(inspector.getByText(/Clip 1 - V1 - 0\.5s - Duration/)).toBeVisible()
	await expect(inspector.getByText('In 0.5s')).toBeVisible()
	await setTimelineCursor(page, 0.5)

	await inspector.getByRole('button', { name: 'Tint' }).click()
	await expect(inspector.getByText('1 effects')).toBeVisible()
	await expect(page.getByLabel('Renderer stage').locator('.ve-renderer__layer--video')).toHaveCSS('filter', /sepia/)
	await inspector.getByRole('button', { name: 'Manage effects' }).click()
	await inspector.getByRole('button', { name: 'Remove effect Tint' }).click()
	await expect(inspector.getByText('0 effects')).toBeVisible()

	await inspector.getByRole('tab', { name: 'Color' }).click()
	await inspector.getByRole('button', { name: 'Set color #16a34a' }).click()
	await expect(inspector.locator('.ve-inspector-thumb')).toHaveCSS('border-color', 'rgb(22, 163, 74)')
	await expect(clip).toHaveCSS('border-left-color', 'rgb(22, 163, 74)')
	await expect(page.getByLabel('Renderer stage').locator('.ve-renderer__layer--video')).toHaveCSS('border-color', 'rgb(22, 163, 74)')

	await inspector.getByRole('tab', { name: 'Audio' }).click()
	await expect(inspector.getByLabel('Audio inspector').getByText('Gain')).toBeVisible()
	await expect(inspector.getByLabel('Audio inspector').getByText('Pan')).toHaveCount(0)

	await inspector.getByRole('tab', { name: 'Export' }).click()
	const exportButton = inspector.getByRole('button', { name: 'Queue clip export' })
	await expect(exportButton).toBeVisible()
	await exportButton.click()
	await expect(inspector.getByRole('status')).toHaveText(/Export ready: \d+ frames/)

	await inspector.getByRole('tab', { name: 'Edit' }).click()
	const overflowingInspectorButtons = await inspector.locator('.ve-button-grid button, .ve-inline-actions button').evaluateAll((buttons) =>
		buttons
			.filter((button) => button.scrollWidth > button.clientWidth || button.scrollHeight > button.clientHeight)
			.map((button) => button.textContent?.trim() ?? ''),
	)
	expect(overflowingInspectorButtons).toEqual([])
	await page.getByRole('region', { name: 'Timeline' }).getByLabel('Clip edit actions').getByRole('button', { name: 'Delete clip' }).click()
	await expect(page.getByText('Select a clip to edit opacity or split it.')).toBeVisible()
})

test('color grading preview exposes split compare and scopes', async ({ page }) => {
	await page.goto('/')
	await createProjectFromMenu(page)
	await importFixtureVideo(page)

	const timeline = page.getByRole('region', { name: 'Timeline' })
	const clip = timeline.getByRole('button', { name: /fixture-video.webm/i }).first()
	await clip.click()
	await setTimelineCursor(page, 0.25)
	const preview = page.getByRole('region', { name: 'Preview panel' })
	await expect(preview.getByLabel('Color scopes')).toHaveCount(0)

	const inspector = page.getByRole('complementary', { name: 'Inspector' })
	await inspector.getByRole('tab', { name: 'Color' }).click()
	await inspector.getByRole('button', { name: 'Add primary correction' }).click()
	await inspector.getByRole('button', { name: 'Warm' }).click()

	const renderer = page.getByLabel('Renderer stage')
	await expect(renderer.locator('.ve-renderer__layer--video').first()).toHaveCSS('filter', /brightness\(1\.12\)/)
	await expect(preview.getByLabel('Color scopes')).toBeVisible()
	await expect(preview.getByRole('tab', { name: 'Waveform' })).toHaveAttribute('aria-selected', 'true')
	await preview.getByRole('tab', { name: 'RGB Parade' }).click()
	await expect(preview.getByLabel('Red parade density')).toBeVisible()
	await preview.getByRole('tab', { name: 'Vectorscope' }).click()
	await expect(preview.getByLabel('Vectorscope points')).toBeVisible()
	await inspector.getByRole('tab', { name: 'Audio' }).click()
	await expect(preview.getByLabel('Color scopes')).toHaveCount(0)
	await inspector.getByRole('tab', { name: 'Color' }).click()

	await preview.getByRole('button', { name: 'Split compare' }).click()
	await expect(renderer.getByLabel('Split compare preview')).toBeVisible()
	await expect(renderer.getByText('Before')).toBeVisible()
	await expect(renderer.getByText('After')).toBeVisible()
})

test('timeline zoom controls and inspector trim boundary states behave correctly', async ({ page }) => {
	await page.goto('/')
	await createProjectFromMenu(page)
	await importFixtureVideo(page)

	const timeline = page.getByRole('region', { name: 'Timeline' })
	await expect(timeline.getByText('56 px/s')).toBeVisible()
	const zoomIn = timeline.getByRole('button', { name: 'Zoom in' })
	const zoomOut = timeline.getByRole('button', { name: 'Zoom out' })
	await zoomIn.click()
	await expect(timeline.getByText('64 px/s')).toBeVisible()
	await zoomOut.click()
	await expect(timeline.getByText('56 px/s')).toBeVisible()

	for (let index = 0; index < 20; index += 1) {
		if (await zoomIn.isDisabled()) {
			break
		}
		await zoomIn.click()
	}
	await expect(timeline.getByText('96 px/s')).toBeVisible()
	await expect(zoomIn).toBeDisabled()

	for (let index = 0; index < 30; index += 1) {
		if (await zoomOut.isDisabled()) {
			break
		}
		await zoomOut.click()
	}
	await expect(timeline.getByText('8 px/s')).toBeVisible()
	await expect(zoomOut).toBeDisabled()

	for (let index = 0; index < 6; index += 1) {
		await zoomIn.click()
	}
	await expect(timeline.getByText('56 px/s')).toBeVisible()

	const clip = timeline.getByRole('button', { name: /fixture-video.webm/i }).first()
	await clip.click()
	const inspector = page.getByRole('complementary', { name: 'Inspector' })
	await expect(inspector.getByRole('button', { name: 'Start -0.5s' })).toBeDisabled()
	await inspector.getByRole('button', { name: 'End +0.5s' }).click()
	await expect(inspector.getByText('Clip 1 - V1 - 0.0s - Duration 1.5s')).toBeVisible()
})

test('media resources render metadata and action on separate lines', async ({ page }) => {
	await page.goto('/')
	await createProjectFromMenu(page)
	await importFixtureVideo(page)

	const mediaBin = page.getByLabel('Media bin')
	const firstResource = mediaBin.locator('.ve-resource-row').filter({ hasText: 'fixture-video.webm' }).first()
	const layout = await firstResource.evaluate((row) => {
		const small = row.querySelector('small')
		const button = row.querySelector('button')
		if (!small || !button) {
			return { smallTop: 0, buttonTop: 0 }
		}

		const smallRect = small.getBoundingClientRect()
		const buttonRect = button.getBoundingClientRect()
		return {
			smallTop: smallRect.top,
			buttonTop: buttonRect.top,
		}
	})

	expect(layout.buttonTop).toBeGreaterThan(layout.smallTop)
})

test('dragging a clip changes its timeline start position', async ({ page }) => {
	await page.goto('/')
	await createProjectFromMenu(page)
	await importFixtureVideo(page)

	const clip = page.getByRole('button', { name: /fixture-video.webm/i }).first()
	await expect(clip).toHaveText(/0\.0s \/ 1\.0s/)

	const box = await clip.boundingBox()
	if (!box) {
		throw new Error('Clip bounding box is unavailable for drag simulation')
	}

	await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
	await page.mouse.down()
	await page.mouse.move(box.x + box.width / 2 + 80, box.y + box.height / 2)
	await page.mouse.up()

	await expect(clip).not.toHaveText(/0\.0s \/ 1\.0s/)
})

test('dragging a clip previews movement immediately with fine-grained timing', async ({ page }) => {
	await page.goto('/')
	await createProjectFromMenu(page)
	await importFixtureVideo(page)

	const clip = page.getByRole('button', { name: /fixture-video.webm/i }).first()
	const box = await clip.boundingBox()
	if (!box) {
		throw new Error('Clip bounding box is unavailable for drag simulation')
	}

	const initialLeft = box.x
	await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
	await page.mouse.down()
	await page.mouse.move(box.x + box.width / 2 + 14, box.y + box.height / 2)
	await expect.poll(async () => {
		const liveBox = await clip.boundingBox()
		return liveBox ? liveBox.x - initialLeft : 0
	}).toBeGreaterThan(10)
	await page.mouse.up()

	await expect(clip).toHaveText(/0\.3s \/ 1\.0s/)
})

test('resizing a clip from the right edge changes its duration', async ({ page }) => {
	await page.goto('/')
	await createProjectFromMenu(page)
	await importFixtureVideo(page)

	const clip = page.getByRole('button', { name: /fixture-video.webm/i }).first()
	await expect(clip).toHaveText(/0\.0s \/ 1\.0s/)
	const handle = clip.locator('.ve-clip__resize-handle--end')
	const box = await handle.boundingBox()
	if (!box) {
		throw new Error('Clip end resize handle bounding box is unavailable')
	}

	await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
	await page.mouse.down()
	await page.mouse.move(box.x + box.width / 2 + 28, box.y + box.height / 2)
	await expect(clip).toHaveText(/0\.0s \/ 1\.5s/)
	await page.mouse.up()

	await expect(clip).toHaveText(/0\.0s \/ 1\.5s/)
})

test('resizing a clip from the left edge trims its start and duration', async ({ page }) => {
	await page.goto('/')
	await createProjectFromMenu(page)
	await importFixtureVideo(page)

	const clip = page.getByRole('button', { name: /fixture-video.webm/i }).first()
	const handle = clip.locator('.ve-clip__resize-handle--start')
	const box = await handle.boundingBox()
	if (!box) {
		throw new Error('Clip start resize handle bounding box is unavailable')
	}

	await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
	await page.mouse.down()
	await page.mouse.move(box.x + box.width / 2 + 28, box.y + box.height / 2)
	await expect(clip).toHaveText(/0\.5s \/ 0\.5s/)
	await page.mouse.up()

	await expect(clip).toHaveText(/0\.5s \/ 0\.5s/)
})

test('dragging a clip before the timeline start clamps to zero', async ({ page }) => {
	await page.goto('/')
	await createProjectFromMenu(page)
	await importFixtureVideo(page)

	const clip = page.getByRole('button', { name: /fixture-video.webm/i }).first()
	const box = await clip.boundingBox()
	if (!box) {
		throw new Error('Clip bounding box is unavailable for drag simulation')
	}

	await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
	await page.mouse.down()
	await page.mouse.move(box.x + box.width / 2 - 320, box.y + box.height / 2)
	await page.mouse.up()

	await expect(clip).toHaveText(/0\.0s \/ 1\.0s/)
})

test('playback toggle advances timeline cursor over time', async ({ page }) => {
	await page.goto('/')
	await createProjectFromMenu(page)
	await importFixtureVideo(page)

	const timeline = page.getByRole('region', { name: 'Timeline' })
	const currentTime = timeline.getByLabel('Current time')
	await expect(currentTime).toHaveText('0.00s')

	await page.getByRole('region', { name: 'Preview panel' }).getByRole('button', { name: 'Play' }).click()
	await page.waitForTimeout(700)
	await expect(currentTime).not.toHaveText('0.00s')
	await page.getByRole('region', { name: 'Preview panel' }).getByRole('button', { name: 'Pause' }).click()
})

test('creates an initial project automatically on startup', async ({ page }) => {
	await page.goto('/')
	const projectsRegion = page.getByLabel('Projects')
	await expect(projectsRegion.getByRole('button', { name: /Project \d+/i })).toBeVisible()
	await expect(page.getByLabel('Media bin')).not.toContainText('No active project.')
})

test('timeline tools perform select, split, trim, and hand pan actions', async ({ page }) => {
	await page.goto('/')
	await createProjectFromMenu(page)
	await importFixtureVideo(page)

	const timeline = page.getByRole('region', { name: 'Timeline' })
	const clip = timeline.getByRole('button', { name: /fixture-video.webm/i }).first()
	await timeline.getByRole('button', { name: 'Select tool' }).click()
	await clip.click()
	await expect(page.getByRole('complementary', { name: 'Inspector' }).getByRole('textbox', { name: 'Clip name' })).toHaveValue('fixture-video.webm')

	const trimTool = timeline.getByRole('button', { name: 'Trim tool' })
	const splitTool = timeline.getByRole('button', { name: 'Split tool' })
	await expect(trimTool).toHaveAttribute('data-icon-name', 'stretch-horizontal')
	await expect(splitTool).toHaveAttribute('data-icon-name', 'scissors')
	await splitTool.click()
	await clip.click({ position: { x: 28, y: 20 } })
	await expect(timeline.getByRole('button', { name: /fixture-video.webm/i })).toHaveCount(2)

	const rightClip = timeline.getByRole('button', { name: /fixture-video.webm/i }).nth(1)
	await trimTool.click()
	await expect(rightClip).toHaveAttribute('data-tool', 'trim')
	const beforeTrimText = await rightClip.innerText()
	const handle = rightClip.locator('.ve-clip__resize-handle--end')
	const handleBox = await handle.boundingBox()
	if (!handleBox) {
		throw new Error('Trim handle is unavailable')
	}
	await page.mouse.move(handleBox.x + handleBox.width / 2, handleBox.y + handleBox.height / 2)
	await page.mouse.down()
	await page.mouse.move(handleBox.x + handleBox.width / 2 + 28, handleBox.y + handleBox.height / 2)
	await page.mouse.up()
	await expect(rightClip).not.toHaveText(beforeTrimText)

	for (let index = 0; index < 8; index += 1) {
		await timeline.getByRole('button', { name: 'Add video track' }).click()
	}
	for (let index = 0; index < 12; index += 1) {
		await page.getByLabel('Media bin').getByRole('button', { name: 'Add to timeline' }).first().click()
	}
	for (let index = 0; index < 5; index += 1) {
		await timeline.getByRole('button', { name: 'Zoom in' }).click()
	}
	await timeline.getByRole('button', { name: 'Hand tool' }).click()
	const scrollArea = timeline.locator('.ve-timeline-scroll-area')
	const laneScroll = timeline.locator('.ve-track-lane-scroll')
	const firstRail = timeline.locator('.ve-track-row__rail').first()
	await expect.poll(async () => laneScroll.evaluate((element) => element.scrollWidth > element.clientWidth)).toBe(true)
	await expect.poll(async () => scrollArea.evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(true)
	await laneScroll.evaluate((element) => { element.scrollLeft = 0 })
	await expect.poll(async () => firstRail.evaluate((element) => element.scrollLeft)).toBe(0)
	const scrollBox = await laneScroll.boundingBox()
	if (!scrollBox) {
		throw new Error('Timeline lane scroll area is unavailable')
	}
	const visibleLaneY = scrollBox.y + 40
	await laneScroll.dispatchEvent('pointerdown', {
		clientX: scrollBox.x + scrollBox.width - 80,
		clientY: visibleLaneY,
		buttons: 1,
		pointerId: 1,
		pointerType: 'mouse',
	})
	await laneScroll.dispatchEvent('pointermove', {
		clientX: scrollBox.x + 40,
		clientY: visibleLaneY,
		buttons: 1,
		pointerId: 1,
		pointerType: 'mouse',
	})
	await laneScroll.dispatchEvent('pointerup', {
		clientX: scrollBox.x + 40,
		clientY: visibleLaneY,
		buttons: 0,
		pointerId: 1,
		pointerType: 'mouse',
	})
	await expect.poll(async () => laneScroll.evaluate((element) => element.scrollLeft)).toBeGreaterThan(0)
	await expect.poll(async () => scrollArea.evaluate((element) => element.scrollLeft)).toBe(0)
	await expect.poll(async () => firstRail.evaluate((element) => element.scrollLeft)).toBe(0)
	await expect(timeline.getByLabel('V1 controls')).toBeVisible()
})

test('timeline clip boxes align to the ruler and playhead origin', async ({ page }) => {
	await page.goto('/')
	await createProjectFromMenu(page)
	await importFixtureVideo(page)

	const timeline = page.getByRole('region', { name: 'Timeline' })
	const clip = timeline.getByRole('button', { name: /fixture-video.webm/i }).first()
	const rulerBox = await timeline.getByLabel('Time ruler').boundingBox()
	const playheadBox = await timeline.getByLabel('Current step').boundingBox()
	const clipBox = await clip.boundingBox()
	if (!rulerBox || !playheadBox || !clipBox) {
		throw new Error('Timeline geometry boxes are unavailable')
	}

	expect(Math.abs(clipBox.x - rulerBox.x)).toBeLessThanOrEqual(2)
	expect(Math.abs(playheadBox.x - rulerBox.x)).toBeLessThanOrEqual(2)
	const zoomText = await timeline.getByText(/px\/s$/i).first().textContent()
	const zoom = Number.parseFloat((zoomText ?? '56').replace(/[^0-9.]/g, '')) || 56
	expect(Math.abs(clipBox.width - zoom)).toBeLessThanOrEqual(2)
})

test('preview keeps offscreen canvas active and syncs media layers across playhead positions', async ({ page }) => {
	await page.goto('/')
	await createProjectFromMenu(page)
	await importFixtureMedia(page)

	const mediaBin = page.getByLabel('Media bin')
	const timeline = page.getByRole('region', { name: 'Timeline' })
	for (const resourceName of ['fixture-image.png', 'fixture-audio.wav']) {
		if (await timeline.getByRole('button', { name: new RegExp(resourceName, 'i') }).count() === 0) {
			await mediaBin.locator('.ve-resource-row').filter({ hasText: resourceName }).getByRole('button', { name: 'Add to timeline' }).click()
		}
	}

	const renderer = page.getByLabel('Renderer stage')
	const canvas = renderer.getByLabel('Offscreen preview canvas')
	await setTimelineCursor(page, 0.5)
	await expect(canvas).toHaveAttribute('data-render-mode', 'offscreen')
	await expect(renderer.locator('video')).toHaveCount(1)
	await expect(renderer.locator('audio')).toHaveCount(1)
	await expect.poll(async () =>
		renderer.locator('video').evaluate((element) => (element as HTMLVideoElement).currentTime),
	).toBeGreaterThan(0.4)
	await setTimelineCursor(page, 0.75)
	await expect.poll(async () =>
		renderer.locator('video').evaluate((element) => (element as HTMLVideoElement).currentTime),
	).toBeGreaterThan(0.7)
	const safeAreaBox = await renderer.locator('.ve-renderer__safe-area').boundingBox()
	const videoLayerBox = await renderer.locator('.ve-renderer__layer--video').boundingBox()
	if (!safeAreaBox || !videoLayerBox) {
		throw new Error('Preview geometry boxes are unavailable')
	}
	expect(Math.abs(videoLayerBox.width - safeAreaBox.width)).toBeLessThanOrEqual(2)
	expect(Math.abs(videoLayerBox.height - safeAreaBox.height)).toBeLessThanOrEqual(2)

	const imageClipText = await timeline.getByRole('button', { name: /fixture-image.png/i }).first().innerText()
	const imageClipStart = Number(imageClipText.match(/· (\d+(?:\.\d+)?)s \//)?.[1] ?? 0)
	await setTimelineCursor(page, imageClipStart + 0.5)
	await expect(renderer.locator('img[alt="fixture-image.png"]')).toBeVisible()
	await expect(renderer.locator('video')).toHaveCount(0)

	await setTimelineCursor(page, imageClipStart + 2)
	await expect(renderer.getByText('No frame at cursor')).toBeVisible()
})

test('preview sends playhead renders through an OffscreenCanvas worker', async ({ page }) => {
	await page.addInitScript(() => {
		const messages: unknown[] = []
		Object.defineProperty(window, '__previewWorkerMessages', { value: messages, configurable: true })
		Object.defineProperty(window, '__previewOffscreenTransfers', { value: 0, writable: true, configurable: true })

		class PreviewWorkerProbe {
			url: unknown
			options: unknown

			constructor(url: unknown, options: unknown) {
				this.url = url
				this.options = options
			}

			postMessage(message: unknown) {
				messages.push(message)
			}

			terminate() {}
			addEventListener() {}
			removeEventListener() {}
			dispatchEvent() { return true }
		}

		Object.defineProperty(window, 'Worker', { value: PreviewWorkerProbe, configurable: true })
		Object.defineProperty(HTMLCanvasElement.prototype, 'transferControlToOffscreen', {
			value() {
				window.__previewOffscreenTransfers += 1
				return { __offscreenCanvasProbe: true }
			},
			configurable: true,
		})
	})

	await page.goto('/')
	await createProjectFromMenu(page)
	await importFixtureVideo(page)

	const renderer = page.getByLabel('Renderer stage')
	await setTimelineCursor(page, 0.25)
	await expect(renderer.getByLabel('Offscreen preview canvas')).toHaveAttribute('data-render-mode', 'offscreen')
	await setTimelineCursor(page, 0.75)

	const probe = await page.evaluate(() => ({
		transfers: window.__previewOffscreenTransfers,
		messages: window.__previewWorkerMessages,
	}))
	expect(probe.transfers).toBe(1)
	expect(probe.messages).toEqual(expect.arrayContaining([
		expect.objectContaining({ type: 'init' }),
		expect.objectContaining({
			type: 'setScene',
			clips: expect.arrayContaining([
				expect.objectContaining({ name: 'fixture-video.webm', kind: 'video' }),
			]),
		}),
		expect.objectContaining({
			type: 'render',
			cursor: expect.closeTo(0.75, 1),
		}),
	]))
})

test('export project button downloads a webm video file', async ({ page }) => {
	await page.goto('/')
	await createProjectFromMenu(page)
	await importFixtureVideo(page)

	const downloadPromise = page.waitForEvent('download')
	await page.getByRole('button', { name: 'Export project' }).click()
	const download = await downloadPromise
	expect(download.suggestedFilename()).toMatch(/\.webm$/)
	const downloadPath = await download.path()
	expect(downloadPath).toBeTruthy()
	const videoBytes = await fs.readFile(downloadPath as string)
	expect(videoBytes.length).toBeGreaterThan(1000)
	expect([...videoBytes.subarray(0, 4)]).toEqual([0x1a, 0x45, 0xdf, 0xa3])
	const videoProbe = await page.evaluate(async (bytes) => {
		const blob = new Blob([new Uint8Array(bytes)], { type: 'video/webm' })
		const url = URL.createObjectURL(blob)
		try {
			return await new Promise<{ duration: number; width: number; height: number }>((resolve, reject) => {
				const video = document.createElement('video')
				video.preload = 'metadata'
				video.onloadedmetadata = () => resolve({
					duration: video.duration,
					width: video.videoWidth,
					height: video.videoHeight,
				})
				video.onerror = () => reject(new Error('Exported WebM failed to load metadata'))
				video.src = url
			})
		} finally {
			URL.revokeObjectURL(url)
		}
	}, Array.from(videoBytes))
	expect(videoProbe.duration).toBeGreaterThan(0.5)
	expect(videoProbe.duration).toBeLessThan(1.5)
	expect(videoProbe.width).toBe(1920)
	expect(videoProbe.height).toBe(1080)
	await expect(page.getByRole('status').filter({ hasText: 'Export ready' })).toBeVisible()
})