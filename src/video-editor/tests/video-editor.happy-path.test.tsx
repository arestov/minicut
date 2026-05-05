import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { getActiveProject, getResourceEntities } from '../domain/selectors'
import type { ExportProgressEvent, ExportRenderRequest, ExportRenderResult } from '../render/exportRenderer'
import { renderVideoEditor } from './renderVideoEditor'

const createProjectFromMenu = async (user: ReturnType<typeof renderVideoEditor>['user']) => {
	const projectsRegion = screen.getByLabelText('Projects')
	await user.click(within(projectsRegion).getByRole('button'))
	await user.click(within(projectsRegion).getByRole('button', { name: 'New project' }))
	await waitFor(() => expect(within(projectsRegion).queryAllByRole('button', { name: /Project \d+/i }).length).toBeGreaterThan(0), { timeout: 5000 })
	if (!/Project \d+/i.test(projectsRegion.querySelector('.ve-project-dropdown__trigger')?.textContent ?? '')) {
		const projectButton = within(projectsRegion).queryByRole('button', { name: /Project \d+/i })
		if (projectButton) {
			await user.click(projectButton)
		}
	}
	await waitFor(() => expect(projectsRegion.querySelector('.ve-project-dropdown__trigger')).toHaveTextContent(/Project \d+/i), { timeout: 5000 })
	await waitFor(() => expect(screen.queryAllByText('Drop clips here.').length).toBeGreaterThan(0), { timeout: 5000 })
}

const setTimelineCursor = (timeline: HTMLElement, seconds: number): void => {
	const laneScroll = timeline.querySelector('.ve-track-lane-scroll') as HTMLDivElement | null
	expect(laneScroll).not.toBeNull()

	const zoomText = within(timeline).getByText(/px\/s$/i).textContent ?? '56'
	const zoom = Number.parseFloat(zoomText)
	fireEvent.pointerDown(laneScroll as HTMLDivElement, {
		buttons: 1,
		clientX: seconds * zoom,
	})
}

const importSampleResource = async (harness: ReturnType<typeof renderVideoEditor>['harness']): Promise<void> => {
	await act(async () => {
		harness.actions.importSampleResource()
		await Promise.resolve()
		await Promise.resolve()
	})
	const project = getActiveProject(harness.projects$.get(), harness.session$.get())
	const resourceCount = project ? getResourceEntities(harness.projects$.get(), project).length : 0
	await waitFor(() => expect(within(screen.getByLabelText('Media bin')).getByText(`${resourceCount} of ${resourceCount} assets`)).toBeInTheDocument())
	if (resourceCount > 0) {
		await waitFor(() => expect(within(screen.getByLabelText('Media bin')).getByText('Sample asset 1', { selector: 'strong' })).toBeInTheDocument())
	}
}

const createDeferred = <T,>() => {
	let resolve: ((value: T) => void) | null = null
	const promise = new Promise<T>((resolvePromise) => {
		resolve = resolvePromise
	})

	return {
		promise,
		resolve: (value: T) => {
			resolve?.(value)
		},
	}
}

const createMockExportResult = (): ExportRenderResult => ({
	id: 'export:mock',
	fileName: 'mock.webm',
	mimeType: 'video/webm',
	blob: new Blob(['mock'], { type: 'video/webm' }),
	size: 4,
	duration: 1,
	frameCount: 30,
	manifest: {
		format: 'video-webm',
		projectId: 'project:1',
		range: { type: 'project' },
		start: 0,
		duration: 1,
		fps: 30,
		frameCount: 30,
		clips: [],
		frames: [],
	},
})

describe('video editor harness', () => {
	it('runs the happy path: project -> import -> clip -> inspect -> split -> nudge', async () => {
		const { harness, user, unmount } = renderVideoEditor()

		try {
			await createProjectFromMenu(user)
			expect(screen.getByRole('button', { name: /Project \d+/i })).toBeInTheDocument()

			await importSampleResource(harness)
			const mediaBin = screen.getByLabelText('Media bin')
			expect(within(mediaBin).getByText('Sample asset 1', { selector: 'strong' })).toBeInTheDocument()

			const clipButton = await screen.findByRole('button', { name: /Sample asset 1/i })
			expect(clipButton).toBeInTheDocument()

			await user.click(clipButton)
			expect(screen.getByLabelText('Renderer stage')).toHaveTextContent('Sample asset 1')
			const inspector = screen.getByLabelText('Inspector')
			expect(within(inspector).getByText(/Clip 1 - V1 - 0\.0s - Duration 5\.0s/)).toBeInTheDocument()
			expect(within(inspector).queryByText(/clip-18/i)).not.toBeInTheDocument()
			const opacitySlider = within(inspector).getByRole('slider', { name: 'Opacity' })
			expect(opacitySlider).toBeInTheDocument()
			fireEvent.change(opacitySlider, { target: { value: '60' } })

			await waitFor(() => expect(within(inspector).getByText('Opacity 60%')).toBeInTheDocument())
			await user.click(within(inspector).getByRole('button', { name: 'Blur' }))
			await user.click(within(inspector).getByRole('button', { name: 'Sharpen' }))
			await waitFor(() => expect(within(inspector).getByText('2 effects')).toBeInTheDocument())
			await user.click(within(inspector).getByRole('button', { name: 'Manage effects' }))
			await user.click(within(inspector).getByRole('button', { name: 'Remove effect Blur' }))
			await waitFor(() => expect(within(inspector).getByText('1 effects')).toBeInTheDocument())
			await waitFor(() => expect(screen.getByLabelText('Renderer stage').querySelector('.ve-renderer__layer')).toHaveStyle({
				filter: 'contrast(1.25) saturate(1.125)',
			}))

			await user.click(within(inspector).getByRole('button', { name: 'Start +0.5s' }))
			await waitFor(() => expect(within(inspector).getByText(/Clip 1 - V1 - 0\.5s - Duration/)).toBeInTheDocument())

			const transformControls = within(inspector).getByLabelText('Transform controls')
			fireEvent.change(within(transformControls).getByLabelText('X'), { target: { value: '24' } })
			await waitFor(() => expect(within(transformControls).getByLabelText('X')).toHaveValue(24))

			const timeline = screen.getByLabelText('Timeline')
			setTimelineCursor(timeline, 2.75)
			const clipActions = within(timeline).getByLabelText('Clip edit actions')
			const selectedClipTarget = within(clipActions).getByLabelText('Selected clip action target')
			expect(selectedClipTarget).toHaveTextContent('Sample asset 1')
			expect(selectedClipTarget).toHaveTextContent('V1')

			await user.click(within(clipActions).getByRole('button', { name: 'Split clip' }))
			await waitFor(() => expect(screen.getAllByRole('button', { name: /Sample asset 1/i })).toHaveLength(2))

			await user.click(within(clipActions).getByRole('button', { name: 'Nudge -0.5s' }))
			await waitFor(() => expect(screen.getByRole('button', { name: /Sample asset 1 · 2\.3s \/ 2\.3s/i })).toBeInTheDocument())
			await user.click(within(clipActions).getByRole('button', { name: 'Nudge +0.5s' }))
			await waitFor(() => expect(screen.getByRole('button', { name: /Sample asset 1 · 2\.8s \/ 2\.3s/i })).toBeInTheDocument())
		} finally {
			unmount()
		}
	})

	it('splits clip at playhead and updates timeline clip widths from resulting durations', async () => {
		const { harness, user, unmount } = renderVideoEditor()

		try {
			await createProjectFromMenu(user)
			await importSampleResource(harness)

			const clipButton = await screen.findByRole('button', { name: /Sample asset 1/i })
			await user.click(clipButton)

			const timeline = screen.getByLabelText('Timeline')
			setTimelineCursor(timeline, 1.25)

			await user.click(within(timeline).getByRole('button', { name: 'Split clip' }))

			await waitFor(() => expect(screen.getAllByRole('button', { name: /Sample asset 1/i })).toHaveLength(2))
			const splitClips = screen.getAllByRole('button', { name: /Sample asset 1/i }) as HTMLButtonElement[]
			expect(splitClips).toHaveLength(2)
			const leftWidth = Number.parseFloat(splitClips[0].style.width)
			const rightWidth = Number.parseFloat(splitClips[1].style.width)
			expect(leftWidth).toBeCloseTo(70, 0)
			expect(rightWidth).toBeCloseTo(210, 0)
		}
		finally {
			unmount()
		}
	}, 10000)

	it('shows project export progress in toolbar while rendering', async () => {
		const exportDeferred = createDeferred<ExportRenderResult>()
		const exportRenderer = {
			render: vi.fn(async (_request: ExportRenderRequest, onProgress?: (event: ExportProgressEvent) => void) => {
				onProgress?.({ stage: 'queued', progress: 0 })
				onProgress?.({ stage: 'rendering', progress: 0.42 })
				return exportDeferred.promise
			}),
		}
		const { user, unmount } = renderVideoEditor({ exportRenderer })

		try {
			await createProjectFromMenu(user)

			await user.click(screen.getByRole('button', { name: 'Export project' }))
			expect(screen.getByText('Export rendering 42%')).toBeInTheDocument()

			exportDeferred.resolve(createMockExportResult())
			expect(await screen.findByText('Export ready')).toBeInTheDocument()
		} finally {
			unmount()
		}
	})

	it('resizes a clip from its timeline edges', async () => {
		const { harness, user, unmount } = renderVideoEditor()

		try {
			await createProjectFromMenu(user)
			await importSampleResource(harness)

			const clipButton = screen.getByRole('button', { name: /Sample asset 1/i })
			const endHandle = clipButton.querySelector('.ve-clip__resize-handle--end') as HTMLElement | null
			const startHandle = clipButton.querySelector('.ve-clip__resize-handle--start') as HTMLElement | null
			expect(endHandle).not.toBeNull()
			expect(startHandle).not.toBeNull()

			fireEvent.pointerDown(endHandle as HTMLElement, { clientX: 100, buttons: 1 })
			fireEvent.pointerMove(endHandle as HTMLElement, { clientX: 128, buttons: 1 })
			await waitFor(() => expect(clipButton).toHaveTextContent(/0\.0s \/ 5\.5s/))
			fireEvent.pointerUp(endHandle as HTMLElement, { clientX: 128, buttons: 0 })
			await waitFor(() => expect(clipButton).toHaveTextContent(/0\.0s \/ 5\.5s/))

			fireEvent.pointerDown(startHandle as HTMLElement, { clientX: 100, buttons: 1 })
			fireEvent.pointerMove(startHandle as HTMLElement, { clientX: 128, buttons: 1 })
			await waitFor(() => expect(clipButton).toHaveTextContent(/0\.5s \/ 5\.0s/))
			fireEvent.pointerUp(startHandle as HTMLElement, { clientX: 128, buttons: 0 })
			await waitFor(() => expect(clipButton).toHaveTextContent(/0\.5s \/ 5\.0s/))
		} finally {
			unmount()
		}
	})

	it('deletes selected clips through the timeline clip actions', async () => {
		const { harness, user, unmount } = renderVideoEditor()

		try {
			await createProjectFromMenu(user)
			await importSampleResource(harness)
			const clipButton = await screen.findByRole('button', { name: /Sample asset 1/i })
			await user.click(clipButton)

			await user.click(within(screen.getByLabelText('Timeline')).getByRole('button', { name: 'Delete clip' }))
			await waitFor(() => expect(screen.queryByRole('button', { name: /Sample asset 1 · 0.0s/i })).not.toBeInTheDocument())
			await waitFor(() => expect(screen.getByText('Select a clip to edit opacity or split it.')).toBeInTheDocument())
		} finally {
			unmount()
		}
	})

	it('applies clip color to timeline accent and renderer frame', async () => {
		const { harness, user, unmount } = renderVideoEditor()

		try {
			await createProjectFromMenu(user)
			await importSampleResource(harness)
			const clipButton = screen.getByRole('button', { name: /Sample asset 1/i })
			await user.click(clipButton)
			const preview = screen.getByLabelText('Preview panel')
			expect(within(preview).queryByLabelText('Color scopes')).toBeNull()

			const inspector = screen.getByLabelText('Inspector')
			await user.click(within(inspector).getByRole('tab', { name: 'Color' }))
			await user.click(within(inspector).getByRole('button', { name: 'Set color #16a34a' }))

			expect(clipButton).toHaveStyle({ borderLeftColor: 'rgb(22, 163, 74)' })
			expect(screen.getByLabelText('Renderer stage').querySelector('.ve-renderer__layer')).toHaveStyle({
				borderColor: 'rgb(22, 163, 74)',
			})
		}
		finally {
			unmount()
		}
	}, 10000)

	it('adds and edits primary color correction from the color inspector', async () => {
		const { harness, user, unmount } = renderVideoEditor()

		try {
			await createProjectFromMenu(user)
			await importSampleResource(harness)
			const clipButton = screen.getByRole('button', { name: /Sample asset 1/i })
			await user.click(clipButton)
			const preview = screen.getByLabelText('Preview panel')
			expect(within(preview).queryByLabelText('Color scopes')).toBeNull()

			const inspector = screen.getByLabelText('Inspector')
			await user.click(within(inspector).getByRole('tab', { name: 'Color' }))
			await user.click(within(inspector).getByRole('button', { name: 'Add primary correction' }))
			const exposure = await within(inspector).findByRole('slider', { name: 'Exposure' })
			fireEvent.change(exposure, { target: { value: '25' } })

			const clipId = String(harness.session$.selectedEntityId.get())
			const effectIds = harness.projects$.entitiesById[clipId].rels.effects.get()
			expect(Array.isArray(effectIds)).toBe(true)
			const effectId = Array.isArray(effectIds) ? String(effectIds[0]) : ''
			expect(harness.projects$.entitiesById[effectId].attrs.kind.get()).toBe('color-correction')
			const params = harness.projects$.entitiesById[effectId].attrs.params.get() as { exposure: { value: number } }
			expect(params.exposure.value).toBe(0.25)
			await waitFor(() => expect(screen.getByLabelText('Renderer stage').querySelector('.ve-renderer__layer')).toHaveStyle({
				filter: 'brightness(1.25) contrast(1) saturate(1) hue-rotate(0deg)',
			}))
			await waitFor(() => expect(within(clipButton).getByText('Grade')).toBeVisible())

			await user.click(within(inspector).getByRole('button', { name: 'Warm' }))
			const warmParams = harness.projects$.entitiesById[effectId].attrs.params.get() as {
				exposure: { value: number }
				contrast: { value: number }
				saturation: { value: number }
				temperature: { value: number }
			}
			expect(warmParams.exposure.value).toBeCloseTo(0.12, 6)
			expect(warmParams.temperature.value).toBeCloseTo(0.22, 6)

			await user.click(within(inspector).getByRole('button', { name: 'Apply look Cinema' }))
			const lookIntensity = within(inspector).getByRole('slider', { name: 'Look intensity' })
			fireEvent.change(lookIntensity, { target: { value: '50' } })
			const lookParams = harness.projects$.entitiesById[effectId].attrs.params.get() as {
				lookId: string
				lookIntensity: { value: number }
				exposure: { value: number }
				contrast: { value: number }
				saturation: { value: number }
				hue: { value: number }
			}
			expect(lookParams.lookId).toBe('cinema')
			expect(lookParams.lookIntensity.value).toBe(0.5)
			expect(lookParams.contrast.value).toBeCloseTo(1.09, 6)
			expect(lookParams.hue.value).toBeCloseTo(-2, 6)
			await waitFor(() => expect(screen.getByLabelText('Renderer stage').querySelector('.ve-renderer__layer')).toHaveStyle({
				filter: 'brightness(0.98) contrast(1.0791) saturate(0.97) hue-rotate(-2deg)',
			}))
			fireEvent.change(lookIntensity, { target: { value: '0' } })
			await user.click(within(inspector).getByRole('button', { name: 'Apply look Golden' }))
			fireEvent.change(lookIntensity, { target: { value: '100' } })
			const goldenParams = harness.projects$.entitiesById[effectId].attrs.params.get() as {
				lookId: string
				lookIntensity: { value: number }
				temperature: { value: number }
				hue: { value: number }
			}
			expect(goldenParams.lookId).toBe('golden')
			expect(goldenParams.lookIntensity.value).toBe(1)
			expect(goldenParams.temperature.value).toBeCloseTo(0.35, 6)
			expect(goldenParams.hue.value).toBe(5)
			fireEvent.change(lookIntensity, { target: { value: '0' } })
			await user.click(within(inspector).getByRole('button', { name: 'Apply look Mono' }))
			const monoParams = harness.projects$.entitiesById[effectId].attrs.params.get() as {
				lookId: string
				lookIntensity: { value: number }
				saturation: { value: number }
			}
			expect(monoParams.lookId).toBe('mono')
			expect(monoParams.lookIntensity.value).toBe(1)
			expect(monoParams.saturation.value).toBe(0)
			await waitFor(() => expect(screen.getByLabelText('Renderer stage').querySelector('.ve-renderer__layer')).toHaveStyle({
				filter: 'brightness(1) contrast(1.2444) saturate(0) hue-rotate(0deg)',
			}))
			await user.click(within(inspector).getByRole('button', { name: 'Apply look Cinema' }))
			fireEvent.change(lookIntensity, { target: { value: '50' } })
			fireEvent.change(exposure, { target: { value: '10' } })
			const customLookParams = harness.projects$.entitiesById[effectId].attrs.params.get() as { lookId: string }
			expect(customLookParams.lookId).toBe('custom')
			expect(await within(inspector).findByText('Custom grade')).toBeVisible()
			expect(within(inspector).getByRole('button', { name: 'Apply look Cinema' })).toHaveAttribute('aria-pressed', 'false')
			expect(lookIntensity).toBeDisabled()
			fireEvent.change(lookIntensity, { target: { value: '20' } })
			const stillCustomLookParams = harness.projects$.entitiesById[effectId].attrs.params.get() as {
				lookId: string
				exposure: { value: number }
			}
			expect(stillCustomLookParams.lookId).toBe('custom')
			expect(stillCustomLookParams.exposure.value).toBeCloseTo(0.1, 6)

			await user.click(within(inspector).getByRole('button', { name: 'Reset grade' }))
			const resetParams = harness.projects$.entitiesById[effectId].attrs.params.get() as {
				exposure: { value: number }
				contrast: { value: number }
				saturation: { value: number }
				temperature: { value: number }
			}
			expect(resetParams.exposure.value).toBe(0)
			expect(resetParams.contrast.value).toBe(1)
			expect(resetParams.saturation.value).toBe(1)
			expect(resetParams.temperature.value).toBe(0)

			await user.click(within(inspector).getByRole('button', { name: 'Bypass grade' }))
			expect(harness.projects$.entitiesById[effectId].attrs.enabled.get()).toBe(false)
			await waitFor(() => expect(within(clipButton).queryByText('Grade')).toBeNull())

			await user.click(within(inspector).getByRole('button', { name: 'Enable grade' }))
			expect(harness.projects$.entitiesById[effectId].attrs.enabled.get()).toBe(true)
			await waitFor(() => expect(within(clipButton).getByText('Grade')).toBeVisible())

			const compareButton = within(inspector).getByRole('button', { name: 'Press and hold: Before' })
			fireEvent.pointerDown(compareButton)
			expect(harness.projects$.entitiesById[effectId].attrs.enabled.get()).toBe(false)
			fireEvent.pointerUp(compareButton)
			expect(harness.projects$.entitiesById[effectId].attrs.enabled.get()).toBe(true)

			expect(within(preview).getByLabelText('Color scopes')).toBeVisible()
			expect(within(preview).getByRole('tab', { name: 'Waveform' })).toHaveAttribute('aria-selected', 'true')
			await user.click(within(preview).getByRole('tab', { name: 'RGB Parade' }))
			expect(within(preview).getByRole('tab', { name: 'RGB Parade' })).toHaveAttribute('aria-selected', 'true')
			await user.click(within(inspector).getByRole('tab', { name: 'Audio' }))
			expect(within(preview).queryByLabelText('Color scopes')).toBeNull()
			await user.click(within(inspector).getByRole('tab', { name: 'Color' }))
			await user.click(within(preview).getByRole('button', { name: 'Split compare' }))
			expect(within(preview).getByLabelText('Split compare preview')).toBeVisible()
			expect(within(preview).getByText('Before')).toBeVisible()
			expect(within(preview).getByText('After')).toBeVisible()
		} finally {
			unmount()
		}
	})

	it('adds a text clip and edits text content from the inspector', async () => {
		const { harness, user, unmount } = renderVideoEditor()

		try {
			await createProjectFromMenu(user)
			const mediaBin = screen.getByLabelText('Media bin')
			const textActionButton = within(mediaBin).getByRole('button', { name: 'Add Text to Timeline' })
			const firstResourceListRow = within(mediaBin).getAllByRole('listitem')[0]
			expect(within(firstResourceListRow).getByRole('button', { name: 'Add Text to Timeline' })).toBe(textActionButton)
			await user.click(textActionButton)
			const content = await screen.findByRole('textbox', { name: 'Text content' }, { timeout: 10000 })
			const inspector = screen.getByLabelText('Inspector')
			fireEvent.change(content, { target: { value: 'Edited title' } })

			const clipId = String(harness.session$.selectedEntityId.get())
			const textId = String(harness.projects$.entitiesById[clipId].rels.text.get())
			expect(harness.projects$.entitiesById[clipId].attrs.mediaKind.get()).toBe('text')
			await waitFor(() => expect(harness.projects$.entitiesById[textId].attrs.content.get()).toBe('Edited title'))
			await waitFor(() => expect(screen.getByLabelText('Renderer stage')).toHaveTextContent('Edited title'), { timeout: 5000 })

			const textSection = within(inspector).getByLabelText('Text controls')
			expect(within(textSection).getByLabelText('Advanced OKLCH controls')).toBeVisible()
			expect(within(textSection).getByRole('group', { name: 'Text color OKLCH controls' })).toBeVisible()
			expect(within(textSection).getByRole('group', { name: 'Text background OKLCH controls' })).toBeVisible()
			fireEvent.change(within(textSection).getByLabelText('Text color'), { target: { value: '#475569' } })
			fireEvent.change(within(textSection).getByLabelText('Text background color'), { target: { value: '#334155' } })
			expect(within(textSection).getByLabelText('Text color feedback')).toHaveTextContent(/Contrast/)
			await user.click(within(textSection).getByRole('button', { name: 'Fix contrast' }))
			fireEvent.change(within(textSection).getByRole('slider', { name: 'Text background hue' }), { target: { value: '220' } })

			const updatedText = harness.projects$.entitiesById[textId].attrs.get() as { style: { color: string; backgroundColor: string } }
			expect(updatedText.style.color).toMatch(/^#[0-9a-f]{6}$/)
			expect(updatedText.style.backgroundColor).toMatch(/^#[0-9a-f]{6}$/)
			await waitFor(() => expect(screen.getByLabelText('Renderer stage').querySelector('.ve-renderer__text-content')).toHaveStyle({
				color: updatedText.style.color,
			}))
			await waitFor(() => expect(screen.getByLabelText('Renderer stage').querySelector('.ve-renderer__text-box')).toHaveStyle({
				backgroundColor: updatedText.style.backgroundColor,
			}))
			await user.click(within(textSection).getByRole('button', { name: 'Generate palette from frame' }))
			expect(within(textSection).getByLabelText('Frame palette feedback')).toHaveTextContent('Fallback palette')
			const paletteText = harness.projects$.entitiesById[textId].attrs.get() as { style: { color: string; backgroundColor: string } }
			expect(paletteText.style.color).toMatch(/^#[0-9a-f]{6}$/)
			expect(paletteText.style.backgroundColor).toMatch(/^#[0-9a-f]{6}$/)

			const opacityHeading = within(inspector).getAllByText('Opacity').find((element) => element.tagName === 'H3')
			expect(opacityHeading).toBeDefined()
			const opacitySection = opacityHeading?.closest('section')
			expect(opacitySection).not.toBeNull()
			expect(textSection.compareDocumentPosition(opacitySection as Element) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
		} finally {
			unmount()
		}
	}, 15000)

	it('interpolates keyframed opacity and transform values in the renderer', async () => {
		const { harness, user, unmount } = renderVideoEditor()

		try {
			await createProjectFromMenu(user)
			await importSampleResource(harness)
			const clipId = String(harness.session$.selectedEntityId.get())
			expect(clipId).not.toBe('null')

			act(() => {
				harness.projects$.entitiesById['keyframe:opacity-start'].set({ id: 'keyframe:opacity-start', type: 'keyframe', attrs: { time: 0, value: 1 }, rels: {} })
				harness.projects$.entitiesById['keyframe:opacity-end'].set({ id: 'keyframe:opacity-end', type: 'keyframe', attrs: { time: 5, value: 0 }, rels: {} })
				harness.projects$.entitiesById['keyframe:x-start'].set({ id: 'keyframe:x-start', type: 'keyframe', attrs: { time: 0, value: 0 }, rels: {} })
				harness.projects$.entitiesById['keyframe:x-end'].set({ id: 'keyframe:x-end', type: 'keyframe', attrs: { time: 5, value: 100 }, rels: {} })
				harness.projects$.entitiesById[clipId].attrs.opacity.set({ value: 1, keyframes: ['keyframe:opacity-start', 'keyframe:opacity-end'] })
				;(harness.projects$.entitiesById[clipId].attrs.transform as unknown as Record<string, { set(v: unknown): void }>).x.set({ value: 0, keyframes: ['keyframe:x-start', 'keyframe:x-end'] })
			})
			await act(async () => {
				await Promise.resolve(harness.worker.replaceSnapshot?.(harness.projects$.get()))
				harness.actions.setCursor(2.5)
				await Promise.resolve()
				await Promise.resolve()
			})

			const layer = screen.getByLabelText('Renderer stage').querySelector('.ve-renderer__layer')
			await waitFor(() => expect(layer).toHaveStyle({ opacity: '0.5' }))
			await waitFor(() => expect(layer).toHaveStyle('transform: translate(50px, 0px) scale(1) rotate(0deg)'))
		} finally {
			unmount()
		}
	})

	it('edits clip fade in and fade out controls and previews faded opacity', async () => {
		const { harness, user, unmount } = renderVideoEditor()

		try {
			await createProjectFromMenu(user)
			await importSampleResource(harness)
			await user.click(await screen.findByRole('button', { name: /Sample asset 1/i }))

			const inspector = screen.getByLabelText('Inspector')
			expect(await within(inspector).findByRole('button', { name: 'Fade in -0.5s' }, { timeout: 5000 })).toBeDisabled()
			expect(await within(inspector).findByRole('button', { name: 'Fade out -0.5s' }, { timeout: 5000 })).toBeDisabled()
			await user.click(await within(inspector).findByRole('button', { name: 'Fade in +0.5s' }, { timeout: 5000 }))
			await user.click(await within(inspector).findByRole('button', { name: 'Fade out +0.5s' }, { timeout: 5000 }))
			expect(within(inspector).getAllByText('0.5s', { selector: 'dd' })).toHaveLength(2)

			act(() => harness.actions.setCursor(0))
			await waitFor(() => expect(screen.getByLabelText('Renderer stage').querySelector('.ve-renderer__layer')).toHaveStyle({ opacity: '0' }))
			act(() => harness.actions.setCursor(0.25))
			await waitFor(() => expect(screen.getByLabelText('Renderer stage').querySelector('.ve-renderer__layer')).toHaveStyle({ opacity: '0.5' }))
			act(() => harness.actions.setCursor(4.75))
			await waitFor(() => expect(screen.getByLabelText('Renderer stage').querySelector('.ve-renderer__layer')).toHaveStyle({ opacity: '0.5' }))
		} finally {
			unmount()
		}
	})

	it('applies every color preset button in inspector', async () => {
		const { harness, user, unmount } = renderVideoEditor()

		try {
			await createProjectFromMenu(user)
			await importSampleResource(harness)
			await user.click(await screen.findByRole('button', { name: /Sample asset 1/i }))

			const inspector = screen.getByLabelText('Inspector')
			await user.click(within(inspector).getByRole('tab', { name: 'Color' }))

			const presets: Array<{ hex: string, rgb: string }> = [
				{ hex: '#2563eb', rgb: 'rgb(37, 99, 235)' },
				{ hex: '#16a34a', rgb: 'rgb(22, 163, 74)' },
				{ hex: '#dc2626', rgb: 'rgb(220, 38, 38)' },
				{ hex: '#ca8a04', rgb: 'rgb(202, 138, 4)' },
				{ hex: '#7c3aed', rgb: 'rgb(124, 58, 237)' },
				{ hex: '#0891b2', rgb: 'rgb(8, 145, 178)' },
			]

			for (const preset of presets) {
				await user.click(await within(inspector).findByRole('button', { name: `Set color ${preset.hex}` }, { timeout: 5000 }))
				expect(within(inspector).getByLabelText('Color')).toHaveValue(preset.hex)
				expect(screen.getByRole('button', { name: /Sample asset 1/i })).toHaveStyle({
					borderLeftColor: preset.rgb,
				})
			}
		}
		finally {
			unmount()
		}
	}, 10000)

	it('edits clip name, direct color input, and every transform input', async () => {
		const { harness, user, unmount } = renderVideoEditor()

		try {
			await createProjectFromMenu(user)
			await importSampleResource(harness)
			const clipButton = await screen.findByRole('button', { name: /Sample asset 1/i })
			await user.click(clipButton)

			const inspector = screen.getByLabelText('Inspector')
			fireEvent.change(await within(inspector).findByLabelText('Clip name', undefined, { timeout: 5000 }), { target: { value: 'Renamed clip' } })
			expect(await screen.findByRole('button', { name: /Renamed clip/i })).toBeInTheDocument()

			const transformControls = within(inspector).getByLabelText('Transform controls')
			fireEvent.change(within(transformControls).getByLabelText('X'), { target: { value: '24' } })
			fireEvent.change(within(transformControls).getByLabelText('Y'), { target: { value: '-12' } })
			fireEvent.change(within(transformControls).getByLabelText('Scale'), { target: { value: '1.5' } })
			fireEvent.change(within(transformControls).getByLabelText('Rotate'), { target: { value: '15' } })
			await waitFor(() => expect(within(transformControls).getByLabelText('X')).toHaveValue(24))
			await waitFor(() => expect(within(transformControls).getByLabelText('Y')).toHaveValue(-12))
			await waitFor(() => expect(within(transformControls).getByLabelText('Scale')).toHaveValue(1.5))
			await waitFor(() => expect(within(transformControls).getByLabelText('Rotate')).toHaveValue(15))
			await waitFor(() => expect(screen.getByLabelText('Renderer stage').querySelector('.ve-renderer__layer')).toHaveStyle(
				'transform: translate(24px, -12px) scale(1.5) rotate(15deg)',
			))

			await user.click(within(inspector).getByRole('tab', { name: 'Color' }))
			fireEvent.change(within(inspector).getByLabelText('Color'), { target: { value: '#dc2626' } })
			await waitFor(() => expect(within(inspector).getByLabelText('Color')).toHaveValue('#dc2626'))
			await waitFor(() => expect(screen.getByRole('button', { name: /Renamed clip/i })).toHaveStyle({
				borderLeftColor: 'rgb(220, 38, 38)',
			}))
		} finally {
			unmount()
		}
	})

	it('keeps projects isolated when switching active project', async () => {
		const { harness, user, unmount } = renderVideoEditor()

		try {
			await createProjectFromMenu(user)
			const projectsRegion = screen.getByLabelText('Projects')
			const sourceProjectName = within(projectsRegion).getByRole('button').textContent?.trim() ?? 'Project 1'
			await importSampleResource(harness)

			await createProjectFromMenu(user)
			// Open project switcher to inspect all projects (trigger shows active "Project 2")
			await user.click(within(projectsRegion).getByRole('button', { name: /Project \d+/i }))
			const projectList = within(projectsRegion).getByRole('list')
			const projectButtons = within(projectList).getAllByRole('button', { name: /Project \d+/i })
			expect(projectButtons.length).toBeGreaterThanOrEqual(2)
			expect(screen.queryByRole('button', { name: /Sample asset 1/i })).not.toBeInTheDocument()

			await importSampleResource(harness)
			const mediaBin = screen.getByLabelText('Media bin')
			expect(within(mediaBin).getByText('Sample asset 1', { selector: 'strong' })).toBeInTheDocument()

			await user.click(within(projectList).getByRole('button', { name: new RegExp(sourceProjectName, 'i') }))
			expect(screen.getByRole('button', { name: /Sample asset 1 · 0.0s/i })).toBeInTheDocument()
		} finally {
			unmount()
		}
	})

	it('shows project items in dropdown after opening switcher', async () => {
		const { harness, user, unmount } = renderVideoEditor()

		try {
			await createProjectFromMenu(user)
			await createProjectFromMenu(user)

			const projectsRegion = screen.getByLabelText('Projects')
			await user.click(within(projectsRegion).getByRole('button', { name: /Project \d+/i }))

			const projectList = within(projectsRegion).getByRole('list')
			expect(within(projectList).getByRole('button', { name: /Project 1/i })).toBeVisible()
			expect(within(projectList).getByRole('button', { name: /Project 2/i })).toBeVisible()
		} finally {
			unmount()
		}
	})

	it('covers toolbar export, media controls, and timeline tool toggles', async () => {
		const { harness, user, unmount } = renderVideoEditor()

		try {
			await createProjectFromMenu(user)
			expect(screen.queryByRole('button', { name: 'Import sample' })).not.toBeInTheDocument()
			expect(screen.getByRole('button', { name: 'Export project' })).toBeEnabled()

			await importSampleResource(harness)
			await importSampleResource(harness)
			await importSampleResource(harness)
			expect(screen.queryByRole('button', { name: 'Undo' })).not.toBeInTheDocument()
			expect(screen.queryByRole('button', { name: 'Redo' })).not.toBeInTheDocument()
			await user.click(screen.getByRole('button', { name: 'Export project' }))
			expect(await screen.findByRole('status')).toHaveTextContent('Export ready')

			const mediaBin = screen.getByLabelText('Media bin')
			expect(within(mediaBin).getByText('3 of 3 assets')).toBeInTheDocument()
			await user.click(within(mediaBin).getByRole('button', { name: 'Grid view' }))
			expect(within(mediaBin).getByRole('button', { name: 'Grid view' })).toHaveAttribute('aria-pressed', 'true')
			await user.click(within(mediaBin).getByRole('button', { name: 'List view' }))
			expect(within(mediaBin).getByRole('button', { name: 'List view' })).toHaveAttribute('aria-pressed', 'true')

			fireEvent.change(within(mediaBin).getByLabelText('Filter media kind'), { target: { value: 'audio' } })
			expect(within(mediaBin).getByText('Sample asset 2', { selector: 'strong' })).toBeInTheDocument()
			expect(within(mediaBin).queryByText('Sample asset 1', { selector: 'strong' })).not.toBeInTheDocument()
			fireEvent.change(within(mediaBin).getByLabelText('Search media'), { target: { value: 'asset 2' } })
			expect(within(mediaBin).getByText('1 of 3 assets')).toBeInTheDocument()

			const timeline = screen.getByLabelText('Timeline')
			const clipActions = within(timeline).getByLabelText('Clip edit actions')
			expect(within(clipActions).getByRole('button', { name: 'Split clip' })).toBeEnabled()
			expect(within(clipActions).getByRole('button', { name: 'Nudge -0.5s' })).toBeEnabled()
			expect(within(clipActions).getByRole('button', { name: 'Nudge +0.5s' })).toBeEnabled()
			expect(within(clipActions).getByRole('button', { name: 'Delete clip' })).toBeEnabled()
			const scrollArea = timeline.querySelector('.ve-timeline-scroll-area') as HTMLDivElement | null
			expect(scrollArea).not.toBeNull()
			expect(within(timeline).getByRole('button', { name: 'Select tool' })).toHaveAttribute('aria-pressed', 'true')
			await user.click(within(timeline).getByRole('button', { name: 'Trim tool' }))
			expect(scrollArea).toHaveAttribute('data-tool', 'trim')
			expect(within(timeline).getByRole('button', { name: 'Trim tool' })).toHaveAttribute('aria-pressed', 'true')
			await user.click(within(timeline).getByRole('button', { name: 'Split tool' }))
			expect(scrollArea).toHaveAttribute('data-tool', 'split')
			await user.click(within(timeline).getByRole('button', { name: 'Hand tool' }))
			expect(scrollArea).toHaveAttribute('data-tool', 'hand')

			const snappingButton = within(timeline).getByRole('button', { name: 'Toggle snapping' })
			expect(snappingButton).toHaveAttribute('aria-pressed', 'true')
			await user.click(snappingButton)
			expect(snappingButton).toHaveAttribute('aria-pressed', 'false')
			expect(scrollArea).toHaveAttribute('data-snapping', 'off')

			const trackActions = within(timeline).getByLabelText('Track actions')
			await user.click(within(trackActions).getByRole('button', { name: 'Add video track' }))
			await user.click(within(trackActions).getByRole('button', { name: 'Add audio track' }))
			await waitFor(() => expect(within(timeline).getByText('4 tracks')).toBeInTheDocument())
			await waitFor(() => expect(within(timeline).getByText('V2')).toBeInTheDocument())
			await waitFor(() => expect(within(timeline).getByText('A2')).toBeInTheDocument())

			const v1Controls = within(timeline).getByLabelText('V1 controls')
			expect(within(v1Controls).getByRole('button', { name: 'Track audible' })).toBeDisabled()
			expect(within(v1Controls).getByRole('button', { name: 'Track unlocked' })).toBeDisabled()
			expect(within(v1Controls).getByRole('button', { name: 'Track visible' })).toBeDisabled()
		} finally {
			unmount()
		}
	})

	it('switches inspector tabs for clip editing modes', async () => {
		const { harness, user, unmount } = renderVideoEditor()

		try {
			await createProjectFromMenu(user)
			await importSampleResource(harness)
			await user.click(await screen.findByRole('button', { name: /Sample asset 1/i }))

			const inspector = screen.getByLabelText('Inspector')
			expect(await within(inspector).findByText('clip selected')).toBeVisible()
			await user.click(within(inspector).getByRole('tab', { name: 'Color' }))
			expect(await within(inspector).findByLabelText('Color inspector', undefined, { timeout: 5000 })).toBeVisible()
			expect(within(inspector).getByLabelText('Color presets')).toBeVisible()

			await user.click(within(inspector).getByRole('tab', { name: 'Audio' }))
			expect(within(inspector).getByLabelText('Audio inspector')).toHaveTextContent('Select an audio clip')

			await user.click(within(inspector).getByRole('tab', { name: 'Export' }))
			expect(within(inspector).getByLabelText('Export inspector')).toHaveTextContent('Queue clip export')
			expect(await within(inspector).findByText('clip selected')).toBeVisible()
			await user.click(within(inspector).getByRole('button', { name: 'Queue clip export' }))
			expect(await within(inspector).findByRole('status')).toHaveTextContent(/Export ready: \d+ frames/)

			await user.click(within(inspector).getByRole('tab', { name: 'Edit' }))
			expect(within(inspector).getByLabelText('Transform controls')).toBeVisible()
		} finally {
			unmount()
		}
	})

	it('controls cursor from the timeline and syncs preview state', async () => {
		const { harness, user, unmount } = renderVideoEditor()

		try {
			await createProjectFromMenu(user)
			await importSampleResource(harness)

			const timeline = screen.getByLabelText('Timeline')
			setTimelineCursor(timeline, 4.5)

			await waitFor(() => expect(within(timeline).getByLabelText('Current time')).toHaveTextContent('4.50s'))
			expect(within(timeline).getAllByLabelText('Current step')).toHaveLength(1)
			const previewPanel = screen.getByLabelText('Preview panel')
			expect(within(previewPanel).queryByRole('slider', { name: 'Cursor' })).toBeNull()
			const cursorReadout = await within(previewPanel).findByText('Cursor at 4.5s')
			expect(cursorReadout).toBeVisible()
			const previewTransport = cursorReadout.closest('.ve-preview-transport')
			expect(previewTransport).not.toBeNull()
			expect(within(previewTransport as HTMLElement).getByRole('button', { name: 'Play' })).toBeVisible()
		} finally {
			unmount()
		}
	})

	it('handles empty timeline and renders a large number of clips without UI breakage', async () => {
		const { harness, user, unmount } = renderVideoEditor()

		try {
			await createProjectFromMenu(user)
			expect(screen.getAllByText('Drop clips here.')).toHaveLength(2)
			expect(screen.queryByRole('button', { name: 'Add first resource' })).not.toBeInTheDocument()

			for (let index = 0; index < 100; index += 1) {
				await act(async () => {
					harness.actions.importSampleResource()
					await Promise.resolve()
					await Promise.resolve()
					if (index > 0) {
						const registry = harness.projects$.get()
						const project = getActiveProject(registry, harness.session$.get())
						expect(project).not.toBeNull()
						const resources = getResourceEntities(registry, project!)
						harness.actions.addResourceToTimeline(resources[resources.length - 1].id)
						await Promise.resolve()
						await Promise.resolve()
					}
				})
			}

			await waitFor(() => expect(screen.getAllByRole('button', { name: /Sample asset/i }).length).toBeGreaterThanOrEqual(100))
			expect(screen.getByLabelText('Timeline')).toBeVisible()
		} finally {
			unmount()
		}
	}, 30000)
})