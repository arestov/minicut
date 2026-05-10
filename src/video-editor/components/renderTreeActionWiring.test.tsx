import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import type { ReactNode } from 'react'
import { ReactScopeRuntimeContext } from '../../dkt-react-sync/context/ReactScopeRuntimeContext'
import { ScopeContext } from '../../dkt-react-sync/context/ScopeContext'

const useVideoEditorMock = vi.fn()
const useRootAttrsMock = vi.fn()
const useRootDispatchMock = vi.fn()
const useManyMock = vi.fn()
const useOneMock = vi.fn()
const useAttrsMock = vi.fn()

vi.mock('../../dkt-react-sync/hooks/useRootAttrs', () => ({
	useRootAttrs: (...args: unknown[]) => useRootAttrsMock(...args),
}))

vi.mock('../../dkt-react-sync/hooks/useRootDispatch', () => ({
	useRootDispatch: (...args: unknown[]) => useRootDispatchMock(...args),
}))

vi.mock('../../dkt-react-sync/hooks/useMany', () => ({
	useMany: (...args: unknown[]) => useManyMock(...args),
}))

vi.mock('../../dkt-react-sync/hooks/useOne', () => ({
	useOne: (...args: unknown[]) => useOneMock(...args),
}))

vi.mock('../../dkt-react-sync/hooks/useAttrs', () => ({
	useAttrs: (...args: unknown[]) => useAttrsMock(...args),
}))

vi.mock('../app/VideoEditorContext', () => ({
	useVideoEditor: (...args: unknown[]) => useVideoEditorMock(...args),
}))

vi.mock('./ProjectDropdown', () => ({
	ProjectDropdown: () => null,
}))

import { Toolbar } from './Toolbar'
import { TimelineView } from './TimelineView'
import { InspectorEditTabPanel } from './inspector/InspectorEditTabPanel'

type TestScope = { _nodeId: string }

type RecordedDispatch = {
	scopeId: string | null
	action: string
	payload?: unknown
}

const createDispatchRecordingRuntime = () => {
	const dispatches: RecordedDispatch[] = []
	const runtime = {
		getDispatch(scope: TestScope | null) {
			return (action: string, payload?: unknown) => {
				dispatches.push({ scopeId: scope?._nodeId ?? null, action, payload })
			}
		},
	}

	return { dispatches, runtime }
}

const renderWithScope = (ui: ReactNode, scope: TestScope) => {
	const { dispatches, runtime } = createDispatchRecordingRuntime()

	const result = render(
		<ReactScopeRuntimeContext.Provider value={runtime as any}>
			<ScopeContext.Provider value={scope as any}>{ui}</ScopeContext.Provider>
		</ReactScopeRuntimeContext.Provider>,
	)

	return { ...result, dispatches }
}

beforeEach(() => {
	vi.clearAllMocks()
	useRootAttrsMock.mockReturnValue({})
	useRootDispatchMock.mockReturnValue(vi.fn())
	useManyMock.mockReturnValue([])
	useOneMock.mockReturnValue(null)
	useAttrsMock.mockReturnValue({})
	useVideoEditorMock.mockReturnValue({
		actions: {
			createProject: vi.fn(),
			requestProjectExport: vi.fn(),
			getCachedExportUrl: vi.fn(() => null),
			addTextClip: vi.fn(),
			requestImportFiles: vi.fn(),
			requestSelectedClipExport: vi.fn(),
			setCursor: vi.fn(),
		},
	})
})

describe('Toolbar wiring', () => {
	it('dispatches createProject and requestProjectExport from toolbar buttons', async () => {
		const user = userEvent.setup()
		const videoEditorActions = {
			createProject: vi.fn(),
			requestProjectExport: vi.fn(),
			getCachedExportUrl: vi.fn(() => null),
			addTextClip: vi.fn(),
			requestImportFiles: vi.fn(),
			requestSelectedClipExport: vi.fn(),
			setCursor: vi.fn(),
		}
		useVideoEditorMock.mockReturnValue({ actions: videoEditorActions })
		useRootAttrsMock.mockReturnValue({ activeProjectId: 'project:toolbar', exportProgress: null })

		render(<Toolbar />)

		await user.click(screen.getByRole('button', { name: 'New project' }))
		await user.click(screen.getByRole('button', { name: 'Export project' }))

		expect(videoEditorActions.createProject).toHaveBeenCalledTimes(1)
		expect(videoEditorActions.requestProjectExport).toHaveBeenCalledTimes(1)
	})
})

describe('Timeline wiring', () => {
	it('dispatches split, nudge, delete, and addTrack actions from timeline controls', async () => {
		const user = userEvent.setup()
		const rootDispatch = vi.fn()
		useRootDispatchMock.mockReturnValue(rootDispatch)
		useRootAttrsMock.mockReturnValue({
			activeProjectId: 'project:timeline',
			timelineZoom: 16,
			selectedEntityId: 'clip:timeline',
			cursor: 4,
			selectedClipSummary: {
				color: '#2563eb',
				resourceName: 'Timeline Clip',
				trackName: 'V1',
			},
		})
		useManyMock.mockReturnValue([])

		const { dispatches } = renderWithScope(<TimelineView />, { _nodeId: 'project:timeline' })

		await user.click(screen.getByRole('button', { name: 'Split clip' }))
		await user.click(screen.getByRole('button', { name: 'Nudge -0.5s' }))
		await user.click(screen.getByRole('button', { name: 'Delete clip' }))
		await user.click(screen.getByRole('button', { name: 'Add video track' }))
		await user.click(screen.getByRole('button', { name: 'Add audio track' }))

		expect(rootDispatch).toHaveBeenCalledWith('splitSelectedClip')
		expect(rootDispatch).toHaveBeenCalledWith('nudgeSelectedClip', { delta: -0.5 })
		expect(rootDispatch).toHaveBeenCalledWith('deleteSelectedClip')
		expect(dispatches).toContainEqual({ scopeId: 'project:timeline', action: 'addTrack', payload: 'video' })
		expect(dispatches).toContainEqual({ scopeId: 'project:timeline', action: 'addTrack', payload: 'audio' })
	})
})

describe('Inspector wiring', () => {
	it('dispatches text actions from text scope and effect actions from clip scope', async () => {
		const user = userEvent.setup()
		useRootAttrsMock.mockReturnValue({})
		useManyMock.mockReturnValue([])
		useOneMock.mockReturnValue({ _nodeId: 'text:inspector' })

		const clipAttrs = {
			sourceClipId: 'clip:inspector',
			opacity: { value: 1 },
			in: 0,
			fadeIn: 0,
			fadeOut: 0,
			duration: 4,
			start: 0,
			transform: {
				x: { value: 0 },
				y: { value: 0 },
				scale: { value: 1 },
				rotation: { value: 0 },
			},
			color: '#2563eb',
		}
		const textAttrs = {
			sourceTextId: 'text:inspector',
			content: 'Initial text',
			style: {
				fontFamily: 'Inter',
				fontSize: 24,
				fontWeight: 400,
				color: '#ffffff',
				backgroundColor: '#00000000',
				align: 'left',
			},
			box: {
				x: 0.1,
				y: 0.2,
				width: 0.4,
				height: 0.2,
			},
		}

		useManyMock.mockReturnValue([])
		useRootAttrsMock.mockImplementation((keys: string[]) => {
			if (keys.includes('sourceClipId')) {
				return clipAttrs
			}
			return {}
		})
		useAttrsMock.mockImplementation((keys: string[]) => {
			if (keys.includes('sourceTextId')) {
				return textAttrs
			}
			return clipAttrs
		})

		const { dispatches } = renderWithScope(<InspectorEditTabPanel />, { _nodeId: 'clip:inspector' })

		const textInput = screen.getByLabelText('Text content')
		await user.click(textInput)
		await user.keyboard('{Control>}a{/Control}')
		await user.paste('Updated text')
		await user.click(screen.getByRole('button', { name: 'Fade in +0.5s' }))
		await user.click(screen.getByRole('button', { name: 'Blur' }))

		expect(dispatches).toContainEqual({
			scopeId: 'text:inspector',
			action: 'setTextContent',
			payload: { content: 'Updated text' },
		})
		expect(dispatches).toContainEqual({
			scopeId: 'clip:inspector',
			action: 'setFade',
			payload: { edge: 'in', delta: 0.5 },
		})
		expect(dispatches).toContainEqual({
			scopeId: 'clip:inspector',
			action: 'addEffect',
			payload: { kind: 'blur' },
		})
	})
})
