import { describe, expect, it } from 'vitest'
import { createMiniCutDktRuntime } from './createMiniCutDktRuntime'

const findModel = (state: Awaited<ReturnType<ReturnType<typeof createMiniCutDktRuntime>['debugDumpAppState']>>, modelName: string) => {
	const matches = [
		...(state?.runtimeModels ?? []),
		...(state?.lined ?? []),
	].filter((model) => model.modelName === modelName)
	return matches[0] ?? null
}

const attrEquals = (value: unknown, expectedValue: unknown): boolean =>
	Object.is(value, expectedValue) || JSON.stringify(value) === JSON.stringify(expectedValue)

const waitForModelAttr = async (
	runtime: ReturnType<typeof createMiniCutDktRuntime>,
	modelName: string,
	attrName: string,
	expectedValue: unknown,
) => {
	for (let attempt = 0; attempt < 20; attempt++) {
		const state = await runtime.debugDumpAppState()
		const model = findModel(state, modelName)
		if (attrEquals(model?.attrs[attrName], expectedValue)) {
			return model
		}
		await new Promise((resolve) => setTimeout(resolve, 0))
	}
	const state = await runtime.debugDumpAppState()
	return findModel(state, modelName)
}

describe('createMiniCutDktRuntime', () => {
	it('does not boot while disabled', async () => {
		const runtime = createMiniCutDktRuntime()
		expect(await runtime.bootstrapApp()).toBeNull()
		expect(await runtime.debugDumpAppState()).toBeNull()
		await expect(runtime.dispatchAction('setActiveProjectHint', 'project:1')).rejects.toThrow('disabled')
	})

	it('boots MiniCut DKT app root and dispatches a pure root action', async () => {
		const runtime = createMiniCutDktRuntime({ enabled: true })
		const boot = await runtime.bootstrapApp()
		expect(boot?.appModel.model_name).toBe('minicut_app_root')

		await runtime.dispatchAction('setActiveProjectHint', 'project:dkt')
		const appRoot = await waitForModelAttr(runtime, 'minicut_app_root', 'activeProjectHint', 'project:dkt')

		expect(appRoot?.attrs.activeProjectHint).toBe('project:dkt')
		expect(appRoot?.attrs.hasProjects).toBe(false)
	})

	it('boots a DKT session root and dispatches session actions', async () => {
		const runtime = createMiniCutDktRuntime({ enabled: true })
		const sessionRoot = await runtime.bootstrapSessionRoot()
		expect(sessionRoot?.model_name).toBe('minicut_session_root')

		await runtime.dispatchSessionAction('setCursor', 4.129)
		await runtime.dispatchSessionAction('selectEntity', 'clip:session')
		const model = await waitForModelAttr(runtime, 'minicut_session_root', 'selectedEntityId', 'clip:session')

		expect(model?.attrs.cursor).toBe(4.13)
		expect(model?.attrs.selectedEntityId).toBe('clip:session')
	})

	it('creates a DKT clip proxy and dispatches scoped clip actions', async () => {
		const runtime = createMiniCutDktRuntime({ enabled: true })
		await runtime.dispatchClipAction({
			sourceClipId: 'clip:opacity',
			name: 'Opacity clip',
			color: '#ef4444',
			opacity: { value: 1 },
		}, 'updateOpacity', { opacityPercent: 37 })

		const model = await waitForModelAttr(runtime, 'minicut_clip', 'opacity', { value: 0.4 })
		expect(model?.attrs.sourceClipId).toBe('clip:opacity')
		expect(model?.attrs.opacity).toEqual({ value: 0.4 })
	})
})
