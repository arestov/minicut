import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi, beforeEach } from 'vitest'

const useVideoEditorMock = vi.fn()
const useRootAttrsMock = vi.fn()
const useRootDispatchMock = vi.fn()
const useActionsMock = vi.fn()
const useManyMock = vi.fn()
const useOneMock = vi.fn()
const useAttrsMock = vi.fn()

vi.mock('../../dkt-react-sync/hooks/useRootAttrs', () => ({
	useRootAttrs: (...args: unknown[]) => useRootAttrsMock(...args),
}))

vi.mock('../../dkt-react-sync/hooks/useRootDispatch', () => ({
	useRootDispatch: (...args: unknown[]) => useRootDispatchMock(...args),
}))

vi.mock('../../dkt-react-sync/hooks/useActions', () => ({
	useActions: (...args: unknown[]) => useActionsMock(...args),
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

beforeEach(() => {
	vi.clearAllMocks()
	useRootAttrsMock.mockReturnValue({})
	useRootDispatchMock.mockReturnValue(vi.fn())
	useActionsMock.mockReturnValue(vi.fn())
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
	it('dispatches createProject and requestProjectExport from toolbar buttons', () => {
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

		fireEvent.click(screen.getByRole('button', { name: 'New project' }))
		fireEvent.click(screen.getByRole('button', { name: 'Export project' }))

		expect(videoEditorActions.createProject).toHaveBeenCalledTimes(1)
		expect(videoEditorActions.requestProjectExport).toHaveBeenCalledTimes(1)
	})
})

describe('Timeline wiring', () => {
	it('dispatches split, nudge, delete, and addTrack actions from timeline controls', () => {
		const rootDispatch = vi.fn()
		const projectDispatch = vi.fn()
		useRootDispatchMock.mockReturnValue(rootDispatch)
		useActionsMock.mockReturnValue(projectDispatch)
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

		render(<TimelineView />)

		fireEvent.click(screen.getByRole('button', { name: 'Split clip' }))
		fireEvent.click(screen.getByRole('button', { name: 'Nudge -0.5s' }))
		fireEvent.click(screen.getByRole('button', { name: 'Delete clip' }))
		fireEvent.click(screen.getByRole('button', { name: 'Add video track' }))
		fireEvent.click(screen.getByRole('button', { name: 'Add audio track' }))

		expect(rootDispatch).toHaveBeenCalledWith('splitSelectedClip')
		expect(rootDispatch).toHaveBeenCalledWith('nudgeSelectedClip', { delta: -0.5 })
		expect(rootDispatch).toHaveBeenCalledWith('deleteSelectedClip')
		expect(projectDispatch).toHaveBeenCalledWith('addTrack', 'video')
		expect(projectDispatch).toHaveBeenCalledWith('addTrack', 'audio')
	})
})

describe('Inspector wiring', () => {
	it('dispatches text, clip, and effect actions from the edit tab', () => {
		const clipDispatch = vi.fn()
		useActionsMock.mockReturnValue(clipDispatch)
		useRootAttrsMock.mockReturnValue({})
		useManyMock.mockReturnValue([])
		useOneMock.mockReturnValue({ _nodeId: 'text:inspector' })

		useActionsMock.mockImplementation(() => clipDispatch)
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
		useActionsMock.mockReturnValue(clipDispatch)
		useAttrsMock.mockImplementation((keys: string[]) => {
			if (keys.includes('sourceTextId')) {
				return textAttrs
			}
			return clipAttrs
		})

		render(<InspectorEditTabPanel />)

		fireEvent.change(screen.getByLabelText('Text content'), { target: { value: 'Updated text' } })
		fireEvent.click(screen.getByRole('button', { name: 'Fade in +0.5s' }))
		fireEvent.click(screen.getByRole('button', { name: 'Blur' }))

		expect(clipDispatch).toHaveBeenCalledWith('setTextContent', { content: 'Updated text' })
		expect(clipDispatch).toHaveBeenCalledWith('setFade', { edge: 'in', delta: 0.5 })
		expect(clipDispatch).toHaveBeenCalledWith('addEffect', { kind: 'blur' })
	})
})
