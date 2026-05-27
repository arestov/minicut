import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

const repoRoot = path.resolve(fileURLToPath(new URL('..', import.meta.url)))
const APP_URL = (process.env.MINICUT_REPRO_URL ?? 'http://127.0.0.1:4176').replace(/\/$/, '')
const ROOM_ID = process.env.MINICUT_REPRO_ROOM ?? `browser-maelstrom-${Date.now()}`
const KEEP_OPEN = process.env.MINICUT_REPRO_KEEP_OPEN === '1'
const OPEN_CONFLICT = process.env.MINICUT_REPRO_OPEN_CONFLICT !== '0'
const HEADLESS = process.env.MINICUT_REPRO_HEADLESS !== '0'
const REVIEW_ACTION = (process.env.MINICUT_REPRO_REVIEW_ACTION ?? '').trim().toLowerCase()
const ACTION_PEER = (process.env.MINICUT_REPRO_ACTION_PEER ?? 'B').trim().toUpperCase() === 'A' ? 'A' : 'B'
const OVERALL_TIMEOUT_MS = Number(process.env.MINICUT_REPRO_TIMEOUT_MS ?? 90_000)
const REPORT_PATH = process.env.MINICUT_REPRO_REPORT_PATH ?? path.join(os.tmpdir(), `minicut-browser-maelstrom-report-${Date.now()}.json`)
const TRACE_PATH = process.env.MINICUT_REPRO_TRACE_PATH ?? REPORT_PATH.replace(/\.json$/, '.trace.json')
const SCREENSHOT_DIR = process.env.MINICUT_REPRO_SCREENSHOT_DIR ?? ''
const REVIEW_ACTION_BUTTONS = {
	park: 'Park incoming on review track',
	incoming: 'Choose incoming',
	current: 'Choose current',
	local: 'Choose current',
	final: 'Apply final timing',
}

const trace = []
const requestFailures = []
const pushTrace = (event, details = {}) => {
	trace.push({
		at: new Date().toISOString(),
		event,
		...details,
	})
}

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const waitForever = () => new Promise(() => {})
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

const readHarnessError = async (page) =>
	page.locator('[role="alert"]').filter({ hasText: 'CRDT harness error' }).first()
		.innerText({ timeout: 250 })
		.catch(() => null)

const assertNoHarnessError = async (page, label) => {
	const text = await readHarnessError(page)
	if (text) {
		throw new Error(`${label}: ${text}`)
	}
}

const assertPeersHealthy = async (a, b, stageLabel) => {
	await Promise.all([
		assertNoHarnessError(a.page, `${stageLabel}: A`),
		assertNoHarnessError(b.page, `${stageLabel}: B`),
	])
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
	const ensureMessageId = (message, fromLabel) => {
		if (!message || typeof message !== 'object') return null
		if (typeof message.debug_message_id === 'string' && message.debug_message_id) {
			return message.debug_message_id
		}
		const id = `node-broker:${fromLabel}:${Date.now().toString(36)}:${randomUUID().slice(0, 8)}`
		message.debug_message_id = id
		return id
	}

	const deliver = async ({ fromLabel, message, meta }) => {
		const messageId = ensureMessageId(message, fromLabel)
		pushTrace('node-broker:send', {
			from: fromLabel,
			peerId: meta?.peerId ?? null,
			messageId,
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
				messageId,
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
	page.on('requestfailed', (request) => {
		const failure = {
			label,
			url: request.url(),
			errorText: request.failure()?.errorText ?? null,
		}
		requestFailures.push(failure)
		pushTrace('browser:requestfailed', failure)
		process.stdout.write(`[browser-requestfailed:${label}] ${failure.errorText ?? 'failed'} ${failure.url}\n`)
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

const selectProjectAndWaitForTimeline = async (page, projectId) =>
	waitFor('shared project timeline visible', async () => {
		await setActiveProject(page, projectId)
		const clip = page
			.getByRole('region', { name: 'Timeline', exact: true })
			.getByRole('button', { name: /fixture-video\.webm/i })
			.first()
		return await clip.isVisible().catch(() => false)
	}, { timeoutMs: 20_000, intervalMs: 500 })

const waitReady = async (page, label) => {
	await waitFor(`${label}: runtime ready`, async () =>
		debugEval(page, () => window.__MINICUT_P2P_DEBUG__?.isRuntimeReady?.() === true),
	)
	await assertNoHarnessError(page, label)
	const workerState = await debugEval(page, async () => window.__MINICUT_P2P_DEBUG__?.dumpWorkerState?.())
	const peerId = workerState?.workerState?.crdt?.peerId ?? workerState?.crdt?.peerId
	if (typeof peerId !== 'string' || !peerId.startsWith('minicut-browser:')) {
		throw new Error(
			`${label}: CRDT test harness transport is not enabled; start Vite with VITE_MINICUT_ENABLE_CRDT_TEST_HARNESS=1`,
		)
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

const readClipDuration = async (page, clipId) =>
	debugEval(page, (targetClipId) => {
		const details = window.__MINICUT_P2P_DEBUG__?.getActiveProjectDetails?.()
		const clip = (details?.tracks ?? [])
			.flatMap((track) => track?.clips ?? [])
			.find((candidate) =>
				candidate?.clipId === targetClipId ||
				candidate?.nodeId === targetClipId ||
				candidate?.id === targetClipId,
			)
		return typeof clip?.duration === 'number' ? clip.duration : null
	}, clipId)

const dragClipEdgeByUi = async (page, clipId, edge, deltaPx) => {
	const before = await readClipDuration(page, clipId)
	if (before === null) throw new Error(`Missing clip duration before UI drag: ${clipId}`)
	const clip = page
		.getByRole('region', { name: 'Timeline', exact: true })
		.locator('.ve-clip')
		.filter({ hasText: 'fixture-video.webm' })
		.first()
	await clip.waitFor({ state: 'visible', timeout: 10_000 })
	const handle = clip.locator(`.ve-clip__resize-handle--${edge}`)
	const box = await handle.boundingBox()
	if (!box) throw new Error(`Missing ${edge} resize handle`)
	const x = box.x + box.width / 2
	const y = box.y + box.height / 2
	await page.mouse.move(x, y)
	await page.mouse.down()
	await page.mouse.move(x + deltaPx, y, { steps: 6 })
	await page.mouse.up()
	await withTimeout('wait for UI drag settle', debugEval(page, async () => window.__MINICUT_P2P_DEBUG__?.waitForRuntimeSettled?.()), 20_000)
	await waitFor('clip duration changed after UI drag', async () => {
		const next = await readClipDuration(page, clipId)
		return next !== null && next !== before
	}, { timeoutMs: 10_000 })
}

const projectSummary = async (page) =>
	debugEval(page, () => {
		const state = window.__MINICUT_P2P_DEBUG__?.dumpProjectState?.()
		const worker = window.__MINICUT_P2P_DEBUG__?.dumpWorkerState?.()
		const review = window.__MINICUT_P2P_DEBUG__?.getReviewDebugState?.()
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
				activeProjectId: state?.projectNodeId ?? null,
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
				review: {
					openItemCount: (review?.activeProjectReviewItems ?? []).filter((item) => item?.attrs?.status === 'open').length,
					items: (review?.activeProjectReviewItems ?? []).map((item) => ({
						nodeId: item?.nodeId ?? null,
						reviewItemId: item?.attrs?.reviewItemId ?? null,
						conflictId: item?.attrs?.conflictId ?? null,
						kind: item?.attrs?.kind ?? null,
						status: item?.attrs?.status ?? null,
					})),
				},
				clips,
				badgeCount: document.querySelectorAll('.clip-conflict-badge').length,
				visibleConflictCount: document.querySelectorAll('.clip-conflict-badge').length,
				reviewButtonText: Array.from(document.querySelectorAll('button'))
					.map((button) => button.textContent?.trim() ?? '')
					.find((text) => /^Review\s+\d+/.test(text)) ?? null,
				conflictClipCount: clips.filter((clip) =>
					Number(clip.openModel) > 0 ||
					Number(clip.openTiming) > 0 ||
					Number(clip.openDuration) > 0 ||
					Number(clip.conflictRelCount) > 0,
				).length,
			}
		})
	})

const readReviewState = async (page) =>
	debugEval(page, () => window.__MINICUT_P2P_DEBUG__?.getReviewDebugState?.() ?? null)

const reviewOpenCount = (state) => {
	const itemCount = reviewItems(state).filter((item) => item.attrs?.status === 'open').length
	if (reviewItems(state).length > 0) {
		return itemCount
	}
	const count =
		state?.activeProjectReviewSessions?.find((session) => typeof session?.attrs?.openItemCount === 'number')?.attrs?.openItemCount ??
		state?.activeProject?.attrs?.reviewOpenItemCount
	return typeof count === 'number' && Number.isFinite(count) ? count : null
}

const reviewItems = (state) =>
	(state?.activeProjectReviewItems ?? []).map((item) => ({
		nodeId: item?.nodeId ?? null,
		attrs: item?.attrs ?? {},
	}))

const firstOpenClipTimingItem = (state) =>
	reviewItems(state).find((item) => item.attrs?.kind === 'clip_timing' && item.attrs?.status === 'open') ??
	reviewItems(state).find((item) => item.attrs?.kind === 'clip_timing') ??
	null

const reviewItemConflictGroupId = (item) => {
	const source = item?.attrs?.source
	return source && typeof source === 'object' && typeof source.conflictGroupId === 'string'
		? source.conflictGroupId
		: null
}

const reviewItemAffectedClipIds = (item) =>
	Array.isArray(item?.attrs?.affectedObjects)
		? item.attrs.affectedObjects.flatMap((object) =>
				object && typeof object === 'object' && object.type === 'clip' && typeof object.id === 'string'
					? [object.id]
					: [],
			)
		: []

const sameClipTimingReviewGroup = (candidate, selected) => {
	if (candidate?.attrs?.kind !== 'clip_timing' || selected?.attrs?.kind !== 'clip_timing') {
		return false
	}
	const candidateGroupId = reviewItemConflictGroupId(candidate)
	const selectedGroupId = reviewItemConflictGroupId(selected)
	if (candidateGroupId && selectedGroupId) {
		return candidateGroupId === selectedGroupId
	}
	const selectedClipIds = new Set(reviewItemAffectedClipIds(selected))
	return reviewItemAffectedClipIds(candidate).some((clipId) => selectedClipIds.has(clipId))
}

const waitForReviewItemStatus = async (page, conflictId, status) =>
	waitFor(`review item ${conflictId} status ${status}`, async () => {
		const state = await readReviewState(page)
		const item = reviewItems(state).find((entry) => entry.attrs?.conflictId === conflictId)
		return item?.attrs?.status === status ? item : null
	}, { timeoutMs: 30_000, intervalMs: 250 })

const waitForReviewOpenCount = async (page, expected) =>
	waitFor(`review open count ${expected}`, async () => {
		const state = await readReviewState(page)
		return reviewOpenCount(state) === expected ? state : null
	}, { timeoutMs: 30_000, intervalMs: 250 })

const waitForIncomingReviewTrack = async (page) =>
	waitFor('incoming review track with parked clip', async () => {
		const details = await debugEval(page, () => window.__MINICUT_P2P_DEBUG__?.getActiveProjectDetails?.() ?? null)
		const track = details?.tracks?.find((candidate) => candidate?.trackRole === 'incomingReview')
		return track?.clips?.length > 0 ? track : null
	}, { timeoutMs: 30_000, intervalMs: 250 })

const timingFields = ['start', 'in', 'duration', 'fadeIn', 'fadeOut']

const strictTiming = (value, label) => {
	const timing = Object.fromEntries(timingFields.map((field) => [field, value?.[field]]))
	for (const field of timingFields) {
		if (typeof timing[field] !== 'number' || !Number.isFinite(timing[field])) {
			throw new Error(`Expected numeric ${label}.${field}, got ${JSON.stringify(value)}`)
		}
	}
	return timing
}

const readClipTimingFromDetails = (details, clipId) => {
	const clip = details?.tracks
		?.flatMap((track) => track?.clips ?? [])
		.find((candidate) =>
			candidate?.clipId === clipId ||
			candidate?.nodeId === clipId ||
			candidate?.id === clipId,
		)
	return clip ? strictTiming(clip, `clip ${clipId}`) : null
}

const readIncomingReviewTrackTimingFromDetails = (details) => {
	const clip = details?.tracks?.find((track) => track?.trackRole === 'incomingReview')?.clips?.[0]
	return clip ? strictTiming(clip, 'parked clip') : null
}

const waitForParkTimingConvergence = async ({ acting, passive, sourceClipId, sourceTiming, parkedTiming }) =>
	waitFor('park timing convergence on both peers', async () => {
		const [actingDetails, passiveDetails] = await Promise.all([
			debugEval(acting.page, () => window.__MINICUT_P2P_DEBUG__?.getActiveProjectDetails?.() ?? null),
			debugEval(passive.page, () => window.__MINICUT_P2P_DEBUG__?.getActiveProjectDetails?.() ?? null),
		])
		const actual = {
			[acting.label]: {
				source: readClipTimingFromDetails(actingDetails, sourceClipId),
				parked: readIncomingReviewTrackTimingFromDetails(actingDetails),
			},
			[passive.label]: {
				source: readClipTimingFromDetails(passiveDetails, sourceClipId),
				parked: readIncomingReviewTrackTimingFromDetails(passiveDetails),
			},
		}
		return JSON.stringify(actual[acting.label].source) === JSON.stringify(sourceTiming) &&
			JSON.stringify(actual[passive.label].source) === JSON.stringify(sourceTiming) &&
			JSON.stringify(actual[acting.label].parked) === JSON.stringify(parkedTiming) &&
			JSON.stringify(actual[passive.label].parked) === JSON.stringify(parkedTiming)
			? actual
			: null
	}, { timeoutMs: 30_000, intervalMs: 250 })

const reviewActionButtonName = (action) => {
	const label = REVIEW_ACTION_BUTTONS[action]
	if (!label) {
		throw new Error(`Unknown MINICUT_REPRO_REVIEW_ACTION "${REVIEW_ACTION}". Expected one of: ${Object.keys(REVIEW_ACTION_BUTTONS).join(', ')}`)
	}
	return label
}

const clickReviewActionAndAssert = async ({ acting, passive, broker, action }) => {
	const actingStateBefore = await readReviewState(acting.page)
	const passiveStateBefore = await readReviewState(passive.page)
	const item = firstOpenClipTimingItem(actingStateBefore)
	const conflictId = item?.attrs?.conflictId
	if (typeof conflictId !== 'string' || conflictId.length === 0) {
		throw new Error(`No open clip timing review item on peer ${acting.label}`)
	}
	const openBeforeActing = reviewOpenCount(actingStateBefore)
	const openBeforePassive = reviewOpenCount(passiveStateBefore)
	if (openBeforeActing === null || openBeforePassive === null) {
		throw new Error(`Missing review open count before ${action}: ${JSON.stringify({ acting: openBeforeActing, passive: openBeforePassive })}`)
	}
	if (openBeforeActing !== openBeforePassive) {
		throw new Error(`Review open count diverged before ${action}: ${openBeforeActing} vs ${openBeforePassive}`)
	}
	const groupItems = reviewItems(actingStateBefore).filter(
		(candidate) => candidate.attrs?.status === 'open' && sameClipTimingReviewGroup(candidate, item),
	)
	const sourceClipId = reviewItemAffectedClipIds(item)[0]
	const sourceTiming = action === 'park' ? strictTiming(item?.attrs?.preview?.current, 'preview.current') : null
	const parkedTiming = action === 'park' ? strictTiming(item?.attrs?.preview?.incoming, 'preview.incoming') : null
	const resolvedConflictIds = groupItems
		.map((candidate) => candidate.attrs?.conflictId)
		.filter((candidate) => typeof candidate === 'string' && candidate.length > 0)
	const expectedResolvedCount = Math.max(1, resolvedConflictIds.length)

	const panel = acting.page.getByRole('region', { name: 'Project review' })
	if (action === 'final') {
		await panel.getByLabel('Final start').fill('0.25')
	}
	await panel.getByRole('button', { name: reviewActionButtonName(action) }).click()
	await withTimeout(`wait ${acting.label} settle after ${action}`, debugEval(acting.page, async () => window.__MINICUT_P2P_DEBUG__?.waitForRuntimeSettled?.()), 20_000)
	await broker.flush()
	await Promise.all([
		withTimeout(`wait ${acting.label} post-action settle`, debugEval(acting.page, async () => window.__MINICUT_P2P_DEBUG__?.waitForRuntimeSettled?.()), 20_000),
		withTimeout(`wait ${passive.label} post-action settle`, debugEval(passive.page, async () => window.__MINICUT_P2P_DEBUG__?.waitForRuntimeSettled?.()), 20_000),
	])

	const expectedOpenCount = Math.max(0, openBeforeActing - expectedResolvedCount)
	await Promise.all([
		...resolvedConflictIds.flatMap((resolvedConflictId) => [
			waitForReviewItemStatus(acting.page, resolvedConflictId, 'resolved'),
			waitForReviewItemStatus(passive.page, resolvedConflictId, 'resolved'),
		]),
		waitForReviewOpenCount(acting.page, expectedOpenCount),
		waitForReviewOpenCount(passive.page, expectedOpenCount),
	])
	if (action === 'park') {
		await Promise.all([
			waitForIncomingReviewTrack(acting.page),
			waitForIncomingReviewTrack(passive.page),
		])
		if (!sourceClipId || !sourceTiming || !parkedTiming) {
			throw new Error(`Missing park timing contract data: ${JSON.stringify({ sourceClipId, sourceTiming, parkedTiming })}`)
		}
		await waitForParkTimingConvergence({
			acting,
			passive,
			sourceClipId,
			sourceTiming,
			parkedTiming,
		})
	}
	const [actingAfter, passiveAfter] = await Promise.all([
		readReviewState(acting.page),
		readReviewState(passive.page),
	])
	const result = {
		action,
		actingPeer: acting.label,
		conflictId,
		resolvedConflictIds,
		openBefore: openBeforeActing,
		openAfter: {
			[acting.label]: reviewOpenCount(actingAfter),
			[passive.label]: reviewOpenCount(passiveAfter),
		},
	}
	pushTrace('review-action:asserted', result)
	log('review action converged', result)
	return result
}

const openProjectReview = async (page) => {
	const reviewButton = page.getByRole('button', { name: /Review\s+[1-9]\d*/ }).first()
	await reviewButton.waitFor({ state: 'visible', timeout: 20_000 })
	await reviewButton.click()
	const panel = page.getByRole('region', { name: 'Project review' })
	await panel.waitFor({
		state: 'visible',
		timeout: 20_000,
	})
	await waitFor('project review details', async () => {
		const text = await panel.innerText().catch(() => '')
		return text &&
			/text timing|clip timing|conflict/i.test(text)
			? text
			: null
	}, { timeoutMs: 20_000, intervalMs: 250 })
}

const compactPeerSummary = (summary) => ({
	peerId: summary?.peerId ?? null,
	activeProjectId: summary?.activeProjectId ?? null,
	clips: summary?.clips ?? [],
	badgeCount: summary?.badgeCount ?? 0,
	visibleConflictCount: summary?.visibleConflictCount ?? summary?.badgeCount ?? 0,
	reviewButtonText: summary?.reviewButtonText ?? null,
	conflictClipCount: summary?.conflictClipCount ?? 0,
	review: summary?.review ?? null,
	projects: summary?.worker?.projects ?? [],
	sessionRoots: summary?.worker?.sessionRoots ?? [],
	runtimeError: summary?.worker?.runtimeError ?? null,
})

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
	await assertPeersHealthy(a, b, 'after ready')
	broker.setPaused(false)
	await broker.flush()

	stage = 'import baseline'
	await importAndAddFixture(a.page)
	await assertPeersHealthy(a, b, 'after baseline import')
	log('A imported baseline')
	const baselineSummaryA = await projectSummary(a.page)
	const sharedProjectId = baselineSummaryA.activeProjectId
	if (!sharedProjectId) {
		throw new Error('A did not expose a project id after baseline import')
	}
	stage = 'select shared project on B'
	await selectProjectAndWaitForTimeline(b.page, sharedProjectId)
	await assertPeersHealthy(a, b, 'after B selects shared project')
	log('B selected A project', { sharedProjectId })
	log('B received baseline through transport')
	const baselineSummaryB = await projectSummary(b.page)
	const sharedClipId = baselineSummaryB.clips.find((clip) => clip.trackKind === 'video' && clip.name === 'fixture-video.webm')?.nodeId
	if (!sharedClipId) {
		throw new Error('B did not expose a shared video clip after baseline delivery')
	}

	stage = 'concurrent resize'
	broker.setPaused(true)
	const resizeResults = await Promise.all([
		dragClipEdgeByUi(a.page, sharedClipId, 'end', -28),
		dragClipEdgeByUi(b.page, sharedClipId, 'start', 28),
	])
	await assertPeersHealthy(a, b, 'after concurrent resize')
	log('both resized', { sharedClipId, resizeResults })
	stage = 'wait transport conflict delivery'
	broker.setPaused(false)
	await broker.flush()
	await assertPeersHealthy(a, b, 'after conflict flush')
	await Promise.all([
		withTimeout('wait A settle after conflict', debugEval(a.page, async () => window.__MINICUT_P2P_DEBUG__?.waitForRuntimeSettled?.()), 20_000),
		withTimeout('wait B settle after conflict', debugEval(b.page, async () => window.__MINICUT_P2P_DEBUG__?.waitForRuntimeSettled?.()), 20_000),
	])
	await assertPeersHealthy(a, b, 'after conflict settle')
	log('transport delivered conflict edits')

	await waitFor('visible conflict badges', async () => {
		const [summaryA, summaryB] = await Promise.all([projectSummary(a.page), projectSummary(b.page)])
		return summaryA.conflictClipCount > 0 && summaryB.conflictClipCount > 0
			? { summaryA, summaryB }
			: null
	}, { timeoutMs: 20_000 }).catch(() => null)

	if (OPEN_CONFLICT) {
		await Promise.all([
			openProjectReview(a.page),
			openProjectReview(b.page),
		])
		log('opened project review panels')
	}

	let reviewActionResult = null
	if (REVIEW_ACTION) {
		if (!OPEN_CONFLICT) {
			throw new Error('MINICUT_REPRO_REVIEW_ACTION requires MINICUT_REPRO_OPEN_CONFLICT=1')
		}
		stage = `review action ${REVIEW_ACTION} on ${ACTION_PEER}`
		const acting = ACTION_PEER === 'A' ? { ...a, label: 'A' } : { ...b, label: 'B' }
		const passive = ACTION_PEER === 'A' ? { ...b, label: 'B' } : { ...a, label: 'A' }
		reviewActionResult = await clickReviewActionAndAssert({
			acting,
			passive,
			broker,
			action: REVIEW_ACTION,
		})
	}

	const [summaryA, summaryB] = await Promise.all([projectSummary(a.page), projectSummary(b.page)])
	const screenshots = {}
	if (SCREENSHOT_DIR) {
		await mkdir(SCREENSHOT_DIR, { recursive: true })
		screenshots.A = path.join(SCREENSHOT_DIR, `${ROOM_ID}-A.png`)
		screenshots.B = path.join(SCREENSHOT_DIR, `${ROOM_ID}-B.png`)
		await Promise.all([
			a.page.screenshot({ path: screenshots.A, fullPage: true }),
			b.page.screenshot({ path: screenshots.B, fullPage: true }),
		])
	}
	const noBlobFailures = !requestFailures.some((failure) => failure.url.startsWith('blob:'))
	const actionOk = reviewActionResult
		? reviewActionResult.openAfter?.A === 0 &&
			reviewActionResult.openAfter?.B === 0 &&
			summaryA.badgeCount === 0 &&
			summaryB.badgeCount === 0
		: null
	const result = {
		ok: noBlobFailures && (actionOk ?? (
			summaryA.conflictClipCount > 0 &&
			summaryB.conflictClipCount > 0
		)),
		roomId: ROOM_ID,
		targets: { A: a.targetUrl, B: b.targetUrl },
		profiles: { A: profileA, B: profileB },
		summary: { A: summaryA, B: summaryB },
		reviewAction: reviewActionResult,
		requestFailures,
		screenshots,
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
		reviewAction: reviewActionResult,
		requestFailures,
		screenshots,
	}, null, 2)
	await writeFile(TRACE_PATH, `${JSON.stringify(trace, null, 2)}\n`, 'utf8')
	await writeFile(REPORT_PATH, `${report}\n`, 'utf8')
	process.stdout.write(`${stdoutReport}\nreportPath=${REPORT_PATH}\ntracePath=${TRACE_PATH}\n`)

	if (!result.ok) {
		process.exitCode = 1
	}
	if (KEEP_OPEN && !process.exitCode) {
		log('scenario complete; keeping browsers open')
		await waitForever()
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
if (!KEEP_OPEN || process.exitCode) {
	setTimeout(() => process.exit(process.exitCode ?? 0), 50)
}
