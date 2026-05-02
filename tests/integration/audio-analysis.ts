import { expect } from '@playwright/test'
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const ffmpegInstaller = require('@ffmpeg-installer/ffmpeg') as { path: string }
const ffprobeInstaller = require('@ffprobe-installer/ffprobe') as { path: string }

export interface MediaStreamInfo {
	formatDuration: number
	videoStreams: Array<{ codecName: string; duration?: number; width?: number; height?: number }>
	audioStreams: Array<{ codecName: string; sampleRate: number; channels: number; duration?: number }>
}

export interface PcmWindowAnalysis {
	start: number
	end: number
	rms: number
	peak: number
	leftRms: number
	rightRms: number
}

export interface PcmAnalysis {
	sampleRate: number
	channels: number
	duration: number
	rms: number
	peak: number
	leftRms: number
	rightRms: number
	windows: PcmWindowAnalysis[]
}

interface ChildProcessResult {
	stdout: Buffer
	stderr: Buffer
}

const runBinary = (
	binaryPath: string,
	args: string[],
	options: { timeoutMs?: number } = {},
): Promise<ChildProcessResult> => new Promise((resolve, reject) => {
	const child = spawn(binaryPath, args, { stdio: ['ignore', 'pipe', 'pipe'] })
	const stdoutChunks: Buffer[] = []
	const stderrChunks: Buffer[] = []
	const timeoutId = options.timeoutMs
		? setTimeout(() => {
			child.kill('SIGKILL')
			reject(new Error(`${binaryPath} timed out after ${options.timeoutMs}ms`))
		}, options.timeoutMs)
		: null

	child.stdout.on('data', (chunk: Buffer) => stdoutChunks.push(chunk))
	child.stderr.on('data', (chunk: Buffer) => stderrChunks.push(chunk))
	child.on('error', (error) => {
		if (timeoutId) {
			clearTimeout(timeoutId)
		}
		reject(error)
	})
	child.on('close', (code) => {
		if (timeoutId) {
			clearTimeout(timeoutId)
		}
		const stdout = Buffer.concat(stdoutChunks)
		const stderr = Buffer.concat(stderrChunks)
		if (code !== 0) {
			reject(new Error(`${binaryPath} exited with ${code}: ${stderr.toString('utf8')}`))
			return
		}
		resolve({ stdout, stderr })
	})
})

const toOptionalNumber = (value: unknown): number | undefined => {
	const numberValue = Number(value)
	return Number.isFinite(numberValue) ? numberValue : undefined
}

export const probeMedia = async (filePath: string): Promise<MediaStreamInfo> => {
	const { stdout } = await runBinary(ffprobeInstaller.path, [
		'-v',
		'error',
		'-print_format',
		'json',
		'-show_format',
		'-show_streams',
		filePath,
	], { timeoutMs: 15_000 })
	const payload = JSON.parse(stdout.toString('utf8')) as {
		format?: { duration?: string }
		streams?: Array<Record<string, unknown>>
	}
	const streams = payload.streams ?? []

	return {
		formatDuration: toOptionalNumber(payload.format?.duration) ?? 0,
		videoStreams: streams
			.filter((stream) => stream.codec_type === 'video')
			.map((stream) => ({
				codecName: String(stream.codec_name ?? ''),
				duration: toOptionalNumber(stream.duration),
				width: toOptionalNumber(stream.width),
				height: toOptionalNumber(stream.height),
			})),
		audioStreams: streams
			.filter((stream) => stream.codec_type === 'audio')
			.map((stream) => ({
				codecName: String(stream.codec_name ?? ''),
				sampleRate: toOptionalNumber(stream.sample_rate) ?? 0,
				channels: toOptionalNumber(stream.channels) ?? 0,
				duration: toOptionalNumber(stream.duration),
			})),
	}
}

export const decodeAudioPcm = async (
	filePath: string,
	options: { sampleRate?: number; channels?: number } = {},
): Promise<Float32Array> => {
	const sampleRate = options.sampleRate ?? 48_000
	const channels = options.channels ?? 2
	const { stdout } = await runBinary(ffmpegInstaller.path, [
		'-v',
		'error',
		'-i',
		filePath,
		'-vn',
		'-f',
		'f32le',
		'-acodec',
		'pcm_f32le',
		'-ac',
		String(channels),
		'-ar',
		String(sampleRate),
		'pipe:1',
	], { timeoutMs: 20_000 })
	const arrayBuffer = stdout.buffer.slice(stdout.byteOffset, stdout.byteOffset + stdout.byteLength)
	return new Float32Array(arrayBuffer)
}

export const slicePcmWindow = (
	samples: Float32Array,
	channels: number,
	sampleRate: number,
	start: number,
	end: number,
): Float32Array => {
	const startFrame = Math.max(0, Math.floor(start * sampleRate))
	const endFrame = Math.min(Math.floor(samples.length / channels), Math.ceil(end * sampleRate))
	return samples.slice(startFrame * channels, Math.max(startFrame, endFrame) * channels)
}

const analyzePcmSlice = (
	samples: Float32Array,
	channels: number,
	sampleRate: number,
	start: number,
	end: number,
): PcmWindowAnalysis => {
	let sum = 0
	let leftSum = 0
	let rightSum = 0
	let peak = 0
	let frameCount = 0
	const safeChannels = Math.max(1, channels)

	for (let offset = 0; offset + safeChannels - 1 < samples.length; offset += safeChannels) {
		const left = samples[offset] ?? 0
		const right = safeChannels > 1 ? samples[offset + 1] ?? 0 : left
		for (let channel = 0; channel < safeChannels; channel += 1) {
			const sample = samples[offset + channel] ?? 0
			sum += sample * sample
			peak = Math.max(peak, Math.abs(sample))
		}
		leftSum += left * left
		rightSum += right * right
		frameCount += 1
	}

	return {
		start,
		end,
		rms: frameCount > 0 ? Math.sqrt(sum / (frameCount * safeChannels)) : 0,
		peak,
		leftRms: frameCount > 0 ? Math.sqrt(leftSum / frameCount) : 0,
		rightRms: frameCount > 0 ? Math.sqrt(rightSum / frameCount) : 0,
	}
}

export const analyzePcm = (
	samples: Float32Array,
	channels: number,
	sampleRate: number,
	options: { windowSeconds?: number } = {},
): PcmAnalysis => {
	const windowSeconds = options.windowSeconds ?? 0.1
	const frameCount = Math.floor(samples.length / channels)
	const duration = frameCount / sampleRate
	const windows: PcmWindowAnalysis[] = []
	for (let start = 0; start < duration; start += windowSeconds) {
		const end = Math.min(duration, start + windowSeconds)
		windows.push(analyzePcmSlice(
			slicePcmWindow(samples, channels, sampleRate, start, end),
			channels,
			sampleRate,
			start,
			end,
		))
	}
	const whole = analyzePcmSlice(samples, channels, sampleRate, 0, duration)

	return {
		sampleRate,
		channels,
		duration,
		rms: whole.rms,
		peak: whole.peak,
		leftRms: whole.leftRms,
		rightRms: whole.rightRms,
		windows,
	}
}

export const measureFrequencyPower = (
	samples: Float32Array,
	channels: number,
	sampleRate: number,
	frequency: number,
	options: { start?: number; end?: number } = {},
): number => {
	const window = slicePcmWindow(
		samples,
		channels,
		sampleRate,
		options.start ?? 0,
		options.end ?? samples.length / channels / sampleRate,
	)
	const frameCount = Math.floor(window.length / channels)
	if (frameCount <= 0) {
		return 0
	}

	const normalizedBin = Math.round((frameCount * frequency) / sampleRate)
	const omega = (2 * Math.PI * normalizedBin) / frameCount
	const coefficient = 2 * Math.cos(omega)
	let previous = 0
	let previous2 = 0
	for (let frame = 0; frame < frameCount; frame += 1) {
		let mono = 0
		for (let channel = 0; channel < channels; channel += 1) {
			mono += window[frame * channels + channel] ?? 0
		}
		mono /= channels
		const value = mono + coefficient * previous - previous2
		previous2 = previous
		previous = value
	}

	return (previous2 * previous2 + previous * previous - coefficient * previous * previous2) / frameCount
}

export const measureChannelFrequencyPower = (
	samples: Float32Array,
	channels: number,
	sampleRate: number,
	frequency: number,
	channel: number,
	options: { start?: number; end?: number } = {},
): number => {
	const window = slicePcmWindow(
		samples,
		channels,
		sampleRate,
		options.start ?? 0,
		options.end ?? samples.length / channels / sampleRate,
	)
	const frameCount = Math.floor(window.length / channels)
	if (frameCount <= 0 || channel < 0 || channel >= channels) {
		return 0
	}

	const normalizedBin = Math.round((frameCount * frequency) / sampleRate)
	const omega = (2 * Math.PI * normalizedBin) / frameCount
	const coefficient = 2 * Math.cos(omega)
	let previous = 0
	let previous2 = 0
	for (let frame = 0; frame < frameCount; frame += 1) {
		const value = (window[frame * channels + channel] ?? 0) + coefficient * previous - previous2
		previous2 = previous
		previous = value
	}

	return (previous2 * previous2 + previous * previous - coefficient * previous * previous2) / frameCount
}

export const expectToneEnergy = (
	samples: Float32Array,
	options: {
		channels: number
		sampleRate: number
		frequency: number
		start?: number
		end?: number
		minPower?: number
	},
): void => {
	const power = measureFrequencyPower(samples, options.channels, options.sampleRate, options.frequency, options)
	expect(power).toBeGreaterThan(options.minPower ?? 0.01)
}

export const sampleVideoFrameRgba = async (
	filePath: string,
	options: { time?: number } = {},
): Promise<[number, number, number, number]> => {
	const { stdout } = await runBinary(ffmpegInstaller.path, [
		'-v',
		'error',
		'-ss',
		String(options.time ?? 0.5),
		'-i',
		filePath,
		'-frames:v',
		'1',
		'-vf',
		'scale=1:1',
		'-f',
		'rawvideo',
		'-pix_fmt',
		'rgba',
		'pipe:1',
	], { timeoutMs: 20_000 })
	if (stdout.length < 4) {
		throw new Error('Unable to sample exported video frame')
	}

	return [stdout[0], stdout[1], stdout[2], stdout[3]]
}

export const sampleVideoFramePixelRgba = async (
	filePath: string,
	options: { time?: number; x: number; y: number },
): Promise<[number, number, number, number]> => {
	const { stdout } = await runBinary(ffmpegInstaller.path, [
		'-v',
		'error',
		'-ss',
		String(options.time ?? 0.5),
		'-i',
		filePath,
		'-frames:v',
		'1',
		'-vf',
		`crop=2:2:${Math.max(0, Math.round(options.x))}:${Math.max(0, Math.round(options.y))},scale=1:1`,
		'-f',
		'rawvideo',
		'-pix_fmt',
		'rgba',
		'pipe:1',
	], { timeoutMs: 20_000 })
	if (stdout.length < 4) {
		throw new Error('Unable to sample exported video frame pixel')
	}

	return [stdout[0], stdout[1], stdout[2], stdout[3]]
}

export const analyzeExportedAudio = async (
	filePath: string,
	options: { sampleRate?: number; channels?: number; windowSeconds?: number } = {},
): Promise<{ samples: Float32Array; analysis: PcmAnalysis }> => {
	const sampleRate = options.sampleRate ?? 48_000
	const channels = options.channels ?? 2
	const samples = await decodeAudioPcm(filePath, { sampleRate, channels })
	return {
		samples,
		analysis: analyzePcm(samples, channels, sampleRate, { windowSeconds: options.windowSeconds }),
	}
}
