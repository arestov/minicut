import { mkdir, readFile, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

const repoRoot = path.resolve(fileURLToPath(new URL('..', import.meta.url)))
const APP_URL = (process.env.MINICUT_REPRO_URL ?? 'http://127.0.0.1:4176').replace(/\/$/, '')
const ROOM_ID = process.env.MINICUT_REPRO_ROOM ?? `browser-maelstrom-${Date.now()}`
const KEEP_OPEN = process.env.MINICUT_REPRO_KEEP_OPEN === '1'
const OVERALL_TIMEOUT_MS = Number(process.env.MINICUT_REPRO_TIMEOUT_MS ?? 90_000)
const REPORT_PATH = process.env.MINICUT_REPRO_REPORT_PATH ?? path.join(os.tmpdir(), `minicut-browser-maelstrom-report-${Date.now()}.json`)
const TRACE_PATH = process.env.MINICUT_REPRO_TRACE_PATH ?? REPORT_PATH.replace(/\.json$/, '.trace.json')

const trace = []
const pushTrace = (event, details = {}) => {
	trace.push({
		at: new Date().toISOString(),
		event,
		...details,
	})
}

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const log = (message, details) => {
	process.stdout.write(`[browser-maelstrom] ${message}${details ? ` ${JSON.stringify(details)}` : ''}\n`)
}

const waitFor = async (label, fn, { timeoutMs = 45_000, intervalMs = 250 } = {}) => {
	const startedAt = Date.now()
	let lastError = null
	while (Date.now() - startedAt < timeoutMs) {
		try {
			const value = await fn()
			if (value) return value
		} catch (error) {
			lastError = error
		}
		await delay(intervalMs)
	}
	throw new Error(`${label} timed out${lastError ? `: ${lastError.message}` : ''}`)
}

const withTimeout = (label, promise, timeoutMs = 20_000) =>
	Promise.race([
		promise,
		new Promise((_, reject) => setTimeout(() => reject(new Error(`${label} timed out`)), timeoutMs)),
	])

const launchProfile = async ({ label, peerId, profileDir, position }) => {
	const targetUrl = `${APP_URL}/?crdtPeerId=${encodeURIComponent(peerId)}#/${ROOM_ID}`
	const context = await chromium.launchPersistentContext(profileDir, {
		headless: false,
		viewport: { width: 980, height: 900 },
		args: [
			'--no-first-run',
			'--no-default-browser-check',
			`--window-position=${position}`,
			'--window-size=980,900',
		],
	})
	const page = context.pages()[0] ?? await context.newPage()
	page.on('console', async (message) => {
		const values = []
		for (const arg of message.args()) {
			values.push(await arg.jsonValue().catch(() => String(arg)))
		}
		const entry = {
			label,
			type: message.type(),
			text: message.text(),
			values,
		}
		pushTrace('browser:console', entry)
		if (message.text().includes('[dkt:') || message.text().includes('[minicut:crdt-debug]')) {
			process.stdout.write(`[browser-console:${label}] ${message.text()} ${JSON.stringify(values)}\n`)
		}
	})
	await withTimeout(`${label}: goto`, page.goto(targetUrl), 20_000)
	return { context, page, targetUrl }
}

const debugEval = (page, fn, arg) => page.evaluate(fn, arg)

const waitReady = async (page, label) => {
	await waitFor(`${label}: runtime ready`, async () =>
		debugEval(page, () => window.__MINICUT_P2P_DEBUG__?.isRuntimeReady?.() === true),
	)
	const body = await page.locator('body').innerText({ timeout: 5_000 })
	if (body.includes('CRDT harness error')) {
		throw new Error(`${label}: CRDT harness error:\n${body}`)
	}
}

const importAndAddFixture = async (page) => {
	const buffer = await readFile(path.join(repoRoot, 'tests', 'fixtures', 'media', 'fixture-video.webm'))
	await page.getByLabel('Import media files').setInputFiles({
		name: 'fixture-video.webm',
		mimeType: 'video/webm',
		buffer,
	})
	const row = page.getByLabel('Media bin').locator('.ve-resource-row').filter({ hasText: 'fixture-video.webm' })
	await row.waitFor({ state: 'visible', timeout: 20_000 })
	await row.getByRole('button', { name: 'Add to timeline' }).click()
	await page.getByRole('region', { name: 'Timeline', exact: true }).getByRole('button', { name: /fixture-video\.webm/i }).first()
		.waitFor({ state: 'visible', timeout: 20_000 })
	await withTimeout('wait for import settle', debugEval(page, async () => window.__MINICUT_P2P_DEBUG__?.waitForRuntimeSettled?.()), 20_000)
}

const drain = async (page, label = 'page') =>
	withTimeout(
		'drain CRDT batches',
		debugEval(page, async () => window.__MINICUT_P2P_DEBUG__?.drainCrdtBatchesTesting?.() ?? []),
		20_000,
	).then((batches) => {
		pushTrace('crdt:drain', {
			label,
			summary: summarizeBatches(batches),
			batches,
		})
		return batches
	}).catch(async (error) => {
		const messages = await debugEval(page, () => window.__MINICUT_P2P_DEBUG__?.getRuntimeMessages?.() ?? [])
			.catch(() => [])
		pushTrace('crdt:drain:error', {
			label,
			error: error instanceof Error ? error.stack || error.message : String(error),
			runtimeMessages: messages,
		})
		throw new Error(`${error.message}\nruntimeMessages=${JSON.stringify(messages).slice(-4000)}`)
	})

const summarizeBatches = (batches) => ({
	count: batches.length,
	ops: batches.reduce((sum, batch) => sum + ((batch?.ops ?? []).length), 0),
	createdModels: batches.flatMap((batch, batchIndex) =>
		(batch?.created_models ?? []).map((record, recordIndex) => ({
			batchIndex,
			recordIndex,
			nodeId: record?.node_id ?? null,
			modelName: record?.model_name ?? null,
			attrKeys: record?.attrs && typeof record.attrs === 'object' ? Object.keys(record.attrs).slice(0, 12) : [],
			relKeys: record?.rels && typeof record.rels === 'object' ? Object.keys(record.rels) : [],
			rels: record?.rels ?? null,
		})),
	).slice(0, 12),
	sampleOps: batches.flatMap((batch, batchIndex) =>
		(batch?.ops ?? []).map((op, opIndex) => ({
			batchIndex,
			opIndex,
			nodeId: op?.node_id ?? null,
			fieldId: op?.field_id ?? null,
			kind: op?.kind ?? null,
			name: op?.name ?? null,
			operation: op?.operation ?? null,
			value:
				op?.value && typeof op.value === 'object'
					? {
							keys: Object.keys(op.value).slice(0, 8),
							nodeId: op.value._node_id ?? op.value.node_id ?? op.value.nodeId ?? null,
							modelName: op.value.model_name ?? op.value.modelName ?? null,
						}
					: op?.value ?? null,
		})),
	).slice(0, 12),
	missingClock: batches.flatMap((batch, batchIndex) =>
		(batch?.ops ?? [])
			.map((op, opIndex) => ({ batchIndex, opIndex, op }))
			.filter((item) => item.op && typeof item.op === 'object' && !item.op.clock)
			.map((item) => ({
				batchIndex: item.batchIndex,
				opIndex: item.opIndex,
				keys: Object.keys(item.op),
				type: item.op.type ?? item.op.op_type ?? null,
				nodeId: item.op.node_id ?? null,
			})),
	),
})

const receive = async (page, batches, label = 'page') => {
	pushTrace('crdt:receive:start', {
		label,
		summary: summarizeBatches(batches),
		batches,
	})
	return (
	withTimeout('receive CRDT batches', debugEval(page, async (incoming) => {
		await window.__MINICUT_P2P_DEBUG__?.receiveCrdtBatchesTesting?.(incoming)
		await window.__MINICUT_P2P_DEBUG__?.waitForRuntimeSettled?.()
	}, batches), 20_000).then(
		(value) => value,
		async (error) => {
			const body = await page.locator('body').innerText({ timeout: 2_000 }).catch(() => '')
			const messages = await debugEval(page, () => window.__MINICUT_P2P_DEBUG__?.getRuntimeMessages?.() ?? [])
				.catch(() => [])
			pushTrace('crdt:receive:error', {
				label,
				error: error instanceof Error ? error.stack || error.message : String(error),
				body,
				runtimeMessages: messages,
			})
			throw new Error(`${error.message}\n${body}`)
		},
	)
	)
}

const resizeFirstClipEnd = async (page, deltaPx) => {
	const clip = page.getByRole('region', { name: 'Timeline', exact: true }).getByRole('button', { name: /fixture-video\.webm/i }).first()
	await clip.click()
	const handle = clip.locator('.ve-clip__resize-handle--end')
	const box = await handle.boundingBox()
	if (!box) throw new Error('Missing end resize handle')
	const x = box.x + box.width / 2
	const y = box.y + box.height / 2
	await page.mouse.move(x, y)
	await page.mouse.down()
	await page.mouse.move(x + deltaPx, y, { steps: 8 })
	await page.mouse.up()
	await withTimeout('wait for resize settle', debugEval(page, async () => window.__MINICUT_P2P_DEBUG__?.waitForRuntimeSettled?.()), 20_000)
}

const projectSummary = async (page) =>
	debugEval(page, () => {
		const state = window.__MINICUT_P2P_DEBUG__?.dumpProjectState?.()
		const worker = window.__MINICUT_P2P_DEBUG__?.dumpWorkerState?.()
		return Promise.resolve(worker).then((workerState) => {
			const clips = (state?.tracks ?? []).flatMap((track) =>
				(track?.clips ?? []).map((clip) => ({
					trackKind: track?.attrs?.kind,
					nodeId: clip?.nodeId,
					name: clip?.attrs?.name,
					start: clip?.attrs?.start,
					in: clip?.attrs?.in,
					duration: clip?.attrs?.duration,
					openModel: clip?.attrs?.['$meta$model$crdt$open_conflicts_count'] ?? 0,
					openTiming: clip?.attrs?.['$meta$aggregates$crdt$clipTiming$open_conflicts_count'] ?? 0,
					openDuration: clip?.attrs?.['$meta$attrs$crdt$duration$open_conflicts_count'] ?? 0,
					conflictRelCount: Array.isArray(clip?.attrs?.crdtConflicts) ? clip.attrs.crdtConflicts.length : 0,
				})),
			)
			return {
				peerId: workerState?.crdt?.peerId ?? null,
				session: window.__MINICUT_P2P_DEBUG__?.getSnapshot?.(),
				clips,
				badgeCount: document.querySelectorAll('.clip-conflict-badge').length,
				conflictClipCount: clips.filter((clip) =>
					Number(clip.openModel) > 0 ||
					Number(clip.openTiming) > 0 ||
					Number(clip.openDuration) > 0 ||
					Number(clip.conflictRelCount) > 0,
				).length,
			}
		})
	})

const main = async () => {
	const launched = []
	let stage = 'init'
	const baseDir = path.join(os.tmpdir(), `minicut-browser-maelstrom-${Date.now()}`)
	const profileA = path.join(baseDir, 'profile-a')
	const profileB = path.join(baseDir, 'profile-b')
	await mkdir(profileA, { recursive: true })
	await mkdir(profileB, { recursive: true })

	try {
	stage = 'launch A'
	log('launching', { roomId: ROOM_ID })
	const a = await launchProfile({ label: 'A', peerId: 'A', profileDir: profileA, position: '0,0' })
	launched.push(a)
	log('launched A')
	stage = 'launch B'
	const b = await launchProfile({ label: 'B', peerId: 'B', profileDir: profileB, position: '1000,0' })
	launched.push(b)
	log('launched B')
	stage = 'wait ready'
	await Promise.all([waitReady(a.page, 'A'), waitReady(b.page, 'B')])
	log('both ready')

	stage = 'import baseline'
	await importAndAddFixture(a.page)
	log('A imported baseline')
	stage = 'drain baseline'
	const baselineA = await drain(a.page, 'A baseline')
	log('drained baseline', { baselineA: summarizeBatches(baselineA) })
	stage = 'receive baseline'
	await receive(b.page, baselineA, 'B receives A baseline')
	log('B received baseline')
	stage = 'wait baseline visible'
	await b.page.getByRole('region', { name: 'Timeline', exact: true }).getByRole('button', { name: /fixture-video\.webm/i }).first()
		.waitFor({ state: 'visible', timeout: 20_000 })
	const baselineB = await drain(b.page, 'B after baseline')
	log('drained B after baseline', { baselineB: baselineB.length })

	stage = 'concurrent resize'
	await Promise.all([
		resizeFirstClipEnd(a.page, -28),
		resizeFirstClipEnd(b.page, -56),
	])
	log('both resized')
	stage = 'drain conflict batches'
	const batchesA = await drain(a.page, 'A conflict')
	const batchesB = await drain(b.page, 'B conflict')
	log('drained conflict batches', { A: batchesA.length, B: batchesB.length })
	stage = 'cross deliver conflict batches'
	await Promise.all([
		receive(a.page, batchesB, 'A receives B conflict'),
		receive(b.page, batchesA, 'B receives A conflict'),
	])
	log('cross-delivered conflict batches')

	await waitFor('visible conflict badges', async () => {
		const [summaryA, summaryB] = await Promise.all([projectSummary(a.page), projectSummary(b.page)])
		return summaryA.conflictClipCount > 0 && summaryB.conflictClipCount > 0
			? { summaryA, summaryB }
			: null
	}, { timeoutMs: 20_000 }).catch(() => null)

	const [summaryA, summaryB] = await Promise.all([projectSummary(a.page), projectSummary(b.page)])
	const result = {
		ok: summaryA.conflictClipCount > 0 && summaryB.conflictClipCount > 0,
		roomId: ROOM_ID,
		targets: { A: a.targetUrl, B: b.targetUrl },
		profiles: { A: profileA, B: profileB },
		batches: {
			baselineA: baselineA.length,
			baselineB: baselineB.length,
			conflictA: batchesA.length,
			conflictB: batchesB.length,
		},
		summary: { A: summaryA, B: summaryB },
		keepOpen: KEEP_OPEN,
		tracePath: TRACE_PATH,
	}
	const report = JSON.stringify(result, null, 2)
	await writeFile(TRACE_PATH, `${JSON.stringify(trace, null, 2)}\n`, 'utf8')
	await writeFile(REPORT_PATH, `${report}\n`, 'utf8')
	process.stdout.write(`${report}\nreportPath=${REPORT_PATH}\ntracePath=${TRACE_PATH}\n`)

	if (!result.ok) {
		process.exitCode = 1
	}
	} catch (error) {
		const result = {
			ok: false,
			stage,
			roomId: ROOM_ID,
			error: error instanceof Error ? error.stack || error.message : String(error),
			profiles: { A: profileA, B: profileB },
		}
		const report = JSON.stringify(result, null, 2)
		await writeFile(TRACE_PATH, `${JSON.stringify(trace, null, 2)}\n`, 'utf8').catch(() => undefined)
		await writeFile(REPORT_PATH, `${report}\n`, 'utf8').catch(() => undefined)
		process.stderr.write(`${report}\nreportPath=${REPORT_PATH}\ntracePath=${TRACE_PATH}\n`)
		process.exitCode = 1
	} finally {
		if (!KEEP_OPEN || process.exitCode) {
			await Promise.all(launched.map((item) => item.context.close().catch(() => undefined)))
		}
	}
}

await withTimeout('overall repro', main(), OVERALL_TIMEOUT_MS).catch(async (error) => {
	console.error(error)
	process.exitCode = 1
})
setTimeout(() => process.exit(process.exitCode ?? 0), 50)
