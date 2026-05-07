import type { ArrayBufferTarget, Muxer } from 'webm-muxer'
import { getRangeClips, type ResolvedExportRange } from './exportRange'
import type { ExportPlan } from './renderPlan'

interface AudioExportMixer {
	stream: MediaStream | null
	start(): Promise<void>
	stop(): Promise<void>
}

interface DecodedAudioExportClip {
	buffer: AudioBuffer
	start: number
	duration: number
	trimStart: number
	gain: number
	pan: number
}

interface ElementAudioExportClip {
	element: HTMLMediaElement
	start: number
	duration: number
	trimStart: number
}

interface MixedAudioTrack {
	sampleRate: number
	numberOfChannels: number
	frames: Float32Array[]
}

interface WebCodecsAudioConfig {
	encoderConfig: AudioEncoderConfig
	muxerCodec: 'A_OPUS'
}

const webCodecsAudioCandidates: Array<{ encoderCodec: string; muxerCodec: 'A_OPUS' }> = [
	{ encoderCodec: 'opus', muxerCodec: 'A_OPUS' },
]

const isWebCodecsAudioSupported = (): boolean =>
	typeof AudioEncoder !== 'undefined'
	&& typeof AudioData !== 'undefined'
	&& typeof document !== 'undefined'

type AudioContextConstructor = typeof AudioContext

const getAudioContextConstructor = (): AudioContextConstructor | null => {
	const scope = globalThis as typeof globalThis & { webkitAudioContext?: AudioContextConstructor }
	return scope.AudioContext ?? scope.webkitAudioContext ?? null
}

export const getWebCodecsAudioConfig = async (
	numberOfChannels: number,
	bitrate: number,
): Promise<WebCodecsAudioConfig | null> => {
	if (!isWebCodecsAudioSupported()) {
		return null
	}

	const sampleRates = [48_000, 44_100]
	for (const candidate of webCodecsAudioCandidates) {
		for (const sampleRate of sampleRates) {
			const encoderConfig: AudioEncoderConfig = {
				codec: candidate.encoderCodec,
				numberOfChannels,
				sampleRate,
				bitrate,
			}
			try {
				const support = await AudioEncoder.isConfigSupported(encoderConfig)
				if (support.supported) {
					return {
						encoderConfig: support.config ?? encoderConfig,
						muxerCodec: candidate.muxerCodec,
					}
				}
			} catch {
				// Try the next codec candidate.
			}
		}
	}

	return null
}

const clampAudioSample = (sample: number): number => Math.max(-1, Math.min(1, sample))

const resolveStereoSample = (buffer: AudioBuffer, samplePosition: number): [number, number] => {
	const frameIndex = Math.floor(samplePosition)
	const nextIndex = Math.min(buffer.length - 1, frameIndex + 1)
	const interpolation = samplePosition - frameIndex
	const sampleAt = (channel: Float32Array): number =>
		channel[frameIndex] + (channel[nextIndex] - channel[frameIndex]) * interpolation

	if (buffer.numberOfChannels <= 0) {
		return [0, 0]
	}

	if (buffer.numberOfChannels === 1) {
		const mono = sampleAt(buffer.getChannelData(0))
		return [mono, mono]
	}

	return [
		sampleAt(buffer.getChannelData(0)),
		sampleAt(buffer.getChannelData(1)),
	]
}

const getStereoPanGains = (gain: number, pan: number): [number, number] => {
	const normalizedPan = Math.max(-1, Math.min(1, pan))
	const left = gain * (normalizedPan <= 0 ? 1 : 1 - normalizedPan)
	const right = gain * (normalizedPan >= 0 ? 1 : 1 + normalizedPan)
	return [left, right]
}

export const mixWebCodecsAudioTrack = async (
	plan: ExportPlan,
	resolvedRange: ResolvedExportRange,
	exportStart: number,
	exportDuration: number,
	sampleRate: number,
	numberOfChannels: number,
): Promise<MixedAudioTrack | null> => {
	const audioClips = getRangeClips(plan, resolvedRange).filter((clip) => clip.type === 'ef-audio')
	if (audioClips.length === 0) {
		return null
	}

	const AudioContextConstructor = getAudioContextConstructor()
	if (!AudioContextConstructor) {
		return null
	}

	const audioContext = new AudioContextConstructor()
	const totalFrames = Math.max(1, Math.ceil(exportDuration * sampleRate))
	const mixedFrames = Array.from({ length: numberOfChannels }, () => new Float32Array(totalFrames))

	try {
		for (const clip of audioClips) {
			const decodedBuffer = await fetch(clip.source)
				.then((response) => response.arrayBuffer())
				.then((audioData) => audioContext.decodeAudioData(audioData.slice(0)))
				.catch(() => null)
			if (!decodedBuffer) {
				return null
			}

			const clipEnd = clip.start + clip.duration
			const activeStart = Math.max(exportStart, clip.start)
			const activeEnd = Math.min(exportStart + exportDuration, clipEnd)
			if (activeEnd <= activeStart) {
				continue
			}

			const destinationStartFrame = Math.max(0, Math.floor((activeStart - exportStart) * sampleRate))
			const destinationFrameCount = Math.min(
				totalFrames - destinationStartFrame,
				Math.ceil((activeEnd - activeStart) * sampleRate),
			)
			if (destinationFrameCount <= 0) {
				continue
			}

			const sourceOffsetSeconds = clip.trimStart + Math.max(0, exportStart - clip.start)
			const sourceStartFrame = sourceOffsetSeconds * decodedBuffer.sampleRate
			const sourceFrameStep = decodedBuffer.sampleRate / sampleRate
			const [leftGain, rightGain] = getStereoPanGains(
				Math.max(0, Math.min(1.5, Number(clip.gain ?? 1))),
				Math.max(-1, Math.min(1, Number(clip.pan ?? 0))),
			)

			for (let frameOffset = 0; frameOffset < destinationFrameCount; frameOffset += 1) {
				const sourcePosition = sourceStartFrame + frameOffset * sourceFrameStep
				if (!Number.isFinite(sourcePosition) || sourcePosition >= decodedBuffer.length - 1) {
					break
				}
				const [leftSample, rightSample] = resolveStereoSample(decodedBuffer, sourcePosition)
				const destinationIndex = destinationStartFrame + frameOffset
				mixedFrames[0][destinationIndex] += leftSample * leftGain
				if (numberOfChannels > 1) {
					mixedFrames[1][destinationIndex] += rightSample * rightGain
				}
			}
		}

		for (let channel = 0; channel < mixedFrames.length; channel += 1) {
			const channelData = mixedFrames[channel]
			for (let index = 0; index < channelData.length; index += 1) {
				channelData[index] = clampAudioSample(channelData[index])
			}
		}

		return {
			sampleRate,
			numberOfChannels,
			frames: mixedFrames,
		}
	} finally {
		await audioContext.close().catch(() => undefined)
	}
}

const waitForMediaMetadata = (element: HTMLMediaElement): Promise<void> =>
	new Promise((resolve) => {
		if (Number.isFinite(element.duration) && element.duration > 0) {
			resolve()
			return
		}

		const finish = (): void => {
			element.removeEventListener('loadedmetadata', finish)
			element.removeEventListener('error', finish)
			resolve()
		}
		element.addEventListener('loadedmetadata', finish, { once: true })
		element.addEventListener('error', finish, { once: true })
		element.load()
	})

export const encodeMixedAudioTrack = async (
	muxer: Muxer<ArrayBufferTarget>,
	audioConfig: WebCodecsAudioConfig,
	mixedTrack: MixedAudioTrack,
): Promise<void> => {
	const encoder = new AudioEncoder({
		output: (chunk, metadata) => muxer.addAudioChunk(chunk, metadata),
		error: (error) => {
			throw error
		},
	})
	encoder.configure(audioConfig.encoderConfig)

	const framesPerChunk = 960
	try {
		const { numberOfChannels, sampleRate, frames } = mixedTrack
		const totalFrames = frames[0]?.length ?? 0
		for (let offset = 0; offset < totalFrames; offset += framesPerChunk) {
			const frameCount = Math.min(framesPerChunk, totalFrames - offset)
			const interleaved = new Float32Array(frameCount * numberOfChannels)
			for (let frameIndex = 0; frameIndex < frameCount; frameIndex += 1) {
				for (let channel = 0; channel < numberOfChannels; channel += 1) {
					interleaved[frameIndex * numberOfChannels + channel] = frames[channel][offset + frameIndex] ?? 0
				}
			}

			const audioData = new AudioData({
				format: 'f32',
				sampleRate,
				numberOfFrames: frameCount,
				numberOfChannels,
				timestamp: Math.round((offset / sampleRate) * 1_000_000),
				data: new Uint8Array(interleaved.buffer),
			})
			encoder.encode(audioData)
			audioData.close()
		}

		await encoder.flush()
	} finally {
		encoder.close()
	}
}

export const createAudioExportMixer = async (
	plan: ExportPlan,
	resolvedRange: ResolvedExportRange,
	exportStart: number,
	exportDuration: number,
): Promise<AudioExportMixer> => {
	const audioClips = getRangeClips(plan, resolvedRange).filter((clip) => clip.type === 'ef-audio')
	const AudioContextConstructor = getAudioContextConstructor()
	if (audioClips.length === 0 || !AudioContextConstructor) {
		return { stream: null, start: async () => undefined, stop: async () => undefined }
	}

	const audioContext = new AudioContextConstructor()
	const destination = audioContext.createMediaStreamDestination()
	const decodedClips: DecodedAudioExportClip[] = []
	const sources: AudioBufferSourceNode[] = []
	const elementClips: ElementAudioExportClip[] = []
	const elementTimers: Array<ReturnType<typeof globalThis.setTimeout>> = []

	for (const clip of audioClips) {
		const buffer = await fetch(clip.source)
			.then((response) => response.arrayBuffer())
			.then((audioData) => audioContext.decodeAudioData(audioData.slice(0)))
			.catch(() => null)
		const gainValue = Math.max(0, Math.min(1.5, Number(clip.gain ?? 1)))
		const panValue = Math.max(-1, Math.min(1, Number(clip.pan ?? 0)))
		if (buffer) {
			decodedClips.push({
				buffer,
				start: clip.start,
				duration: clip.duration,
				trimStart: clip.trimStart,
				gain: gainValue,
				pan: panValue,
			})
			continue
		}

		const element = document.createElement('audio')
		element.preload = 'auto'
		element.src = clip.source
		await waitForMediaMetadata(element)
		const source = audioContext.createMediaElementSource(element)
		const gain = audioContext.createGain()
		gain.gain.value = gainValue
		const stereoPanner = 'createStereoPanner' in audioContext
			? audioContext.createStereoPanner()
			: null
		if (stereoPanner) {
			stereoPanner.pan.value = panValue
			source.connect(gain).connect(stereoPanner).connect(destination)
		} else {
			source.connect(gain).connect(destination)
		}
		elementClips.push({
			element,
			start: clip.start,
			duration: clip.duration,
			trimStart: clip.trimStart,
		})
	}
	if (decodedClips.length === 0 && elementClips.length === 0) {
		await audioContext.close().catch(() => undefined)
		return { stream: null, start: async () => undefined, stop: async () => undefined }
	}

	return {
		stream: destination.stream,
		async start() {
			await audioContext.resume()
			const baseTime = audioContext.currentTime
			for (const clip of decodedClips) {
				const clipEnd = clip.start + clip.duration
				const activeStart = Math.max(exportStart, clip.start)
				const activeEnd = Math.min(exportStart + exportDuration, clipEnd)
				if (activeEnd <= activeStart) {
					continue
				}

				const delay = Math.max(0, clip.start - exportStart)
				const offset = Math.max(0, exportStart - clip.start)
				const bufferOffset = clip.trimStart + offset
				const activeDuration = Math.min(activeEnd - activeStart, Math.max(0, clip.buffer.duration - bufferOffset))
				if (activeDuration <= 0) {
					continue
				}

				const source = audioContext.createBufferSource()
				source.buffer = clip.buffer
				const gain = audioContext.createGain()
				gain.gain.value = clip.gain
				const stereoPanner = 'createStereoPanner' in audioContext
					? audioContext.createStereoPanner()
					: null
				if (stereoPanner) {
					stereoPanner.pan.value = clip.pan
					source.connect(gain).connect(stereoPanner).connect(destination)
				} else {
					source.connect(gain).connect(destination)
				}
				source.start(baseTime + delay, bufferOffset, activeDuration)
				sources.push(source)
			}

			for (const clip of elementClips) {
				const clipEnd = clip.start + clip.duration
				const activeStart = Math.max(exportStart, clip.start)
				const activeEnd = Math.min(exportStart + exportDuration, clipEnd)
				if (activeEnd <= activeStart) {
					continue
				}

				const delayMs = Math.max(0, (clip.start - exportStart) * 1000)
				const stopMs = Math.max(0, (activeEnd - exportStart) * 1000)
				const offset = Math.max(0, exportStart - clip.start)
				elementTimers.push(globalThis.setTimeout(() => {
					try {
						clip.element.currentTime = clip.trimStart + offset
					} catch {
						// Best-effort: metadata might still lag for some browsers.
					}
					void clip.element.play().catch(() => undefined)
				}, delayMs))
				elementTimers.push(globalThis.setTimeout(() => clip.element.pause(), stopMs))
			}
		},
		async stop() {
			for (const timer of elementTimers) {
				globalThis.clearTimeout(timer)
			}
			for (const source of sources) {
				try {
					source.stop()
				} catch {
					// Buffer sources can already be stopped by their scheduled duration.
				}
			}
			for (const clip of elementClips) {
				clip.element.pause()
				clip.element.removeAttribute('src')
				clip.element.load()
			}
			await audioContext.close().catch(() => undefined)
		},
	}
}