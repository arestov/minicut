// SPIKE: seek/pause latency with the scheduled-chunk engine + stop-click metric. usage: node seek.mjs [seeks]
import { AudioContext, AudioBuffer, OfflineAudioContext } from 'node-web-audio-api'
import { PcmSource, planar, SAMPLE_RATE } from './pcmSource.mjs'

const seeks = Number(process.argv[2] ?? 10), chunkMs = 20, chunkFrames = 960, leadMs = 20, targetMs = 100
const ctx = new AudioContext({ latencyHint: 'playback' })
const wait = (ms) => new Promise((r) => setTimeout(r, ms))
const an = ctx.createAnalyser(); an.fftSize = 256; an.connect(ctx.destination)
class Engine {
	src = null; gain = null; sources = []; nextAt = 0; timer = null; firstStartAt = null
	start(sec, fadeMs = 5) {
		this.stop(fadeMs)
		this.src = new PcmSource({ startSeconds: sec, durationSeconds: 30 })
		this.gain = ctx.createGain(); this.gain.connect(an); this.sources = []
		this.nextAt = null; this.firstStartAt = null
		this.timer = setInterval(() => this.pump(), 2)
	}
	pump() {
		if (this.nextAt === null) { if (this.src.bufferedFrames < chunkFrames) return; this.nextAt = ctx.currentTime + leadMs / 1000; this.firstStartAt = this.nextAt }
		while (this.nextAt - ctx.currentTime < targetMs / 1000) {
			const c = this.src.pull(chunkFrames); if (!c) return
			const [l, r] = planar(c); const b = new AudioBuffer({ numberOfChannels: 2, length: chunkFrames, sampleRate: SAMPLE_RATE })
			b.copyToChannel(l, 0); b.copyToChannel(r, 1)
			const s = ctx.createBufferSource(); s.buffer = b; s.connect(this.gain); s.start(this.nextAt); this.sources.push(s)
			this.nextAt = Math.round((this.nextAt + chunkMs / 1000) * SAMPLE_RATE) / SAMPLE_RATE
		}
	}
	stop(fadeMs) {
		clearInterval(this.timer); this.src?.kill()
		if (!this.gain) return
		const g = this.gain, ss = this.sources, t = ctx.currentTime
		g.gain.setValueAtTime(1, t); g.gain.linearRampToValueAtTime(0, t + fadeMs / 1000)
		setTimeout(() => { for (const s of ss) try { s.stop() } catch {} ; g.disconnect() }, fadeMs + 20)
		this.gain = null
	}
}
const e = new Engine(), buf = new Float32Array(256)
const audible = () => { an.getFloatTimeDomainData(buf); for (const v of buf) if (Math.abs(v) > 1e-4) return true; return false }
e.start(0); await wait(1500) // warm up (ffmpeg cold start)
const rows = []
for (let i = 0; i < seeks; i++) {
	e.stop(5); await wait(80)
	const t = performance.now(); e.start(1 + i * 0.7)
	while (e.firstStartAt === null) await wait(1)
	const scheduledMs = performance.now() - t
	while (!audible()) await wait(1)
	rows.push({ scheduleReadyMs: scheduledMs, firstAudibleMs: performance.now() - t, ffmpegFirstByteMs: e.src.firstDataAt - e.src.spawnedAt })
	await wait(250)
}
e.stop(5)
const avg = (k) => +(rows.reduce((a, r) => a + r[k], 0) / rows.length).toFixed(1), max = (k) => +Math.max(...rows.map((r) => r[k])).toFixed(1)

// stop-click metric: 440 Hz sine cut at peak-ish phase, hard stop vs gain ramp (offline render, exact)
const click = async (fadeMs) => {
	const off = new OfflineAudioContext(1, SAMPLE_RATE, SAMPLE_RATE), o = off.createOscillator(), g = off.createGain()
	o.frequency.value = 440; o.connect(g).connect(off.destination); o.start()
	const at = 0.5 + 1 / 1760 // near a sine peak
	if (fadeMs === 0) g.gain.setValueAtTime(0, at); else { g.gain.setValueAtTime(1, at); g.gain.linearRampToValueAtTime(0, at + fadeMs / 1000) }
	const d = (await off.startRendering()).getChannelData(0); let m = 0
	for (let i = 1; i < d.length; i++) m = Math.max(m, Math.abs(d[i] - d[i - 1]))
	return { fadeMs, maxSampleStep: +m.toFixed(4) }
}
console.log(JSON.stringify({ seeks, leadMs, targetMs, outputLatencyMs: +(ctx.outputLatency * 1000).toFixed(1),
	ffmpegFirstByteMs: { avg: avg('ffmpegFirstByteMs'), max: max('ffmpegFirstByteMs') }, seekToChunkScheduledMs: { avg: avg('scheduleReadyMs'), max: max('scheduleReadyMs') },
	seekToAnalyserAudibleMs: { avg: avg('firstAudibleMs'), max: max('firstAudibleMs') }, stopClick: [await click(0), await click(5), await click(10)] }))
process.exit(0)
