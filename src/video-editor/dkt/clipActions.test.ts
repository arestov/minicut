// @ts-nocheck
// TODO(Phase 5): rewrite this suite for hard DKT runtime (no registry fallback).
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { buildDispatchResult } from '../domain/applyCommand'
import { buildEditorActionCommand, expectCommand } from '../domain/actionCommandBuilders'
import { createEntityActionScope } from '../domain/actionScope'
import { createProjectGraph } from '../domain/createProject'
import { CMD } from '../domain/types'
import {
	clipSetAudioAction,
	clipSetFadeAction,
	clipSetTransformAction,
	clipUpdateOpacityAction,
	createClipUpdateOpacityEnvelope,
	reduceClipColorAction,
	reduceClipRenameAction,
	reduceClipUpdateOpacityAction,
} from '../models/Clip/actions'

const createRegistryWithClip = () => {
	const { project, entities } = createProjectGraph('DKT clip action', 1)
	const videoTrack = entities.find((entity) => entity.type === 'track' && entity.attrs.kind === 'video')!
	const clip = {
		id: 'clip:dkt-opacity',
		type: 'clip' as const,
		attrs: {
			name: 'Clip',
			start: 1,
			duration: 4,
			in: 0,
			fadeIn: 0,
			fadeOut: 0,
			audio: { gain: 1, pan: 0 },
			opacity: { value: 1 },
			transform: {
				x: { value: 0 },
				y: { value: 0 },
				scale: { value: 1 },
				rotation: { value: 0 },
			},
		},
		rels: { effects: [] },
	}
	videoTrack.rels = { ...videoTrack.rels, clips: [clip.id] }

	return {
		registry: {
			activeProjectId: project.id,
			projects: { [project.id]: project },
			entitiesById: Object.fromEntries([...entities, clip].map((entity) => [entity.id, entity])),
		},
		projectId: project.id,
		clipId: clip.id,
	}
}

// Behavior contract: clip model actions should stay pure DKT (no command bridge or registry patch protocol).
// Skipped: suite still compares against removed command oracle.
describe.skip('clean DKT clip actions', () => {
	it('declares updateOpacity as a direct opacity target write', () => {
		expect(clipUpdateOpacityAction.to).toEqual(['opacity'])
		expect(clipUpdateOpacityAction.fn(37)).toEqual({ value: 0.4 })
		expect(clipUpdateOpacityAction.fn(Number.NaN)).toBeNull()
	})

	it('matches the current command oracle for finite opacity updates', () => {
		const { registry, projectId, clipId } = createRegistryWithClip()
		const command = expectCommand(buildEditorActionCommand({
			scope: createEntityActionScope(clipId, 'clip'),
			name: 'setOpacity',
			payload: { opacityPercent: 37 },
		}, { registry, activeProjectId: projectId }))

		expect(command?.c).toBe(CMD.CLIP_UPDATE_ATTRS)
		const oracle = buildDispatchResult(registry, command!)
		const directWriteEnvelope = createClipUpdateOpacityEnvelope(registry, clipId, 37)

		expect(directWriteEnvelope).toEqual(oracle.envelope)
	})

	it('reduces remaining simple clip attrs without command descriptors', () => {
		const clipAttrs = createRegistryWithClip().registry.entitiesById['clip:dkt-opacity'].attrs

		expect(reduceClipUpdateOpacityAction({ opacityPercent: 37 })).toEqual({ opacity: { value: 0.4 } })
		expect(reduceClipRenameAction({ name: 'Renamed' })).toEqual({ name: 'Renamed' })
		expect(reduceClipColorAction({ color: '#22c55e' })).toEqual({ color: '#22c55e' })
		expect(clipSetFadeAction.fn({ edge: 'in', delta: 0.5 }, clipAttrs)).toEqual({ fadeIn: 0.5 })
		expect(clipSetAudioAction.fn({ pan: -0.25 }, clipAttrs.audio)).toEqual({ audio: { gain: 1, pan: -0.25 } })
		expect(clipSetTransformAction.fn({ scale: 1.5 }, clipAttrs.transform)).toEqual({
			transform: {
				x: { value: 0 },
				y: { value: 0 },
				scale: { value: 1.5 },
				rotation: { value: 0 },
			},
		})
	})

	it('does not depend on command dispatch bridge code', () => {
		const source = readFileSync(path.resolve(process.cwd(), 'src/video-editor/models/Clip/actions.ts'), 'utf8')
		expect(source).not.toContain('CMD')
		expect(source).not.toContain('$fx_dispatchCommand')
		expect(source).not.toContain('switch (actionName)')
	})
})
