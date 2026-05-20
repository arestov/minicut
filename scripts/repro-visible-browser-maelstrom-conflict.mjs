import { mkdir, readFile, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

const repoRoot = path.resolve(fileURLToPath(new URL('..', import.meta.url)))
const APP_URL = (process.env.MINICUT_REPRO_URL ?? 'http://127.0.0.1:4176').replace(/\/$/, '')
const ROOM_ID = process.env.MINICUT_REPRO_ROOM ?? `browser-maelstrom-${Date.now()}`
const KEEP_OPEN = process.env.MINICUT_REPRO_KEEP_OPEN === '1'
const HEADLESS = process.env.MINICUT_REPRO_HEADLESS !== '0'
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

const createNodeBroker = () => {
	const peers = new Map()
	const queue = []
	let paused = true

	const batchIds = (message) => (message?.batches ?? []).map((batch) => batch?.batch_id ?? null)

	const deliver = async ({ fromLabel, message, meta }) => {
		pushTrace('node-broker:send', {
			from: fromLabel,
			peerId: meta?.peerId ?? null,
			batchIds: batchIds(message),
			paused,
		})
		if (paused) {
			queue.push({ fromLabel, message, meta })
			return
		}
		for (const [targetLabel, page] of peers) {
			if (targetLabel === fromLabel) continue
			await page.evaluate((incoming) => {
				window.__MINICUT_P2P_DEBUG__?.receiveCrdtTransportMessageTesting?.(incoming)
			}, message)
			pushTrace('node-broker:deliver', {
				from: fromLabel,
				to: targetLabel,
				batchIds: batchIds(message),
			})
		}
	}

	return {
		register(label, page) {
			peers.set(label, page)
		},
		setPaused(value) {
			paused = value
			pushTrace('node-broker:paused', { paused })
		},
		async send(fromLabel, message, meta) {
			await deliver({ fromLabel, message, meta })
		},
		async flush() {
			const items = queue.splice(0, queue.length)
			pushTrace('node-broker:flush', { count: items.length })
			for (const item of items) {
				await deliver(item)
			}
		},
	}
}

const launchProfile = async ({ label, peerId, profileDir, position, broker }) => {
	const targetUrl = `${APP_URL}/?crdtPeerId=${encodeURIComponent(peerId)}#/${ROOM_ID}`
	const context = await chromium.launchPersistentContext(profileDir, {
		headless: HEADLESS,
		viewport: { width: 980, height: 900 },
		args: [
			'--no-first-run',
			'--no-default-browser-check',
			`--window-position=${position}`,
			'--window-size=980,900',
		],
	})
	await context.exposeBinding('__MINICUT_CRDT_NODE_SEND_BRIDGE__', async (_source, message, meta) => {
		await broker.send(label, message, meta)
	})
	await context.addInitScript(() => {
		window.__MINICUT_CRDT_PAGE_BRIDGE_SEND__ = (message, meta) =>
			window.__MINICUT_CRDT_NODE_SEND_BRIDGE__(message, meta)
	})
	const page = context.pages()[0] ?? await context.newPage()
	page.on('pageerror', (error) => {
		pushTrace('browser:pageerror', {
			label,
			error: error.stack || error.message,
		})
		process.stdout.write(`[browser-pageerror:${label}] ${error.stack || error.message}\n`)
	})
	page.on('response', (response) => {
		if (response.status() >= 400) {
			pushTrace('browser:response-error', {
				label,
				status: response.status(),
				url: response.url(),
			})
		}
	})
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
	broker.register(label, page)
	return { context, page, targetUrl }
}

const debugEval = (page, fn, arg) => page.evaluate(fn, arg)

const setActiveProject = async (page, projectId) => {
	await debugEval(page, async (id) => window.__MINICUT_P2P_DEBUG__?.setActiveProject?.(id), projectId)
	await withTimeout('wait active project settle', debugEval(page, async () => window.__MINICUT_P2P_DEBUG__?.waitForRuntimeSettled?.()), 20_000)
}

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

const dispatchFirstClipResize = async (page, delta) => {
	await debugEval(page, async (payload) =>
		window.__MINICUT_P2P_DEBUG__?.dispatchFirstVideoClipAction?.('resize', payload),
		{ edge: 'end', delta },
	)
	await withTimeout('wait for resize settle', debugEval(page, async () => window.__MINICUT_P2P_DEBUG__?.waitForRuntimeSettled?.()), 20_000)
}

const dispatchClipResize = async (page, clipId, delta) => {
	const result = await debugEval(page, async ({ clipId: targetClipId, payload }) =>
		window.__MINICUT_P2P_DEBUG__?.dispatchClipActionById?.(targetClipId, 'resize', payload),
		{ clipId, payload: { edge: 'end', delta } },
	)
	await withTimeout('wait for resize settle', debugEval(page, async () => window.__MINICUT_P2P_DEBUG__?.waitForRuntimeSettled?.()), 20_000)
	return result
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
				worker: {
					workspaceOpenState: workerState?.workspaceOpenState ?? null,
					runtimeError: workerState?.runtimeError ?? null,
					modelsCount: workerState?.modelsCount ?? null,
					rootNodeId: workerState?.rootNodeId ?? null,
					crdt: workerState?.crdt ?? null,
					projects: Array.isArray(workerState?.workerState?.runtimeModels)
						? workerState.workerState.runtimeModels
							.filter((model) => model?.modelName === 'project')
							.map((model) => ({
								nodeId: model?.nodeId,
								title: model?.attrs?.title,
								tracks: model?.rels?.tracks ?? null,
								resources: model?.rels?.resources ?? null,
							}))
						: [],
					sessionRoots: Array.isArray(workerState?.workerState?.runtimeModels)
						? workerState.workerState.runtimeModels
							.filter((model) => model?.modelName === 'session_root')
							.map((model) => ({
								nodeId: model?.nodeId,
								sessionKey: model?.attrs?.sessionKey,
								activeProject: model?.rels?.activeProject ?? null,
							}))
						: [],
				},
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

const compactPeerSummary = (summary) => ({
	peerId: summary?.peerId ?? null,
	clips: summary?.clips ?? [],
	badgeCount: summary?.badgeCount ?? 0,
	conflictClipCount: summary?.conflictClipCount ?? 0,
	projects: summary?.worker?.projects ?? [],
	sessionRoots: summary?.worker?.sessionRoots ?? [],
	runtimeError: summary?.worker?.runtimeError ?? null,
})

const projectHasImportedResource = (summary, projectId) => {
	const project = summary?.worker?.projects?.find((item) => item?.nodeId === projectId)
	return Boolean(
		project &&
		Array.isArray(project.resources) &&
		project.resources.length >= 1,
	)
}

const main = async () => {
	const launched = []
	let stage = 'init'
	const baseDir = path.join(os.tmpdir(), `minicut-browser-maelstrom-${Date.now()}`)
	const profileA = path.join(baseDir, 'profile-a')
	const profileB = path.join(baseDir, 'profile-b')
	const broker = createNodeBroker()
	await mkdir(profileA, { recursive: true })
	await mkdir(profileB, { recursive: true })

	try {
	stage = 'launch A'
	log('launching', { roomId: ROOM_ID })
	const a = await launchProfile({ label: 'A', peerId: 'A', profileDir: profileA, position: '0,0', broker })
	launched.push(a)
	log('launched A')
	stage = 'launch B'
	const b = await launchProfile({ label: 'B', peerId: 'B', profileDir: profileB, position: '1000,0', broker })
	launched.push(b)
	log('launched B')
	stage = 'wait ready'
	await Promise.all([waitReady(a.page, 'A'), waitReady(b.page, 'B')])
	log('both ready')
	broker.setPaused(false)
	await broker.flush()

	stage = 'import baseline'
	await importAndAddFixture(a.page)
	log('A imported baseline')
	const baselineSummaryA = await projectSummary(a.page)
	const sharedProjectId = baselineSummaryA.worker.projects[0]?.nodeId
	if (!sharedProjectId) {
		throw new Error('A did not expose a project id after baseline import')
	}
	stage = 'wait B receives shared project'
	await waitFor('B worker receives A project', async () => {
		const summaryB = await projectSummary(b.page)
		return projectHasImportedResource(summaryB, sharedProjectId)
	}, { timeoutMs: 20_000 })
	await setActiveProject(b.page, sharedProjectId)
	log('B selected A project', { sharedProjectId })
	stage = 'wait transport baseline visible'
	await b.page.getByRole('region', { name: 'Timeline', exact: true }).getByRole('button', { name: /fixture-video\.webm/i }).first()
		.waitFor({ state: 'visible', timeout: 20_000 })
	log('B received baseline through transport')
	const baselineSummaryB = await projectSummary(b.page)
	const sharedClipId = baselineSummaryB.clips.find((clip) => clip.trackKind === 'video' && clip.name === 'fixture-video.webm')?.nodeId
	if (!sharedClipId) {
		throw new Error('B did not expose a shared video clip after baseline delivery')
	}

	stage = 'concurrent resize'
	broker.setPaused(true)
	const resizeResults = await Promise.all([
		dispatchClipResize(a.page, sharedClipId, -0.2),
		dispatchClipResize(b.page, sharedClipId, -0.5),
	])
	log('both resized', { sharedClipId, resizeResults })
	stage = 'wait transport conflict delivery'
	broker.setPaused(false)
	await broker.flush()
	await Promise.all([
		withTimeout('wait A settle after conflict', debugEval(a.page, async () => window.__MINICUT_P2P_DEBUG__?.waitForRuntimeSettled?.()), 20_000),
		withTimeout('wait B settle after conflict', debugEval(b.page, async () => window.__MINICUT_P2P_DEBUG__?.waitForRuntimeSettled?.()), 20_000),
	])
	log('transport delivered conflict edits')

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
		summary: { A: summaryA, B: summaryB },
		keepOpen: KEEP_OPEN,
		tracePath: TRACE_PATH,
	}
	const report = JSON.stringify(result, null, 2)
	const stdoutReport = JSON.stringify({
		...result,
		summary: {
			A: compactPeerSummary(summaryA),
			B: compactPeerSummary(summaryB),
		},
	}, null, 2)
	await writeFile(TRACE_PATH, `${JSON.stringify(trace, null, 2)}\n`, 'utf8')
	await writeFile(REPORT_PATH, `${report}\n`, 'utf8')
	process.stdout.write(`${stdoutReport}\nreportPath=${REPORT_PATH}\ntracePath=${TRACE_PATH}\n`)

	if (!result.ok) {
		process.exitCode = 1
	}
	} catch (error) {
		const snapshots = {}
		for (const item of launched) {
			const label = item.targetUrl.includes('crdtPeerId=A') ? 'A' : item.targetUrl.includes('crdtPeerId=B') ? 'B' : item.targetUrl
			snapshots[label] = await projectSummary(item.page).catch((snapshotError) => ({
				error: snapshotError instanceof Error ? snapshotError.stack || snapshotError.message : String(snapshotError),
			}))
		}
		const result = {
			ok: false,
			stage,
			roomId: ROOM_ID,
			error: error instanceof Error ? error.stack || error.message : String(error),
			profiles: { A: profileA, B: profileB },
			snapshots,
		}
		const report = JSON.stringify(result, null, 2)
		const stdoutReport = JSON.stringify({
			...result,
			snapshots: Object.fromEntries(
				Object.entries(snapshots).map(([label, snapshot]) => [
					label,
					snapshot && typeof snapshot === 'object' && !('error' in snapshot)
						? compactPeerSummary(snapshot)
						: snapshot,
				]),
			),
		}, null, 2)
		await writeFile(TRACE_PATH, `${JSON.stringify(trace, null, 2)}\n`, 'utf8').catch(() => undefined)
		await writeFile(REPORT_PATH, `${report}\n`, 'utf8').catch(() => undefined)
		process.stderr.write(`${stdoutReport}\nreportPath=${REPORT_PATH}\ntracePath=${TRACE_PATH}\n`)
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
