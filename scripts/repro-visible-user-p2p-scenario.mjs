import { spawn } from 'node:child_process'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

const repoRoot = path.resolve(fileURLToPath(new URL('..', import.meta.url)))
const APP_URL = (process.env.MINICUT_REPRO_URL ?? 'http://127.0.0.1:4174').replace(/\/$/, '')
const SIGNAL_URL = process.env.MINICUT_SIGNAL_URL ?? 'http://127.0.0.1:8787'
const ROOM_ID = process.env.MINICUT_REPRO_ROOM ?? `visible-user-conflict-${Date.now()}`
const TARGET_URL = `${APP_URL}/?signalUrl=${encodeURIComponent(SIGNAL_URL)}#/${ROOM_ID}`
const KEEP_OPEN = process.env.MINICUT_REPRO_KEEP_OPEN !== '0'
const FORCE_EXIT = process.env.MINICUT_REPRO_FORCE_EXIT !== '0'
const REPORT_PATH = process.env.MINICUT_REPRO_REPORT_PATH ?? path.join(os.tmpdir(), `minicut-visible-user-p2p-report-${Date.now()}.json`)
const getFreePort = () =>
	new Promise((resolve, reject) => {
		const server = net.createServer()
		server.unref()
		server.once('error', reject)
		server.listen(0, '127.0.0.1', () => {
			const address = server.address()
			server.close(() => {
				if (address && typeof address === 'object') {
					resolve(address.port)
				} else {
					reject(new Error('Could not allocate a local port'))
				}
			})
		})
	})

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

const waitFor = async (label, fn, { timeoutMs = 30_000, intervalMs = 250 } = {}) => {
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

const health = async (url) => {
	try {
		const response = await fetch(url)
		return response.ok
	} catch {
		return false
	}
}

const assertServers = async () => {
	if (!await health(APP_URL)) {
		throw new Error(`Frontend is not reachable at ${APP_URL}. Start it first, for example with npm.cmd run dev:full.`)
	}
	if (!await health(`${SIGNAL_URL.replace(/\/$/, '')}/api/health`)) {
		throw new Error(`P2P signal backend is not reachable at ${SIGNAL_URL}. Start it first, for example with npm.cmd run dev:full.`)
	}
}

const launchProfile = async ({ label, profileDir, port, position }) => {
	const child = spawn(chromium.executablePath(), [
		`--user-data-dir=${profileDir}`,
		`--remote-debugging-port=${port}`,
		'--no-first-run',
		'--no-default-browser-check',
		'--new-window',
		'--window-size=980,900',
		`--window-position=${position}`,
		TARGET_URL,
	], {
		detached: true,
		stdio: 'ignore',
	})
	child.unref()

	const browser = await waitFor(`${label}: CDP`, async () => {
		try {
			return await chromium.connectOverCDP(`http://127.0.0.1:${port}`)
		} catch {
			return null
		}
	}, { timeoutMs: 30_000, intervalMs: 500 })
	const context = browser.contexts()[0]
	const page = context.pages()[0] ?? await context.newPage()
	await page.goto(TARGET_URL)
	return { browser, context, page, child }
}

const readDebug = (page) =>
	page.evaluate(() => {
		const debug = window.__MINICUT_P2P_DEBUG__
		if (!debug) return null
		return {
			role: debug.getRole?.() ?? null,
			peerId: debug.getPeerId?.() ?? null,
			ready: debug.isRuntimeReady?.() ?? false,
			state: debug.dumpProjectState?.() ?? null,
			selection: debug.getSelectionState?.() ?? null,
			body: document.body.innerText,
		}
	})

const waitForReady = async (page, label) => {
	await waitFor(`${label}: debug ready`, async () => {
		const debug = await readDebug(page)
		return debug?.ready ? debug : null
	}, { timeoutMs: 45_000 })
	const body = await page.locator('body').innerText({ timeout: 5_000 })
	if (body.includes('CRDT harness error')) {
		throw new Error(`${label}: CRDT harness error is visible:\n${body}`)
	}
}

const waitForRolePair = async (left, right) => {
	await waitFor('server/client role pair', async () => {
		const [a, b] = await Promise.all([readDebug(left), readDebug(right)])
		const roles = [a?.role, b?.role]
		return roles.includes('server') && roles.includes('client') ? { left: a, right: b } : null
	}, { timeoutMs: 75_000 })
}

const summarize = (debug) => {
	const tracks = Array.isArray(debug?.state?.tracks) ? debug.state.tracks : []
	const clips = tracks.flatMap((track) =>
		Array.isArray(track?.clips)
			? track.clips.map((clip) => ({
					trackKind: track?.attrs?.kind ?? null,
					nodeId: clip?.nodeId ?? null,
					name: clip?.attrs?.name ?? null,
					start: clip?.attrs?.start ?? null,
					in: clip?.attrs?.in ?? null,
					duration: clip?.attrs?.duration ?? null,
					openModel: clip?.attrs?.['$meta$model$crdt$open_conflicts_count'] ?? 0,
					openTiming: clip?.attrs?.['$meta$aggregates$crdt$clipTiming$open_conflicts_count'] ?? 0,
					conflictRelCount: Array.isArray(clip?.attrs?.crdtConflicts) ? clip.attrs.crdtConflicts.length : 0,
				}))
			: [],
	)
	return {
		role: debug?.role ?? null,
		peerId: debug?.peerId ?? null,
		projectId: debug?.state?.projectNodeId ?? null,
		resourceCount: Array.isArray(debug?.state?.resources) ? debug.state.resources.length : 0,
		clips,
		conflictClipCount: clips.filter((clip) =>
			Number(clip.openModel) > 0 || Number(clip.openTiming) > 0 || Number(clip.conflictRelCount) > 0,
		).length,
	}
}

const setActiveProjectFrom = async (targetPage, sourcePage) => {
	const projectId = await sourcePage.evaluate(() => window.__MINICUT_P2P_DEBUG__?.dumpProjectState?.()?.projectNodeId ?? null)
	if (!projectId) throw new Error('Could not read source active project id')
	await targetPage.evaluate(async (nextProjectId) => {
		await window.__MINICUT_P2P_DEBUG__?.dispatchRootAction?.('setActiveProject', nextProjectId)
		await window.__MINICUT_P2P_DEBUG__?.waitForRuntimeSettled?.()
	}, projectId)
}

const importFixtureVideo = async (page) => {
	const fixturePath = path.join(repoRoot, 'tests', 'fixtures', 'media', 'fixture-video.webm')
	const buffer = await readFile(fixturePath)
	await page.getByLabel('Import media files').setInputFiles({
		name: 'fixture-video.webm',
		mimeType: 'video/webm',
		buffer,
	})
	await page.getByLabel('Media bin').locator('.ve-resource-row').filter({ hasText: 'fixture-video.webm' })
		.waitFor({ state: 'visible', timeout: 20_000 })
}

const addFixtureToTimeline = async (page) => {
	const row = page.getByLabel('Media bin').locator('.ve-resource-row').filter({ hasText: 'fixture-video.webm' })
	await row.getByRole('button', { name: 'Add to timeline' }).click({ timeout: 10_000 })
	await page.getByRole('region', { name: 'Timeline', exact: true }).getByRole('button', { name: /fixture-video\.webm/i }).first()
		.waitFor({ state: 'visible', timeout: 20_000 })
}

const resizeFirstVideoClipEnd = async (page, deltaPx) => {
	const clip = page.getByRole('region', { name: 'Timeline', exact: true }).getByRole('button', { name: /fixture-video\.webm/i }).first()
	await clip.click({ timeout: 10_000 })
	const handle = clip.locator('.ve-clip__resize-handle--end')
	const box = await handle.boundingBox()
	if (!box) throw new Error('Clip end resize handle is unavailable')
	const x = box.x + box.width / 2
	const y = box.y + box.height / 2
	await page.mouse.move(x, y)
	await page.mouse.down()
	await page.mouse.move(x + deltaPx, y, { steps: 8 })
	await page.mouse.up()
	await page.evaluate(async () => window.__MINICUT_P2P_DEBUG__?.waitForRuntimeSettled?.())
}

const main = async () => {
	await assertServers()
	const profilePortA = Number(process.env.MINICUT_REPRO_CDP_A ?? await getFreePort())
	const profilePortB = Number(process.env.MINICUT_REPRO_CDP_B ?? await getFreePort())

	const baseDir = path.join(os.tmpdir(), `minicut-visible-user-p2p-${Date.now()}`)
	const profileA = path.join(baseDir, 'profile-a')
	const profileB = path.join(baseDir, 'profile-b')
	await mkdir(profileA, { recursive: true })
	await mkdir(profileB, { recursive: true })

	const left = await launchProfile({
		label: 'left',
		profileDir: profileA,
		port: profilePortA,
		position: '0,0',
	})
	const right = await launchProfile({
		label: 'right',
		profileDir: profileB,
		port: profilePortB,
		position: '1000,0',
	})

	await Promise.all([waitForReady(left.page, 'left'), waitForReady(right.page, 'right')])
	await waitForRolePair(left.page, right.page)

	const [leftDebug, rightDebug] = await Promise.all([readDebug(left.page), readDebug(right.page)])
	const server = leftDebug.role === 'server' ? left : right
	const client = server === left ? right : left

	await importFixtureVideo(server.page)
	await addFixtureToTimeline(server.page)
	await setActiveProjectFrom(client.page, server.page)
	await client.page.getByRole('region', { name: 'Timeline', exact: true }).getByRole('button', { name: /fixture-video\.webm/i }).first()
		.waitFor({ state: 'visible', timeout: 20_000 })

	await resizeFirstVideoClipEnd(server.page, -28)
	await client.page.getByRole('region', { name: 'Timeline', exact: true }).getByRole('button', { name: /fixture-video\.webm/i }).first()
		.waitFor({ state: 'visible', timeout: 20_000 })
	await resizeFirstVideoClipEnd(client.page, 28)

	const [finalLeft, finalRight] = await Promise.all([readDebug(left.page), readDebug(right.page)])
	const result = {
		ok: true,
		targetUrl: TARGET_URL,
		roomId: ROOM_ID,
		profiles: { left: profileA, right: profileB },
		cdpPorts: { left: profilePortA, right: profilePortB },
		roles: { left: finalLeft?.role ?? null, right: finalRight?.role ?? null },
		summary: {
			left: summarize(finalLeft),
			right: summarize(finalRight),
		},
		note: 'This script uses real UI actions only. If conflictClipCount is 0, the current browser P2P route is still authoritative server/client, not an offline multi-writer CRDT browser session.',
		keepOpen: KEEP_OPEN,
	}
	const report = JSON.stringify(result, null, 2)
	await writeFile(REPORT_PATH, `${report}\n`, 'utf8')
	process.stdout.write(`${report}\n`)
	process.stdout.write(`reportPath=${REPORT_PATH}\n`)

	for (const item of [left, right]) {
		if (KEEP_OPEN && typeof item.browser.disconnect === 'function') {
			item.browser.disconnect()
		} else if (KEEP_OPEN) {
			await item.context.close().catch(() => undefined)
		} else {
			await item.browser.close().catch(() => undefined)
		}
	}
}

main()
	.catch((error) => {
		console.error(error)
		process.exitCode = 1
	})
	.finally(() => {
		if (FORCE_EXIT) {
			setTimeout(() => process.exit(process.exitCode ?? 0), 50)
		}
	})
