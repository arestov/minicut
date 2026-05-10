import { expect } from 'vitest'
import type { DktTestContext } from '../testingInit'

export type ProjectGraphNode = {
	nodeId: string
	modelName: string | null
	attrs: Record<string, unknown>
	rels: Record<string, unknown>
}

export const expectClipTiming = (
	ctx: DktTestContext,
	clip: { _node_id?: string | null } | null | undefined,
	expected: Partial<{
		start: number
		in: number
		duration: number
		clipId: string
		resourceId: string
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
	if (expected.clipId !== undefined) {
		expect(clip?._node_id).toBe(expected.clipId)
	}
	if (expected.resourceId !== undefined) {
		const resourceRel = ctx.getAttr(clip, 'clipRenderData') as { resourceId?: unknown } | null
		expect(resourceRel?.resourceId).toBe(expected.resourceId)
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
			expect(trackRelModels).toHaveLength(1)
			expect(trackRelModels[0]?._node_id).toBe(track._node_id)
		}
	}

	for (const clip of flatClips) {
		expectClipTiming(ctx, clip, {})
		const clipId = clip._node_id
		if (typeof clipId === 'string') {
			expect(seenClipIds.has(clipId)).toBe(false)
			seenClipIds.add(clipId)
		}

		const clipRenderData = ctx.getAttr(clip, 'clipRenderData') as {
			id?: unknown
			resourceId?: unknown
		} | null
		expect(clipRenderData?.id).toBe(clip._node_id)

		const mediaKind = ctx.getAttr(clip, 'mediaKind')
		const resourceRel = await ctx.queryRel(clip, 'resource')
		const textRel = await ctx.queryRel(clip, 'text')

		if (mediaKind === 'text') {
			expect(textRel).toHaveLength(1)
			const textNode = textRel[0]
			const textClipRel = await ctx.queryRel(textNode, 'clip')
			expect(textClipRel).toHaveLength(1)
			expect(textClipRel[0]?._node_id).toBe(clip._node_id)
			expect(resourceRel).toHaveLength(0)
			expect(clipRenderData?.resourceId ?? null).toBeNull()
		}

		if (mediaKind !== 'text' && resourceRel.length > 0) {
			expect(resourceRel).toHaveLength(1)
			const resourceModel = resourceRel[0]
			expect(resources.some((resource) => resource._node_id === resourceModel._node_id)).toBe(true)
			expect(clipRenderData?.resourceId).toBe(resourceModel._node_id)
		}

		if (typeof clipRenderData?.resourceId === 'string') {
			expect(resources.some((resource) => resource._node_id === clipRenderData.resourceId)).toBe(true)
		}

		const effects = await ctx.queryRel(clip, 'effects')
		for (const effect of effects) {
			const effectClipRel = await ctx.queryRel(effect, 'clip')
			expect(effectClipRel).toHaveLength(1)
			expect(effectClipRel[0]?._node_id).toBe(clip._node_id)
			const effectProjectRel = await ctx.queryRel(effect, 'project')
			if (effectProjectRel.length > 0) {
				expect(effectProjectRel[0]?._node_id).toBe(activeProject!._node_id)
			}
		}
	}

	for (const resource of resources) {
		const resourceId = resource._node_id
		if (typeof resourceId === 'string') {
			expect(seenResourceIds.has(resourceId)).toBe(false)
			seenResourceIds.add(resourceId)
		}
		expect(typeof resource._node_id).toBe('string')
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

export const findClipById = async (ctx: DktTestContext, clipId: string) => {
	const { clips } = await readProjectGraph(ctx)
	const clip = clips.find((item) => item._node_id === clipId)
	if (!clip) {
		throw new Error(`expected clip ${clipId}`)
	}
	return clip
}

export const findResourceById = async (ctx: DktTestContext, resourceId: string) => {
	const { resources } = await readProjectGraph(ctx)
	const resource = resources.find((item) => item._node_id === resourceId)
	if (!resource) {
		throw new Error(`expected resource ${resourceId}`)
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
