import { describe, expect, it } from 'vitest'
import { createMiniCutDktRuntime, type MiniCutDktDebugState } from './createMiniCutDktRuntime'

type SerializedModel = NonNullable<MiniCutDktDebugState>['runtimeModels'][number]

const projectId = 'project:split-debug'
const videoTrackId = `${projectId}:track:video`
const clipId = 'clip:split-left'

const getRuntimeModels = (snapshot: MiniCutDktDebugState): SerializedModel[] => {
	if (!snapshot) {
		throw new Error('DKT debug snapshot is empty')
	}
	return snapshot.runtimeModels
}

const readClipStates = (snapshot: MiniCutDktDebugState): Array<{ nodeId: string | null; sourceClipId: string | null; trackNodeId: string | null; start: number; duration: number; inPoint: number }> => {
	const models = getRuntimeModels(snapshot)
	return models
		.filter((entry): entry is SerializedModel => entry.modelName === 'minicut_clip')
		.map((clip) => ({
			nodeId: clip.nodeId,
			sourceClipId: typeof clip.attrs?.sourceClipId === 'string' ? clip.attrs.sourceClipId : null,
			trackNodeId: typeof clip.rels?.track === 'string' ? clip.rels.track : null,
			start: Number(clip.attrs?.start ?? 0),
			duration: Number(clip.attrs?.duration ?? 0),
			inPoint: Number(clip.attrs?.in ?? 0),
		}))
}

const waitFor = async (predicate: () => Promise<boolean>, timeoutMs = 2000): Promise<void> => {
	const startedAt = Date.now()
	while (Date.now() - startedAt < timeoutMs) {
		if (await predicate()) {
			return
		}
		await new Promise((resolve) => setTimeout(resolve, 20))
	}
}

describe('createMiniCutDktRuntime splitSelfAt data flow', () => {
	it('keeps left split on clip action and creates right split via track action', async () => {
		const runtime = createMiniCutDktRuntime({ enabled: true })
		const dispatchAction = async (kind: 'session' | 'track' | 'clip', actionName: string, payload?: unknown) => {
			if (kind === 'session') {
				await runtime.dispatchSessionAction(actionName, payload)
				return
			}
			if (kind === 'track') {
				await runtime.dispatchTrackAction({ sourceTrackId: videoTrackId }, actionName, payload)
				return
			}
			await runtime.dispatchClipAction({ sourceClipId: clipId }, actionName, payload)
		}

		await dispatchAction('session', 'createProject', { sourceProjectId: projectId, title: 'Split relation test project' })
		await dispatchAction('track', 'addClip', {
			sourceClipId: clipId,
			name: 'fixture-video.webm',
			mediaKind: 'video',
			start: 0,
			in: 0,
			duration: 1,
		})

		await dispatchAction('session', 'selectEntity', clipId)
		await dispatchAction('session', 'setCursor', 0.5)

		await dispatchAction('session', 'splitSelectedClip')
		await waitFor(async () => {
			const snapshot = await runtime.debugDumpAppState()
			const left = readClipStates(snapshot).find((clip) => clip.sourceClipId === clipId)
			return Boolean(left && left.duration === 0.5)
		})
		const afterSessionSplit = await runtime.debugDumpAppState()
		const clipStates = readClipStates(afterSessionSplit)

		const leftClipAfterSessionSplit = clipStates.find((clip) => clip.sourceClipId === clipId)
		expect(leftClipAfterSessionSplit).toBeTruthy()
		expect(leftClipAfterSessionSplit?.duration).toBe(0.5)
		expect(leftClipAfterSessionSplit?.start).toBe(0)

		await dispatchAction('track', 'splitClipAt', {
			sourceClipId: 'clip:split-right:manual',
			name: 'fixture-video.webm',
			mediaKind: 'video',
			splitTime: 0.5,
			sourceClip: { start: 0, in: 0, duration: 1 },
		})

		await waitFor(async () => {
			const snapshot = await runtime.debugDumpAppState()
			return readClipStates(snapshot).some((clip) => clip.sourceClipId === 'clip:split-right:manual')
		})
		const afterTrackSplit = await runtime.debugDumpAppState()
		const rightClip = readClipStates(afterTrackSplit).find((clip) => clip.sourceClipId === 'clip:split-right:manual')
		expect(rightClip).toBeTruthy()
		expect(rightClip?.start).toBe(0.5)
		expect(rightClip?.duration).toBe(0.5)
	})
})
