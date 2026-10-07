// SPIKE (stage 4-audio): not production code. Decodes a fixture timeline mix to f32le stereo PCM via ffmpeg.
import { spawn } from 'node:child_process'
import path from 'node:path'

export const SAMPLE_RATE = 48000
export const FIXTURES = path.resolve(import.meta.dirname, '../../tmp/media-fixtures/v1')

export class PcmSource {
	#chunks = []
	#bytes = 0
	#ended = false
	#proc
	constructor({ startSeconds = 0, durationSeconds = 120 } = {}) {
		const tone = path.join(FIXTURES, 'audio-tone.wav')
		const av = path.join(FIXTURES, 'video-audio.mp4')
		const graph =
			'[0:a]aresample=48000,aformat=channel_layouts=stereo[a];' +
			'[1:a]aresample=48000,aformat=channel_layouts=stereo,volume=0.5[b];' +
			'[a][b]amix=inputs=2:duration=longest:normalize=0,volume=0.2[o]'
		this.spawnedAt = performance.now()
		this.firstDataAt = null
		this.#proc = spawn('ffmpeg', [
			'-v', 'error', '-ss', String(startSeconds), '-stream_loop', '-1', '-i', tone, '-ss', String(startSeconds), '-stream_loop', '-1', '-i', av,
			'-filter_complex', graph, '-map', '[o]', '-t', String(durationSeconds),
			'-f', 'f32le', '-ar', String(SAMPLE_RATE), '-ac', '2', 'pipe:1',
		], { stdio: ['ignore', 'pipe', 'inherit'] })
		this.#proc.stdout.on('data', (b) => {
			this.firstDataAt ??= performance.now()
			this.#chunks.push(b)
			this.#bytes += b.length
			if (this.#bytes > SAMPLE_RATE * 8) this.#proc.stdout.pause() // ~1 s ahead max
		})
		this.#proc.stdout.on('end', () => { this.#ended = true })
	}
	get bufferedFrames() { return this.#bytes / 8 }
	get ended() { return this.#ended && this.#bytes === 0 }
	/** Sync pull of exactly `frames` interleaved stereo frames, or null when not enough is buffered. */
	pull(frames) {
		const need = frames * 8
		if (this.#bytes < need) return null
		const out = Buffer.allocUnsafe(need)
		let off = 0
		while (off < need) {
			const head = this.#chunks[0]
			const take = Math.min(head.length, need - off)
			head.copy(out, off, 0, take)
			off += take
			if (take === head.length) this.#chunks.shift()
			else this.#chunks[0] = head.subarray(take)
		}
		this.#bytes -= need
		if (this.#bytes < SAMPLE_RATE * 4) this.#proc.stdout.resume()
		const f = new Float32Array(out.buffer, out.byteOffset, frames * 2)
		return f
	}
	kill() { this.#proc.kill() }
}

export const planar = (inter) => {
	const n = inter.length / 2
	const l = new Float32Array(n), r = new Float32Array(n)
	for (let i = 0; i < n; i++) { l[i] = inter[2 * i]; r[i] = inter[2 * i + 1] }
	return [l, r]
}
