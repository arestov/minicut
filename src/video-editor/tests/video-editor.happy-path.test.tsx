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

			await user.click(within(inspector).getByRole('button', { name: 'Split clip' }))
			expect(screen.getAllByRole('button', { name: /Sample asset 1/i })).toHaveLength(2)

			await user.click(within(inspector).getByRole('button', { name: 'Nudge +0.5s' }))
			expect(screen.getByText('3.0s')).toBeInTheDocument()
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