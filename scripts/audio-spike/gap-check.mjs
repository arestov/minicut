// SPIKE: do scheduled AudioBufferSourceNode chunks join sample-exactly? Offline render of DC chunks at fractional-ms grid.
import { OfflineAudioContext, AudioBuffer } from 'node-web-audio-api'
const sr = 48000
for (const chunkMs of [20, 10, 7.3]) {
	const frames = Math.round(sr * chunkMs / 1000), total = 200
	const off = new OfflineAudioContext(1, frames * total, sr)
	let at = 0
	for (let i = 0; i < total; i++) {
		const b = new AudioBuffer({ numberOfChannels: 1, length: frames, sampleRate: sr }); b.getChannelData(0).fill(1)
		const s = off.createBufferSource(); s.buffer = b; s.connect(off.destination); s.start(at); at = Math.round((at + frames / sr) * sr) / sr
	}
	const out = (await off.startRendering()).getChannelData(0)
	let gaps = 0, overlaps = 0; for (const v of out) { if (v < 0.5) gaps++; else if (v > 1.5) overlaps++ }
	console.log(JSON.stringify({ chunkMs, frames, chunks: total, gapSamples: gaps, overlapSamples: overlaps }))
}
process.exit(0)
