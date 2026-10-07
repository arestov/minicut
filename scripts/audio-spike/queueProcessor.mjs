// SPIKE: AudioWorklet processor that plays queued planar chunks, counts underruns, applies stop fades.
class QueueProcessor extends AudioWorkletProcessor {
	constructor(options) {
		super()
		this.q = []; this.pos = 0; this.queued = 0; this.played = 0
		this.started = false; this.prefill = options.processorOptions.prefillFrames
		this.underruns = 0; this.silentCalls = 0; this.calls = 0
		this.fadeLeft = 0; this.fadeTotal = 0; this.stopping = false; this.stopped = false
		this.last = 0; this.maxDelta = 0; this.maxDeltaStop = 0; this.firstSoundAt = null
		this.sinceReport = 0
		this.port.onmessage = ({ data }) => {
			if (data.type === 'chunk') { this.q.push(data.ch); this.queued += data.ch[0].length }
			else if (data.type === 'flush') { this.q = []; this.pos = 0; this.queued = 0; this.started = false; this.stopping = false; this.stopped = false; this.firstSoundAt = null; this.flushedAt = currentTime }
			else if (data.type === 'stop') { this.stopping = true; this.fadeTotal = this.fadeLeft = data.fadeFrames; this.maxDeltaStop = 0 }
			else if (data.type === 'ack') { this.port.postMessage({ type: 'report', ...this.report() }) }
		}
	}
	report() {
		return { played: this.played, queued: this.queued, underruns: this.underruns, silentCalls: this.silentCalls, calls: this.calls,
			maxDelta: this.maxDelta, maxDeltaStop: this.maxDeltaStop, firstSoundAt: this.firstSoundAt, now: currentTime }
	}
	process(_i, outputs) {
		this.calls++
		const out = outputs[0], n = out[0].length
		if (this.stopped) return true
		if (!this.started) {
			if (this.queued >= this.prefill) this.started = true
			else return true
		}
		let w = 0
		while (w < n && this.q.length) {
			const ch = this.q[0], avail = ch[0].length - this.pos, take = Math.min(avail, n - w)
			for (let c = 0; c < 2; c++) out[c].set(ch[c].subarray(this.pos, this.pos + take), w)
			w += take; this.pos += take; this.queued -= take
			if (this.pos >= ch[0].length) { this.q.shift(); this.pos = 0 }
		}
		if (w < n) { this.underruns++; this.silentCalls++ } // zero-filled remainder
		this.played += w
		for (let i = 0; i < n; i++) {
			if (this.stopping) {
				const g = this.fadeTotal > 0 ? Math.max(0, this.fadeLeft / this.fadeTotal) : 0
				out[0][i] *= g; out[1][i] *= g
				if (this.fadeLeft > 0) this.fadeLeft--
			}
			const d = Math.abs(out[0][i] - this.last); this.last = out[0][i]
			if (this.stopping) this.maxDeltaStop = Math.max(this.maxDeltaStop, d)
			else if (this.firstSoundAt !== null) this.maxDelta = Math.max(this.maxDelta, d)
			if (this.firstSoundAt === null && Math.abs(out[0][i]) > 1e-4) this.firstSoundAt = currentTime + i / sampleRate
		}
		if (this.stopping && this.fadeLeft === 0) this.stopped = true
		return true
	}
}
registerProcessor('queue-processor', QueueProcessor)
