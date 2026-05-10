import { describe, expect, it } from 'vitest'
import { createActionContractHarness, dispatchAndSettle } from './action-contract-test-harness'
import { expectProjectGraphInvariants } from '../test/projectGraphAssertions'

describe('Text action contracts', () => {
	it('setTextContent, setTextStyle, setTextBox, and setClip update the text node', async () => {
		const harness = await createActionContractHarness()

		await dispatchAndSettle(harness.ctx, harness.ctx.appModel, 'createTextModel', {
			content: 'Initial text',
			style: {
				fontFamily: 'Inter',
				fontSize: 24,
				color: '#ffffff',
			},
			box: {
				x: 0.2,
				y: 0.3,
				width: 0.4,
				height: 0.2,
			},
		})

		const text = (await harness.ctx.queryRel(harness.ctx.appModel, 'text')).find(
			(entry) => harness.ctx.getAttr(entry, 'content') === 'Initial text',
		)
		if (!text) {
			throw new Error('Expected integration text model')
		}

		await dispatchAndSettle(harness.ctx, text, 'setTextContent', 'Updated text')
		await dispatchAndSettle(harness.ctx, text, 'setTextStyle', {
			fontFamily: 'Inter Tight',
			fontSize: 32,
			color: '#f8fafc',
		})
		await dispatchAndSettle(harness.ctx, text, 'setTextBox', {
			x: 0.1,
			y: 0.15,
			width: 0.55,
			height: 0.25,
		})
		await dispatchAndSettle(harness.ctx, text, 'setClip', { clip: harness.videoClip })

		expect(harness.ctx.getAttr(text, 'content')).toBe('Updated text')
		expect(harness.ctx.getAttr(text, 'style')).toEqual({
			fontFamily: 'Inter Tight',
			fontSize: 32,
			color: '#f8fafc',
		})
		expect(harness.ctx.getAttr(text, 'box')).toEqual({
			x: 0.1,
			y: 0.15,
			width: 0.55,
			height: 0.25,
		})
		const textClipRel = await harness.ctx.queryRel(text, 'clip')
		expect(textClipRel).toHaveLength(1)
		expect(textClipRel[0]).toBe(harness.videoClip)
		await expectProjectGraphInvariants(harness.ctx)
	})
})

describe('Effect action contracts', () => {
	it('setEffectName, setEffectKind, setEffectEnabled, setEffectAmount, setEffectParams, setEffectColor, setEffectClip, and setEffectProject update the effect node', async () => {
		const harness = await createActionContractHarness()

		await dispatchAndSettle(harness.ctx, harness.ctx.appModel, 'createEffectModel', {
			name: 'Initial Effect',
			kind: 'blur',
			enabled: true,
			amount: 0.2,
			params: { softness: 0.5 },
			color: { lift: '#111111' },
		})

		const effect = (await harness.ctx.queryRel(harness.ctx.appModel, 'effect')).find(
			(entry) => harness.ctx.getAttr(entry, 'name') === 'Initial Effect',
		)
		if (!effect) {
			throw new Error('Expected integration effect model')
		}

		await dispatchAndSettle(harness.ctx, effect, 'setEffectName', 'Corrected Effect')
		await dispatchAndSettle(harness.ctx, effect, 'setEffectKind', 'tint')
		await dispatchAndSettle(harness.ctx, effect, 'setEffectEnabled', false)
		await dispatchAndSettle(harness.ctx, effect, 'setEffectAmount', 0.75)
		await dispatchAndSettle(harness.ctx, effect, 'setEffectParams', {
			params: { warmth: 0.3 },
		})
		await dispatchAndSettle(harness.ctx, effect, 'setEffectColor', {
			color: { lift: '#222222' },
		})
		await dispatchAndSettle(harness.ctx, effect, 'setEffectClip', { clip: harness.videoClip })
		await dispatchAndSettle(harness.ctx, effect, 'setEffectProject', { project: harness.project })

		expect(harness.ctx.getAttr(effect, 'name')).toBe('Corrected Effect')
		expect(harness.ctx.getAttr(effect, 'kind')).toBe('tint')
		expect(harness.ctx.getAttr(effect, 'enabled')).toBe(false)
		expect(harness.ctx.getAttr(effect, 'amount')).toBe(0.75)
		expect(harness.ctx.getAttr(effect, 'params')).toEqual({ warmth: 0.3 })
		expect(harness.ctx.getAttr(effect, 'color')).toEqual({ lift: '#222222' })
		const effectClipRel = await harness.ctx.queryRel(effect, 'clip')
		expect(effectClipRel).toHaveLength(1)
		expect(effectClipRel[0]).toBe(harness.videoClip)

		const effectProjectRel = await harness.ctx.queryRel(effect, 'project')
		expect(effectProjectRel).toHaveLength(1)
		expect(effectProjectRel[0]).toBe(harness.project)
		await expectProjectGraphInvariants(harness.ctx)
	})
})

describe('Resource action contracts', () => {
	it('renameResource, setResourceStatus, setResourceAttrs, requestAddToTimeline, setProject, and setClips update the resource node', async () => {
		const harness = await createActionContractHarness()

		await dispatchAndSettle(harness.ctx, harness.videoResource, 'renameResource', 'Renamed Resource')
		await dispatchAndSettle(harness.ctx, harness.videoResource, 'setResourceStatus', 'loading')
		await dispatchAndSettle(harness.ctx, harness.videoResource, 'setResourceAttrs', {
			name: 'Resource Attrs',
			kind: 'video',
			url: 'https://example.invalid/resource.webm',
			mime: 'video/webm',
			duration: 12,
			width: 1920,
			height: 1080,
			size: 2048,
			source: { kind: 'local' },
			status: 'ready',
			data: { status: 'ready' },
		})
		await dispatchAndSettle(harness.ctx, harness.videoResource, 'requestAddToTimeline', {
			resourceId: String(harness.videoResource._node_id),
		})
		await dispatchAndSettle(harness.ctx, harness.videoResource, 'setProject', { project: harness.project })
		await dispatchAndSettle(harness.ctx, harness.videoResource, 'setClips', {
			clips: [harness.videoClip],
		})

		expect(harness.ctx.getAttr(harness.videoResource, 'name')).toBe('Resource Attrs')
		expect(harness.ctx.getAttr(harness.videoResource, 'status')).toBe('ready')
		expect(harness.ctx.getAttr(harness.videoResource, 'duration')).toBe(12)
		expect(harness.ctx.getAttr(harness.videoResource, 'timelineAddRequest')).toMatchObject({
			resourceId: String(harness.videoResource._node_id),
		})
		const resourceProjectRel = await harness.ctx.queryRel(harness.videoResource, 'project')
		expect(resourceProjectRel).toHaveLength(1)
		expect(resourceProjectRel[0]).toBe(harness.project)

		const resourceClipsRel = await harness.ctx.queryRel(harness.videoResource, 'clips')
		expect(resourceClipsRel).toHaveLength(1)
		expect(resourceClipsRel[0]).toBe(harness.videoClip)
		await expectProjectGraphInvariants(harness.ctx)
	})
})
