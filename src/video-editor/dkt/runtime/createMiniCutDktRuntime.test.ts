import { describe, expect, it } from 'vitest'
import { createMiniCutDktRuntime } from './createMiniCutDktRuntime'

const findModel = (state: Awaited<ReturnType<ReturnType<typeof createMiniCutDktRuntime>['debugDumpAppState']>>, modelName: string) => {
	const matches = [
		...(state?.runtimeModels ?? []),
		...(state?.lined ?? []),
	].filter((model) => model.modelName === modelName)
	return matches[0] ?? null
}

const waitForModelAttr = async (
	runtime: ReturnType<typeof createMiniCutDktRuntime>,
	modelName: string,
	attrName: string,
	expectedValue: unknown,
) => {
	for (let attempt = 0; attempt < 20; attempt++) {
		const state = await runtime.debugDumpAppState()
		const model = findModel(state, modelName)
		if (model?.attrs[attrName] === expectedValue) {
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
})
