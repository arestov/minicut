import { describe, expect, it } from 'vitest'
import { ROOT_ACTION_SCOPE, createEntityActionScope } from './actionScope'
import { createEditorActionRequest } from './actionRequests'

describe('editor action request contracts', () => {
	it('creates root action requests without losing payload shape', () => {
		const request = createEditorActionRequest(ROOT_ACTION_SCOPE, 'setActiveProject', { projectId: 'project:1' })

		expect(request).toEqual({
			scope: ROOT_ACTION_SCOPE,
			name: 'setActiveProject',
			payload: { projectId: 'project:1' },
		})
	})

	it('creates node-scoped action requests with _node_id-compatible scope', () => {
		const scope = createEntityActionScope('clip:1', 'clip')
		const request = createEditorActionRequest(scope, 'splitAt', { time: 1.5 })

		expect(request.scope.nodeId).toBe('clip:1')
		expect(request.scope.type).toBe('clip')
		expect(request.payload.time).toBe(1.5)
	})
})
