import { expect } from 'vitest'
import type { DktTestContext } from '../testingInit'

export type ProjectGraphNode = {
	nodeId: string
	modelName: string | null
	attrs: Record<string, unknown>
	rels: Record<string, unknown>
}

const getSingleRel = (value: unknown): string | null => {
	if (typeof value === 'string') {
		return value
	}
	return null
}

export const expectClipTiming = (
	ctx: DktTestContext,
	clip: { _node_id?: string | null } | null | undefined,
	expected: Partial<{
		start: number
		in: number
		duration: number
		sourceClipId: string
		sourceResourceId: string
		mediaKind: string
	}>,
) => {
	const clipStart = ctx.getAttr(clip, 'start')
	const clipIn = ctx.getAttr(clip, 'in')
	const clipDuration = ctx.getAttr(clip, 'duration')

	if (expected.start !== undefined) {
		expect(Number(clipStart)).toBeCloseTo(expected.start, 6)
	}
	if (expected.in !== undefined) {
		expect(Number(clipIn)).toBeCloseTo(expected.in, 6)
	}
	if (expected.duration !== undefined) {
		expect(Number(clipDuration)).toBeCloseTo(expected.duration, 6)
	}
	if (expected.sourceClipId !== undefined) {
		expect(ctx.getAttr(clip, 'sourceClipId')).toBe(expected.sourceClipId)
	}
	if (expected.sourceResourceId !== undefined) {
		expect(ctx.getAttr(clip, 'sourceResourceId')).toBe(expected.sourceResourceId)
	}
	if (expected.mediaKind !== undefined) {
		expect(ctx.getAttr(clip, 'mediaKind')).toBe(expected.mediaKind)
	}

	expect(Number(clipStart)).toBeGreaterThanOrEqual(0)
	expect(Number(clipIn)).toBeGreaterThanOrEqual(0)
	expect(Number(clipDuration)).toBeGreaterThan(0)
}

export const expectProjectGraphInvariants = async (ctx: DktTestContext): Promise<void> => {
	const activeProject = (await ctx.queryRel(ctx.sessionRoot, 'activeProject'))[0] ?? null
	expect(activeProject, 'expected active project').toBeTruthy()

	const tracks = await ctx.queryRel(activeProject!, 'tracks')
	const resources = await ctx.queryRel(activeProject!, 'resources')
	const clips = await Promise.all(tracks.map((track) => ctx.queryRel(track, 'clips')))
	const flatClips = clips.flat()

	const seenClipIds = new Set<string>()
	const seenResourceIds = new Set<string>()

	const projectIds = new Set<string>([
		activeProject!._node_id!,
		...tracks.map((track) => track._node_id!).filter(Boolean),
		...resources.map((resource) => resource._node_id!).filter(Boolean),
		...flatClips.map((clip) => clip._node_id!).filter(Boolean),
	])

	for (const track of tracks) {
		expect(ctx.getAttr(track, 'kind')).toMatch(/^(video|audio)$/)
		expect(Number(ctx.getAttr(track, 'appendStart'))).toBeGreaterThanOrEqual(0)
	}

	for (const track of tracks) {
		const trackClips = await ctx.queryRel(track, 'clips')
		const appendStart = Number(ctx.getAttr(track, 'appendStart'))
		const maxEnd = trackClips.reduce((acc, clip) => {
			const clipStart = Number(ctx.getAttr(clip, 'start'))
			const clipDuration = Number(ctx.getAttr(clip, 'duration'))
			return Math.max(acc, clipStart + clipDuration)
		}, 0)

		expect(appendStart).toBeCloseTo(maxEnd, 6)

		for (const clip of trackClips) {
			const trackRelModels = await ctx.queryRel(clip, 'track')
			expect(trackRelModels).toEqual([track])
		}
	}

	for (const clip of flatClips) {
		expectClipTiming(ctx, clip, {})
		const clipId = clip._node_id
		if (typeof clipId === 'string') {
			expect(seenClipIds.has(clipId)).toBe(false)
			seenClipIds.add(clipId)
		}

		const sourceResourceId = ctx.getAttr(clip, 'sourceResourceId')
		if (typeof sourceResourceId === 'string') {
			expect(resources.some((resource) => ctx.getAttr(resource, 'sourceResourceId') === sourceResourceId)).toBe(true)
		}

		const effects = await ctx.queryRel(clip, 'effects')
		for (const effect of effects) {
			expect(projectIds.has(effect._node_id!)).toBe(true)
			expect(await ctx.queryRel(effect, 'clip')).toEqual([clip])
		}
	}

	for (const resource of resources) {
		const resourceId = resource._node_id
		if (typeof resourceId === 'string') {
			expect(seenResourceIds.has(resourceId)).toBe(false)
			seenResourceIds.add(resourceId)
		}
		expect(typeof ctx.getAttr(resource, 'sourceResourceId')).toBe('string')
		expect(Number(ctx.getAttr(resource, 'duration'))).toBeGreaterThanOrEqual(0)
	}
}

export const readProjectGraph = async (ctx: DktTestContext) => {
	const activeProject = (await ctx.queryRel(ctx.sessionRoot, 'activeProject'))[0] ?? null
	if (!activeProject) {
		throw new Error('expected active project')
	}

	const tracks = await ctx.queryRel(activeProject, 'tracks')
	const resources = await ctx.queryRel(activeProject, 'resources')
	const clips = (await Promise.all(tracks.map((track) => ctx.queryRel(track, 'clips')))).flat()

	return {
		activeProject,
		tracks,
		resources,
		clips,
	}
}

export const findTrackByKind = async (ctx: DktTestContext, kind: 'video' | 'audio') => {
	const { tracks } = await readProjectGraph(ctx)
	const track = tracks.find((item) => ctx.getAttr(item, 'kind') === kind)
	if (!track) {
		throw new Error(`expected ${kind} track`)
	}
	return track
}

export const findClipBySourceClipId = async (ctx: DktTestContext, sourceClipId: string) => {
	const { clips } = await readProjectGraph(ctx)
	const clip = clips.find((item) => ctx.getAttr(item, 'sourceClipId') === sourceClipId)
	if (!clip) {
		throw new Error(`expected clip ${sourceClipId}`)
	}
	return clip
}

export const findResourceBySourceResourceId = async (ctx: DktTestContext, sourceResourceId: string) => {
	const { resources } = await readProjectGraph(ctx)
	const resource = resources.find((item) => ctx.getAttr(item, 'sourceResourceId') === sourceResourceId)
	if (!resource) {
		throw new Error(`expected resource ${sourceResourceId}`)
	}
	return resource
}

export const createDeterministicRandom = (seed: number) => {
	let state = seed >>> 0
	return () => {
		state = (state * 1664525 + 1013904223) >>> 0
		return state / 0x100000000
	}
}

export const pickOne = <T>(items: T[], random: () => number): T | null => {
	if (items.length === 0) {
		return null
	}
	return items[Math.floor(random() * items.length)] ?? null
}
