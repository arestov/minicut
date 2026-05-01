import { fireEvent, screen, within } from '@testing-library/react'
import { renderVideoEditor } from './renderVideoEditor'

describe('video editor harness', () => {
	it('runs the happy path: project -> import -> clip -> inspect -> split -> nudge', async () => {
		const { user, unmount } = renderVideoEditor()

		try {
			await user.click(screen.getByRole('button', { name: 'New project' }))
			expect(screen.getByRole('button', { name: /Project 1/i })).toBeInTheDocument()

			await user.click(screen.getByRole('button', { name: 'Import sample' }))
			const mediaBin = screen.getByLabelText('Media bin')
			expect(within(mediaBin).getByText('Sample asset 1', { selector: 'strong' })).toBeInTheDocument()

			await user.click(screen.getByRole('button', { name: 'Add to timeline' }))
			const clipButton = screen.getByRole('button', { name: /Sample asset 1/i })
			expect(clipButton).toBeInTheDocument()

			await user.click(clipButton)
			const inspector = screen.getByLabelText('Inspector')
			const opacitySlider = within(inspector).getByRole('slider', { name: 'Opacity' })
			expect(opacitySlider).toBeInTheDocument()
			fireEvent.change(opacitySlider, { target: { value: '60' } })

			expect(screen.getByText('60%', { selector: 'dd' })).toBeInTheDocument()
			await user.click(within(inspector).getByRole('button', { name: 'Start +0.5s' }))
			expect(screen.getByText('0.5s', { selector: 'dd' })).toBeInTheDocument()

			const transformControls = within(inspector).getByLabelText('Transform controls')
			fireEvent.change(within(transformControls).getByLabelText('X'), { target: { value: '24' } })
			expect(within(transformControls).getByLabelText('X')).toHaveValue(24)

			await user.click(within(inspector).getByRole('button', { name: 'Blur' }))
			expect(within(inspector).getByText('1 effects')).toBeInTheDocument()

			await user.click(within(inspector).getByRole('button', { name: 'Split clip' }))
			expect(screen.getAllByRole('button', { name: /Sample asset 1/i })).toHaveLength(2)

			await user.click(within(inspector).getByRole('button', { name: 'Nudge +0.5s' }))
			expect(screen.getByText('3.3s')).toBeInTheDocument()
		} finally {
			unmount()
		}
	})

	it('deletes selected clips through the inspector', async () => {
		const { user, unmount } = renderVideoEditor()

		try {
			await user.click(screen.getByRole('button', { name: 'New project' }))
			await user.click(screen.getByRole('button', { name: 'Import sample' }))
			await user.click(screen.getByRole('button', { name: 'Add to timeline' }))
			const clipButton = screen.getByRole('button', { name: /Sample asset 1/i })
			await user.click(clipButton)

			await user.click(within(screen.getByLabelText('Inspector')).getByRole('button', { name: 'Delete clip' }))
			expect(screen.queryByRole('button', { name: /Sample asset 1 · 0.0s/i })).not.toBeInTheDocument()
			expect(screen.getByText('Select a clip to edit opacity or split it.')).toBeInTheDocument()
		} finally {
			unmount()
		}
	})

	it('keeps projects isolated when switching active project', async () => {
		const { user, unmount } = renderVideoEditor()

		try {
			await user.click(screen.getByRole('button', { name: 'New project' }))
			await user.click(screen.getByRole('button', { name: 'Import sample' }))
			await user.click(screen.getByRole('button', { name: 'Add to timeline' }))

			await user.click(screen.getByRole('button', { name: 'New project' }))
			const projectsRegion = screen.getByLabelText('Projects')
			const projectButtons = within(projectsRegion).getAllByRole('button', {
				name: /Project [12]/i,
			})
			expect(projectButtons).toHaveLength(2)
			expect(screen.queryByRole('button', { name: /Sample asset 1/i })).not.toBeInTheDocument()

			await user.click(screen.getByRole('button', { name: 'Import sample' }))
			const mediaBin = screen.getByLabelText('Media bin')
			expect(within(mediaBin).getByText('Sample asset 1', { selector: 'strong' })).toBeInTheDocument()

			await user.click(screen.getByRole('button', { name: /Project 1/i }))
			expect(screen.getByRole('button', { name: /Sample asset 1 · 0.0s/i })).toBeInTheDocument()
		} finally {
			unmount()
		}
	})
})