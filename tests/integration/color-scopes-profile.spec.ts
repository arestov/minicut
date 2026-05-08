import { expect, test } from '@playwright/test'
import fs from 'node:fs/promises'
import path from 'node:path'

const wikipediaVideoCandidates = [
	'https://upload.wikimedia.org/wikipedia/commons/transcoded/7/79/Big_Buck_Bunny_small.ogv/Big_Buck_Bunny_small.ogv.360p.webm',
]

const profileVideoPath = path.resolve('test-results/color-scopes-profile/wikipedia-sample.webm')
const fallbackVideoPath = path.resolve('tests/fixtures/media/fixture-video.webm')

type ScopeProfileEvent = {
	type: string
	at: number
	label?: string
	mode?: string
	durationMs?: number
	clipCount?: number
	sampleCount?: number
	sampled?: boolean
	resourceKind?: string
	source?: string
}

const createProjectFromMenu = async (page: import('@playwright/test').Page) => {
	const projectsRegion = page.getByLabel('Projects')
	await projectsRegion.getByRole('button').click()
	await projectsRegion.getByRole('button', { name: 'New project' }).click()
	await expect(projectsRegion.getByRole('button', { name: /Project \d+/i })).toBeVisible()
}

const getProfileVideoPath = async (): Promise<string> => {
	await fs.mkdir(path.dirname(profileVideoPath), { recursive: true })
	try {
		const existing = await fs.stat(profileVideoPath)
		if (existing.size > 0) {
			return profileVideoPath
		}
	} catch {
		// Download below.
	}

	for (const url of wikipediaVideoCandidates) {
		try {
			const response = await fetch(url)
			if (!response.ok) {
				continue
			}
			const buffer = Buffer.from(await response.arrayBuffer())
			if (buffer.byteLength > 0) {
				await fs.writeFile(profileVideoPath, buffer)
				return profileVideoPath
			}
		} catch {
			// Network is optional for this profile harness; local fixture keeps it runnable offline.
		}
	}

	return fallbackVideoPath
}

const percentile = (values: number[], p: number): number => {
	if (values.length === 0) {
		return 0
	}
	const sorted = [...values].sort((a, b) => a - b)
	return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * p))]
}

const summarizeIntervals = (events: ScopeProfileEvent[]): number[] => {
	const intervals: number[] = []
	for (let index = 1; index < events.length; index += 1) {
		intervals.push(events[index].at - events[index - 1].at)
	}
	return intervals
}

const summarizeProfile = (events: ScopeProfileEvent[], measuredMs: number) => {
	const vectorDraws = events.filter((event) => event.type === 'canvas-draw' && event.label === 'Vectorscope chroma density')
	const vectorComputes = events.filter((event) => event.type === 'compute' && event.mode === 'vectorscope')
	const sampleRequests = events.filter((event) => event.type === 'sample-request')
	const sampleResolves = events.filter((event) => event.type === 'sample-resolved')
	const drawIntervals = summarizeIntervals(vectorDraws)
	const computeDurations = vectorComputes.map((event) => event.durationMs ?? 0)
	const drawDurations = vectorDraws.map((event) => event.durationMs ?? 0)
	const sampleDurations = sampleResolves.map((event) => event.durationMs ?? 0)
	const sampleSources = sampleResolves.reduce<Record<string, number>>((counts, event) => {
		const source = event.source ?? 'unknown'
		counts[source] = (counts[source] ?? 0) + 1
		return counts
	}, {})

	return {
		measuredMs,
		vectorDrawCount: vectorDraws.length,
		vectorDrawsPerSecond: Math.round((vectorDraws.length / (measuredMs / 1000)) * 10) / 10,
		vectorDrawIntervalMs: {
			min: drawIntervals.length ? Math.round(Math.min(...drawIntervals)) : 0,
			p50: Math.round(percentile(drawIntervals, 0.5)),
			p95: Math.round(percentile(drawIntervals, 0.95)),
			max: drawIntervals.length ? Math.round(Math.max(...drawIntervals)) : 0,
		},
		vectorDrawDurationMs: {
			p50: Math.round(percentile(drawDurations, 0.5) * 100) / 100,
			p95: Math.round(percentile(drawDurations, 0.95) * 100) / 100,
		},
		vectorComputeCount: vectorComputes.length,
		vectorComputeDurationMs: {
			p50: Math.round(percentile(computeDurations, 0.5) * 100) / 100,
			p95: Math.round(percentile(computeDurations, 0.95) * 100) / 100,
		},
		sampleRequestCount: sampleRequests.length,
		sampleResolveCount: sampleResolves.length,
		sampleSources,
		sampleDurationMs: {
			p50: Math.round(percentile(sampleDurations, 0.5)),
			p95: Math.round(percentile(sampleDurations, 0.95)),
			max: sampleDurations.length ? Math.round(Math.max(...sampleDurations)) : 0,
		},
	}
}

test.describe('color scopes profile harness', () => {
	test('logs vectorscope redraw cadence while playing a real video', async ({ page }) => {
		test.setTimeout(60_000)

		const videoPath = await getProfileVideoPath()
		await page.addInitScript(() => {
			const target = window as Window & { __MINICUT_SCOPE_PROFILE__?: { events: unknown[] } }
			target.__MINICUT_SCOPE_PROFILE__ = { events: [] }
		})

		await page.goto('/')
		await createProjectFromMenu(page)
		await page.getByLabel('Import media files').setInputFiles(videoPath)

		const timeline = page.getByRole('region', { name: 'Timeline' })
		const importedClip = timeline.getByRole('button', { name: /\.webm|\.ogv|fixture-video/i }).first()
		await expect(importedClip).toBeVisible()
		await importedClip.click({ position: { x: 20, y: 18 } })
		const inspector = page.getByRole('complementary', { name: 'Inspector' })
		const colorTab = inspector.getByRole('tab', { name: 'Color' })
		await expect(colorTab).toBeVisible()
		await expect(colorTab).toBeEnabled()
		await colorTab.click()
		const preview = page.getByRole('region', { name: 'Preview panel' })
		const vectorscopeTab = preview.getByRole('tab', { name: 'Vectorscope' })
		await expect(vectorscopeTab).toBeVisible()
		await vectorscopeTab.click()
		await expect(preview.getByLabel('Vectorscope points')).toBeVisible()

		await page.evaluate(() => {
			const target = window as Window & { __MINICUT_SCOPE_PROFILE__?: { events: unknown[] } }
			target.__MINICUT_SCOPE_PROFILE__?.events.splice(0)
		})
		const measuredMs = 3200
		await preview.getByRole('button', { name: 'Play' }).click()
		await page.waitForTimeout(measuredMs)
		await preview.getByRole('button', { name: 'Pause' }).click()

		const events = await page.evaluate(() => {
			const target = window as Window & { __MINICUT_SCOPE_PROFILE__?: { events: ScopeProfileEvent[] } }
			return target.__MINICUT_SCOPE_PROFILE__?.events ?? []
		})
		const summary = summarizeProfile(events, measuredMs)
		console.log(`COLOR_SCOPE_PROFILE ${JSON.stringify({ videoPath, summary }, null, 2)}`)
		expect(summary.vectorDrawCount).toBeGreaterThan(0)
	})
})
