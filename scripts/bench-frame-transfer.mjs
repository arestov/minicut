// RGBA frame transfer benchmark (not part of default test sets).
//
//   node scripts/bench-frame-transfer.mjs [--frames=300] [--json]
//   bun  scripts/bench-frame-transfer.mjs [--frames=300] [--json]
//
// Measures how fast 960x540 and 1920x1080 RGBA frames reach the main thread from
//   - a worker_threads worker: structured-clone copy, transferred ArrayBuffer,
//     SharedArrayBuffer ring (postMessage of a slot index only);
//   - a child process over stdout (raw bytes, 8-byte header carries send time).
// The producer fills each frame with a cheap pattern so transfer cost dominates.
// Results are printed as a table (or JSON with --json). See docs/frame-transfer-benchmark.md.
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { isMainThread, parentPort, Worker, workerData } from 'node:worker_threads'

const SIZES = [
	{ name: '960x540', w: 960, h: 540 },
	{ name: '1920x1080', w: 1920, h: 1080 },
]
const runtime = typeof Bun !== 'undefined' ? `bun ${Bun.version}` : `node ${process.versions.node}`
const now = () => performance.timeOrigin + performance.now()

function fillFrame(u8, seq) {
	u8.fill(seq & 255)
	for (let i = 0; i < u8.length; i += 4096) u8[i] = (i + seq) & 255
}

if (process.argv[2] === '--child') {
	/* child process: writes frames to stdout; first 8 bytes of each frame = send time */
	const bytes = Number(process.argv[3])
	const frames = Number(process.argv[4])
	const frame = new Uint8Array(bytes)
	const view = new DataView(frame.buffer)
	let seq = 0
	const write = () => {
		while (seq < frames) {
			fillFrame(frame, seq)
			view.setFloat64(0, now(), true)
			seq++
			// stdout.write copies into the pipe, so reusing `frame` is safe.
			if (!process.stdout.write(frame)) {
				process.stdout.once('drain', write)
				return
			}
		}
		process.stdout.end()
	}
	write()
} else if (!isMainThread && workerData?.mode) {
	/* worker thread */
	const { mode, bytes, frames, sab } = workerData
	let seq = 0
	if (mode === 'sab') {
		const free = []
		for (let i = 0; i < workerData.slots; i++) free.push(i)
		const pump = () => {
			while (seq < frames && free.length) {
				const slot = free.pop()
				fillFrame(new Uint8Array(sab, slot * bytes, bytes), seq)
				parentPort.postMessage({ slot, seq, t: now() })
				seq++
			}
		}
		parentPort.on('message', (m) => {
			free.push(m.slot)
			pump()
		})
		pump()
	} else {
		// Paced by consumer acks (window of 4 in flight) to avoid unbounded queueing.
		let inflight = 0
		const WINDOW = 4
		const pump = () => {
			while (seq < frames && inflight < WINDOW) {
				const u8 = new Uint8Array(bytes)
				fillFrame(u8, seq)
				const msg = { seq, t: now(), buf: u8.buffer }
				if (mode === 'transfer') {
					parentPort.postMessage(msg, [u8.buffer])
					if (u8.buffer.byteLength !== 0) throw new Error('buffer was not detached by transfer')
				} else {
					parentPort.postMessage(msg)
				}
				inflight++
				seq++
			}
		}
		parentPort.on('message', () => {
			inflight--
			pump()
		})
		pump()
	}
}

if (isMainThread && process.argv[2] !== '--child') {
	const args = process.argv.slice(2)
	const frames = Number((args.find((a) => a.startsWith('--frames=')) ?? '--frames=300').split('=')[1])
	const asJson = args.includes('--json')
	const warm = Math.min(20, Math.floor(frames / 10))
	const results = []

	const stats = (lat, t0, t1, bytes, rss0, rssPeak, ab0, abPeak) => {
		const sorted = [...lat].sort((a, b) => a - b)
		const q = (p) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))]
		const secs = (t1 - t0) / 1000
		return {
			fps: +(lat.length / secs).toFixed(1),
			mbps: +((lat.length * bytes) / 1048576 / secs).toFixed(0),
			latP50ms: +q(0.5).toFixed(2),
			latP95ms: +q(0.95).toFixed(2),
			latMaxms: +sorted[sorted.length - 1].toFixed(2),
			rssPeakDeltaMB: +((rssPeak - rss0) / 1048576).toFixed(0),
			arrayBuffersPeakDeltaMB: +((abPeak - ab0) / 1048576).toFixed(0),
		}
	}

	const runWorker = (mode, size) =>
		new Promise((resolve, reject) => {
			const bytes = size.w * size.h * 4
			const slots = 4
			const sab = mode === 'sab' ? new SharedArrayBuffer(bytes * slots) : undefined
			const w = new Worker(fileURLToPath(import.meta.url), { workerData: { mode, bytes, frames, sab, slots } })
			const lat = []
			let n = 0
			let t0 = 0
			const m0 = process.memoryUsage()
			let rssPeak = m0.rss
			let abPeak = m0.arrayBuffers
			w.on('error', reject)
			w.on('message', (m) => {
				const recv = now()
				// Touch one byte per page so lazy copies cannot hide.
				const u8 = mode === 'sab' ? new Uint8Array(sab, m.slot * bytes, bytes) : new Uint8Array(m.buf)
				let sum = 0
				for (let i = 0; i < u8.length; i += 4096) sum += u8[i]
				if (sum < 0) console.log(sum)
				if (n === warm) t0 = recv
				if (n >= warm) lat.push(recv - m.t)
				if (n % 10 === 0) {
					const mu = process.memoryUsage()
					rssPeak = Math.max(rssPeak, mu.rss)
					abPeak = Math.max(abPeak, mu.arrayBuffers)
				}
				n++
				w.postMessage({ slot: m.slot })
				if (n === frames) {
					const t1 = now()
					w.terminate()
					resolve(stats(lat, t0, t1, bytes, m0.rss, rssPeak, m0.arrayBuffers, abPeak))
				}
			})
		})

	const runChild = (size) =>
		new Promise((resolve, reject) => {
			const bytes = size.w * size.h * 4
			const child = spawn(process.execPath, [fileURLToPath(import.meta.url), '--child', String(bytes), String(frames)], {
				stdio: ['ignore', 'pipe', 'inherit'],
				windowsHide: true,
			})
			const lat = []
			let n = 0
			let t0 = 0
			const m0 = process.memoryUsage()
			let rssPeak = m0.rss
			let abPeak = m0.arrayBuffers
			// Reassemble frames from arbitrary chunk boundaries (one copy into a reused frame buffer).
			const frame = Buffer.allocUnsafe(bytes)
			let filled = 0
			child.stdout.on('data', (chunk) => {
				let off = 0
				while (off < chunk.length) {
					const take = Math.min(bytes - filled, chunk.length - off)
					chunk.copy(frame, filled, off, off + take)
					filled += take
					off += take
					if (filled === bytes) {
						filled = 0
						const recv = now()
						const t = frame.readDoubleLE(0)
						if (n === warm) t0 = recv
						if (n >= warm) lat.push(recv - t)
						if (n % 10 === 0) {
							const mu = process.memoryUsage()
							rssPeak = Math.max(rssPeak, mu.rss)
							abPeak = Math.max(abPeak, mu.arrayBuffers)
						}
						n++
					}
				}
			})
			child.on('error', reject)
			child.on('close', () => {
				const t1 = now()
				if (n !== frames) return reject(new Error(`child delivered ${n}/${frames} frames`))
				resolve(stats(lat, t0, t1, bytes, m0.rss, rssPeak, m0.arrayBuffers, abPeak))
			})
		})

	const scenarios = [
		['worker copy (structured clone)', (s) => runWorker('copy', s)],
		['worker transfer (ArrayBuffer)', (s) => runWorker('transfer', s)],
		['worker SharedArrayBuffer ring', (s) => runWorker('sab', s)],
		['child stdout pipe', (s) => runChild(s)],
	]
	for (const size of SIZES) {
		for (const [name, fn] of scenarios) {
			results.push({ runtime, size: size.name, path: name, frames, ...(await fn(size)) })
		}
	}
	if (asJson) console.log(JSON.stringify(results, null, 2))
	else console.table(results)
	process.exit(0)
}
