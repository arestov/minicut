import type { AnimatedScalar, ClipAttrs, Entity, ProjectGraph, ProjectRegistry, ResourceAttrs, TransformAttrs } from './registryTypes'
import { getDebugFramePixelSignature, renderFrameDebug, type DrawCall } from './debugRenderer'

interface ClipSpec {
	id: string
	trackId: string
	resourceKind?: ResourceAttrs['kind']
	start: number
	duration: number
	inPoint?: number
	fadeIn?: number
	fadeOut?: number
	width?: number
	height?: number
	opacity?: AnimatedScalar
	transform?: Partial<Record<keyof TransformAttrs, AnimatedScalar>>
	effects?: string[]
}

interface DebugProjectSpec {
	tracks: Array<{ id: string; kind?: 'video' | 'audio'; clips: ClipSpec[] }>
	width?: number
	height?: number
}

const scalar = (value: number): AnimatedScalar => ({ value })

const transform = (partial: Partial<Record<keyof TransformAttrs, AnimatedScalar>> = {}): TransformAttrs => ({
	x: partial.x ?? scalar(0),
	y: partial.y ?? scalar(0),
	scale: partial.scale ?? scalar(1),
	rotation: partial.rotation ?? scalar(0),
})

const createKeyframedScalar = (
	clipId: string,
	name: string,
	keyframes: Array<{ time: number; value: number; interpolation?: 'linear' | 'hold' }>,
	entitiesById: ProjectRegistry['entitiesById'],
): AnimatedScalar => {
	const ids = keyframes.map((keyframe, index) => `keyframe:${clipId}:${name}:${index}`)
	for (const [index, id] of ids.entries()) {
		entitiesById[id] = { id, type: 'keyframe', attrs: keyframes[index], rels: {} }
	}

	return { value: keyframes[0]?.value ?? 1, keyframes: ids }
}

const createDebugProject = (spec: DebugProjectSpec): { registry: ProjectRegistry; projectId: string } => {
	const projectId = 'project:debug'
	const projectEntityId = 'entity:project'
	const timelineId = 'timeline:main'
	const entitiesById: ProjectRegistry['entitiesById'] = {}
	const project: ProjectGraph = { id: projectId, version: 1, rootEntityId: projectEntityId }

	entitiesById[projectEntityId] = {
		id: projectEntityId,
		type: 'project',
		attrs: {
			title: 'Debug project',
			fps: 30,
			width: spec.width ?? 1920,
			height: spec.height ?? 1080,
			duration: 20,
			createdAt: 0,
			updatedAt: 0,
		},
		rels: { resources: [], timelines: [timelineId], activeTimeline: timelineId },
	}
	entitiesById[timelineId] = {
		id: timelineId,
		type: 'timeline',
		attrs: { name: 'Main timeline', duration: 20 },
		rels: { tracks: spec.tracks.map((track) => track.id) },
	}

	const resourceIds: string[] = []
	for (const [trackIndex, track] of spec.tracks.entries()) {
		entitiesById[track.id] = {
			id: track.id,
			type: 'track',
			attrs: {
				kind: track.kind ?? 'video',
				name: `${track.kind === 'audio' ? 'A' : 'V'}${trackIndex + 1}`,
				muted: false,
				locked: false,
				height: track.kind === 'audio' ? 64 : 72,
			},
			rels: { clips: track.clips.map((clip) => clip.id) },
		}

		for (const clip of track.clips) {
			const resourceId = `resource:${clip.id}`
			resourceIds.push(resourceId)
			entitiesById[resourceId] = {
				id: resourceId,
				type: 'resource',
				attrs: {
					name: clip.id,
					kind: clip.resourceKind ?? 'video',
					url: `debug://${clip.id}`,
					mime: `${clip.resourceKind ?? 'video'}/debug`,
					duration: clip.duration + (clip.inPoint ?? 0),
					width: clip.width ?? 100,
					height: clip.height ?? 100,
					status: 'ready',
				},
				rels: {},
			}
			const effectIds = (clip.effects ?? []).map((effect, index) => `effect:${clip.id}:${index}`)
			for (const [index, effectId] of effectIds.entries()) {
				entitiesById[effectId] = {
					id: effectId,
					type: 'effect',
					attrs: { name: clip.effects?.[index] ?? 'Effect', kind: clip.effects?.[index] ?? effectId, amount: 0.5 },
					rels: { clip: clip.id },
				}
			}
			entitiesById[clip.id] = {
				id: clip.id,
				type: 'clip',
				attrs: {
					name: clip.id,
					start: clip.start,
					duration: clip.duration,
					in: clip.inPoint ?? 0,
					fadeIn: clip.fadeIn ?? 0,
					fadeOut: clip.fadeOut ?? 0,
					opacity: clip.opacity ?? scalar(1),
					transform: transform(clip.transform),
				} satisfies ClipAttrs,
				rels: { resource: resourceId, effects: effectIds },
			}
		}
	}
	entitiesById[projectEntityId].rels.resources = resourceIds

	return {
		projectId,
		registry: { activeProjectId: projectId, projects: { [projectId]: project }, entitiesById },
	}
}

const expectFiniteDrawCall = (call: DrawCall): void => {
	for (const value of [call.x, call.y, call.width, call.height, call.scale, call.rotation, call.opacity, call.sourceTime]) {
		expect(Number.isFinite(value)).toBe(true)
	}
	expect(call.opacity).toBeGreaterThanOrEqual(0)
	expect(call.opacity).toBeLessThanOrEqual(1)
	expect(call.width).toBeGreaterThanOrEqual(0)
	expect(call.height).toBeGreaterThanOrEqual(0)
}

const createPrng = (seed: number): (() => number) => {
	let state = seed >>> 0
	return () => {
		state = (state * 1664525 + 1013904223) >>> 0
		return state / 0x100000000
	}
}

const randomBetween = (random: () => number, min: number, max: number): number =>
	min + random() * (max - min)

const randomClip = (
	random: () => number,
	id: string,
	trackId: string,
	entitiesById: ProjectRegistry['entitiesById'],
): ClipSpec => {
	const start = randomBetween(random, 0, 10)
	const duration = randomBetween(random, 0.5, 5)
	const opacityStart = randomBetween(random, 0, 1)
	const opacityEnd = randomBetween(random, 0, 1)
	const effectPool = ['blur', 'tint', 'sharpen']
	const effects = effectPool.filter(() => random() > 0.62)

	return {
		id,
		trackId,
		resourceKind: random() > 0.75 ? 'image' : 'video',
		start,
		duration,
		inPoint: randomBetween(random, 0, 2),
		width: randomBetween(random, 80, 640),
		height: randomBetween(random, 80, 360),
		opacity: createKeyframedScalar(id, 'opacity', [
			{ time: 0, value: opacityStart },
			{ time: duration, value: opacityEnd },
		], entitiesById),
		transform: {
			x: scalar(randomBetween(random, -160, 160)),
			y: scalar(randomBetween(random, -90, 90)),
			scale: scalar(randomBetween(random, 0.25, 2.5)),
			rotation: scalar(randomBetween(random, -180, 180)),
		},
		effects,
	}
}

const createRandomProject = (clipCount: number, seed = 42): { registry: ProjectRegistry; projectId: string } => {
	const random = createPrng(seed)
	const entitiesById: ProjectRegistry['entitiesById'] = {}
	const tracks = Array.from({ length: 4 }, (_, trackIndex) => ({
		id: `track:${trackIndex}`,
		clips: [] as ClipSpec[],
	}))

	for (let index = 0; index < clipCount; index += 1) {
		const track = tracks[index % tracks.length]
		track.clips.push(randomClip(random, `clip:${index}`, track.id, entitiesById))
	}

	const project = createDebugProject({ tracks, width: 1280, height: 720 })
	project.registry.entitiesById = { ...project.registry.entitiesById, ...entitiesById }
	return project
}

describe('debug renderer draw calls', () => {
	it('is deterministic for the same project and for a structured clone', () => {
		const { registry, projectId } = createDebugProject({
			tracks: [{ id: 'track:1', clips: [{ id: 'clip:deterministic', trackId: 'track:1', start: 0, duration: 4, effects: ['blur'] }] }],
		})

		const calls = renderFrameDebug(registry, projectId, 1)
		expect(renderFrameDebug(registry, projectId, 1)).toEqual(calls)
		expect(renderFrameDebug(structuredClone(registry), projectId, 1)).toEqual(calls)
	})

	it('renders later tracks on top by preserving timeline track order', () => {
		const { registry, projectId } = createDebugProject({
			tracks: [
				{ id: 'track:bg', clips: [{ id: 'background', trackId: 'track:bg', start: 0, duration: 3 }] },
				{ id: 'track:fg', clips: [{ id: 'foreground', trackId: 'track:fg', start: 0, duration: 3 }] },
			],
		})

		expect(renderFrameDebug(registry, projectId, 1).map((call) => call.clipId)).toEqual(['background', 'foreground'])
	})

	it('includes clips only inside their time range', () => {
		const { registry, projectId } = createDebugProject({
			tracks: [{ id: 'track:1', clips: [{ id: 'clip:slice', trackId: 'track:1', start: 2, duration: 2 }] }],
		})

		expect(renderFrameDebug(registry, projectId, 1.99)).toHaveLength(0)
		expect(renderFrameDebug(registry, projectId, 2)).toHaveLength(1)
		expect(renderFrameDebug(registry, projectId, 3.99)).toHaveLength(1)
		expect(renderFrameDebug(registry, projectId, 4)).toHaveLength(0)
	})

	it('applies transform geometry against the debug viewport', () => {
		const { registry, projectId } = createDebugProject({
			tracks: [{
				id: 'track:1',
				clips: [{
					id: 'clip:geometry',
					trackId: 'track:1',
					start: 0,
					duration: 2,
					width: 100,
					height: 50,
					transform: { x: scalar(10), y: scalar(-5), scale: scalar(2), rotation: scalar(15) },
				}],
			}],
		})

		const [call] = renderFrameDebug(registry, projectId, 1, { width: 500, height: 300 })
		expect(call.x).toBeCloseTo(160, 6)
		expect(call.y).toBeCloseTo(95, 6)
		expect(call.width).toBeCloseTo(200, 6)
		expect(call.height).toBeCloseTo(100, 6)
		expect(call.scale).toBeCloseTo(2, 6)
		expect(call.rotation).toBeCloseTo(15, 6)
	})

	it('interpolates opacity over clip-local time', () => {
		const keyframeEntities: ProjectRegistry['entitiesById'] = {}
		const opacity = createKeyframedScalar('clip:fade', 'opacity', [
			{ time: 0, value: 0 },
			{ time: 2, value: 1 },
		], keyframeEntities)
		const { registry, projectId } = createDebugProject({
			tracks: [{ id: 'track:1', clips: [{ id: 'clip:fade', trackId: 'track:1', start: 1, duration: 3, opacity }] }],
		})
		registry.entitiesById = { ...registry.entitiesById, ...keyframeEntities }

		expect(renderFrameDebug(registry, projectId, 1)[0].opacity).toBe(0)
		expect(renderFrameDebug(registry, projectId, 2)[0].opacity).toBeGreaterThan(0)
		expect(renderFrameDebug(registry, projectId, 3)[0].opacity).toBe(1)
	})

	it('applies fade in and fade out to draw call opacity', () => {
		const { registry, projectId } = createDebugProject({
			tracks: [{
				id: 'track:1',
				clips: [{ id: 'clip:fades', trackId: 'track:1', start: 1, duration: 4, fadeIn: 1, fadeOut: 1, opacity: scalar(0.8) }],
			}],
		})

		expect(renderFrameDebug(registry, projectId, 1)[0].opacity).toBe(0)
		expect(renderFrameDebug(registry, projectId, 1.5)[0].opacity).toBeCloseTo(0.4, 6)
		expect(renderFrameDebug(registry, projectId, 3)[0].opacity).toBeCloseTo(0.8, 6)
		expect(renderFrameDebug(registry, projectId, 4.5)[0].opacity).toBeCloseTo(0.4, 6)
	})

	it('preserves effects pipeline order', () => {
		const { registry, projectId } = createDebugProject({
			tracks: [{ id: 'track:1', clips: [{ id: 'clip:effects', trackId: 'track:1', start: 0, duration: 2, effects: ['blur', 'tint', 'sharpen'] }] }],
		})

		expect(renderFrameDebug(registry, projectId, 1)[0].effects).toEqual(['blur', 'tint', 'sharpen'])
	})

	it('renders overlapping clips independently', () => {
		const { registry, projectId } = createDebugProject({
			tracks: [{
				id: 'track:1',
				clips: [
					{ id: 'clip:overlap-a', trackId: 'track:1', start: 0, duration: 4 },
					{ id: 'clip:overlap-b', trackId: 'track:1', start: 2, duration: 4 },
				],
			}],
		})

		expect(renderFrameDebug(registry, projectId, 2.5).map((call) => call.clipId)).toEqual(['clip:overlap-a', 'clip:overlap-b'])
	})

	it('keeps expected fixture clips within canvas bounds', () => {
		const { registry, projectId } = createDebugProject({
			tracks: [{
				id: 'track:1',
				clips: [{ id: 'clip:bounded', trackId: 'track:1', start: 0, duration: 2, width: 200, height: 120, transform: { scale: scalar(1), x: scalar(20), y: scalar(-20) } }],
			}],
		})
		const epsilon = 0.000001

		for (const call of renderFrameDebug(registry, projectId, 1, { width: 640, height: 360 })) {
			expect(call.x).toBeGreaterThanOrEqual(-epsilon)
			expect(call.y).toBeGreaterThanOrEqual(-epsilon)
			expect(call.x + call.width).toBeLessThanOrEqual(640 + epsilon)
			expect(call.y + call.height).toBeLessThanOrEqual(360 + epsilon)
		}
	})

	it('changes its pixel-lite signature when an effect is applied', () => {
		const base = createDebugProject({
			tracks: [{ id: 'track:1', clips: [{ id: 'clip:effectless', trackId: 'track:1', start: 0, duration: 2 }] }],
		})
		const withEffect = structuredClone(base)
		withEffect.registry.entitiesById['effect:clip:effectless:0'] = {
			id: 'effect:clip:effectless:0',
			type: 'effect',
			attrs: { name: 'Blur', kind: 'blur', amount: 0.5 },
			rels: { clip: 'clip:effectless' },
		}
		withEffect.registry.entitiesById['clip:effectless'].rels.effects = ['effect:clip:effectless:0']

		expect(getDebugFramePixelSignature(renderFrameDebug(base.registry, base.projectId, 1)))
			.not.toBe(getDebugFramePixelSignature(renderFrameDebug(withEffect.registry, withEffect.projectId, 1)))
	})

	it('random project time sweep never produces invalid draw calls', () => {
		const { registry, projectId } = createRandomProject(50, 20260501)

		for (let time = 0; time < 20; time += 0.25) {
			const calls = renderFrameDebug(registry, projectId, time, { width: 1280, height: 720 })
			expect(renderFrameDebug(structuredClone(registry), projectId, time, { width: 1280, height: 720 })).toEqual(calls)

			for (const call of calls) {
				expectFiniteDrawCall(call)
				expect(call.x).toBeLessThan(1280 + call.width)
				expect(call.y).toBeLessThan(720 + call.height)
			}
		}
	})
})
