// SPIKE: continuous PCM streaming approaches. usage: node stream.mjs <worklet|scheduled|script> [seconds] [targetMs] [chunkMs] [stress]
import { AudioContext, AudioBuffer } from 'node-web-audio-api'
import path from 'node:path'
import { readFileSync } from 'node:fs'
import { PcmSource, planar, SAMPLE_RATE } from './pcmSource.mjs'

const [approach = 'worklet', secs = '20', targetMsArg = '100', chunkMsArg = '20', stress] = process.argv.slice(2)
const seconds = Number(secs), targetMs = Number(targetMsArg), chunkMs = Number(chunkMsArg)
const chunkFrames = Math.round((SAMPLE_RATE * chunkMs) / 1000)
const ctx = new AudioContext({ latencyHint: 'playback' })
const src = new PcmSource({ durationSeconds: seconds + 5 })
const res = { approach, seconds, targetMs, chunkMs, stress: !!stress, sampleRate: ctx.sampleRate, baseLatency: ctx.baseLatency, outputLatency: ctx.outputLatency }
let lateChunks = 0, minLeadMs = Infinity
const stressTimer = stress ? setInterval(() => { const t = performance.now(); while (performance.now() - t < 40); }, 100) : null

const wait = (ms) => new Promise((r) => setTimeout(r, ms))
while (src.bufferedFrames < SAMPLE_RATE / 2) await wait(5)
ctx.playbackStats?.resetLatency?.()
const t0 = performance.now()
let stop = () => {}, report = () => ({})

if (approach === 'worklet') {
	// node-web-audio-api 2.2.0 on Windows cannot import absolute drive paths (ERR_UNSUPPORTED_ESM_URL_SCHEME); load the worklet through a blob URL
	await ctx.audioWorklet.addModule(URL.createObjectURL(new Blob([readFileSync(path.resolve(import.meta.dirname, 'queueProcessor.mjs'), 'utf8')], { type: 'text/javascript' })))
	const node = new (await import('node-web-audio-api')).AudioWorkletNode(ctx, 'queue-processor', {
		numberOfInputs: 0, outputChannelCount: [2], processorOptions: { prefillFrames: Math.round((SAMPLE_RATE * targetMs) / 1000) },
	})
	node.connect(ctx.destination)
	let sent = 0, last = { played: 0, underruns: 0, silentCalls: 0 }
	node.port.onmessage = ({ data }) => { if (data.type === 'report') last = data }
	const feed = setInterval(() => {
		node.port.postMessage({ type: 'ack' })
		while (sent - last.played < (SAMPLE_RATE * targetMs) / 1000) {
			const c = src.pull(chunkFrames); if (!c) break
			const ch = planar(c); node.port.postMessage({ type: 'chunk', ch }, [ch[0].buffer, ch[1].buffer]); sent += chunkFrames
		}
	}, 5)
	stop = () => clearInterval(feed)
	report = () => ({ workletUnderrunCalls: last.underruns, workletMaxDelta: last.maxDelta, workletCalls: last.calls, framesSent: sent, framesPlayed: last.played })
} else if (approach === 'scheduled') {
	let nextAt = ctx.currentTime + targetMs / 1000, scheduled = 0
	const feed = setInterval(() => {
		while (nextAt - ctx.currentTime < targetMs / 1000) {
			const c = src.pull(chunkFrames); if (!c) break
			const [l, r] = planar(c)
			const buf = new AudioBuffer({ numberOfChannels: 2, length: chunkFrames, sampleRate: SAMPLE_RATE })
			buf.copyToChannel(l, 0); buf.copyToChannel(r, 1)
			const s = ctx.createBufferSource(); s.buffer = buf; s.connect(ctx.destination)
			if (nextAt < ctx.currentTime) { lateChunks++; nextAt = ctx.currentTime + 0.005 }
			minLeadMs = Math.min(minLeadMs, (nextAt - ctx.currentTime) * 1000)
			s.start(nextAt); scheduled++; nextAt = Math.round((nextAt + chunkMs / 1000) * SAMPLE_RATE) / SAMPLE_RATE
		}
	}, 5)
	stop = () => clearInterval(feed)
	report = () => ({ lateChunks, minLeadMs: +minLeadMs.toFixed(1), scheduled })
} else if (approach === 'script') {
	const sp = ctx.createScriptProcessor(chunkFrames >= 512 ? 1024 * Math.max(1, Math.round(chunkFrames / 1024)) : 512, 1, 2)
	let starved = 0, q = null, qpos = 0
	sp.onaudioprocess = (e) => {
		const o0 = e.outputBuffer.getChannelData(0), o1 = e.outputBuffer.getChannelData(1)
		for (let i = 0; i < o0.length; i++) {
			if (!q || qpos >= q.length) { q = src.pull(512); qpos = 0; if (!q) { starved++; o0.fill(0, i); o1.fill(0, i); return } }
			o0[i] = q[qpos]; o1[i] = q[qpos + 1]; qpos += 2
		}
	}
	sp.connect(ctx.destination)
	report = () => ({ starvedCallbacks: starved, bufferSize: sp.bufferSize })
}

await wait(seconds * 1000)
const wall = (performance.now() - t0) / 1000
stop()
const st = ctx.playbackStats
res.wallSeconds = +wall.toFixed(2)
res.ctxSeconds = +ctx.currentTime.toFixed(3)
res.playbackStats = st ? { underrunEvents: st.underrunEvents, underrunDuration: st.underrunDuration, totalDuration: +st.totalDuration.toFixed(2), avgLatencyMs: +(st.averageLatency * 1000).toFixed(1), minLatencyMs: +(st.minimumLatency * 1000).toFixed(1), maxLatencyMs: +(st.maximumLatency * 1000).toFixed(1) } : null
Object.assign(res, report())
console.log(JSON.stringify(res))
if (stressTimer) clearInterval(stressTimer)
src.kill(); await ctx.close(); process.exit(0)
