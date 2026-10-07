// SPIKE: AudioContext.currentTime vs process.hrtime. usage: node --import tsx clock-drift.mjs [seconds] [sampleMs]
import { AudioContext } from 'node-web-audio-api'
import { createAudioPlaybackClock } from '../../src/video-editor/media/node/audio/audioPlaybackClock.ts'

const seconds = Number(process.argv[2] ?? 60), sampleMs = Number(process.argv[3] ?? 10)
const ctx = new AudioContext({ latencyHint: 'playback' })
const osc = ctx.createOscillator(); const g = ctx.createGain(); g.gain.value = 0.0; osc.connect(g).connect(ctx.destination); osc.start() // silent, keeps the device pulling
const hr = () => Number(process.hrtime.bigint()) / 1e6
const clock = createAudioPlaybackClock(ctx, { systemMonotonicMs: hr, nowEpochMs: Date.now, requestFrame: (cb) => setTimeout(cb, 16), cancelFrame: clearTimeout })
await new Promise((r) => setTimeout(r, 300))
const rows = []
const t0 = hr(), c0 = ctx.currentTime, p0 = performance.now()
let prevC = c0
const lat = new Set()
while (hr() - t0 < seconds * 1000) {
	const h = hr() - t0, c = (ctx.currentTime - c0) * 1000, s = clock.nowMonotonicMs()
	rows.push([h, c, s, c - prevC]); prevC = c; lat.add(ctx.outputLatency)
	await new Promise((r) => setTimeout(r, sampleMs))
}
const n = rows.length, last = rows[n - 1]
const lin = (idx) => { // least squares of (value - h) vs h => slope = drift
	let sx = 0, sy = 0, sxx = 0, sxy = 0
	for (const r of rows) { const y = r[idx] - r[0]; sx += r[0]; sy += y; sxx += r[0] * r[0]; sxy += r[0] * y }
	const k = (n * sxy - sx * sy) / (n * sxx - sx * sx), b = (sy - k * sx) / n
	let ss = 0, mx = 0; for (const r of rows) { const e = r[idx] - r[0] - (k * r[0] + b); ss += e * e; mx = Math.max(mx, Math.abs(e)) }
	return { ppm: +(k * 1e6).toFixed(2), stdMs: +Math.sqrt(ss / n).toFixed(3), maxAbsMs: +mx.toFixed(3) }
}
const deltas = rows.slice(1).map((r) => r[3]).sort((a, b) => a - b)
const q = (p) => +deltas[Math.floor(p * (deltas.length - 1))].toFixed(2)
const changed = rows.slice(1).filter((r) => r[3] > 0).map((r) => r[3]).sort((a, b) => a - b)
console.log(JSON.stringify({
	seconds, samples: n, hrDriftMs: +(last[0] - (performance.now() - p0)).toFixed(3),
	audioMinusHrMs: +(last[1] - last[0]).toFixed(2), rawDriftVsHr: lin(1), smoothedClockVsHr: lin(2),
	staleReadFraction: +(deltas.filter((d) => d === 0).length / deltas.length).toFixed(3),
	currentTimeStepMs: { p50: +changed[Math.floor(changed.length / 2)].toFixed(2), p99: +changed[Math.floor(changed.length * 0.99)].toFixed(2), max: +changed.at(-1).toFixed(2) },
	deltaQuantiles: { p50: q(0.5), p90: q(0.9), p99: q(0.99), max: q(1) },
	outputLatencyValues: [...lat], baseLatency: ctx.baseLatency,
	getOutputTimestamp: (() => { try { return ctx.getOutputTimestamp() } catch (e) { return String(e.message) } })(),
}))
await ctx.close(); process.exit(0)
