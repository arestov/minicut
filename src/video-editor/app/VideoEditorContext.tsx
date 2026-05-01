import { createContext, useContext } from 'react'
import type { VideoEditorHarness } from './createVideoEditorHarness'

const VideoEditorContext = createContext<VideoEditorHarness | null>(null)

export const VideoEditorProvider = VideoEditorContext.Provider

export const useVideoEditor = (): VideoEditorHarness => {
	const value = useContext(VideoEditorContext)
	if (!value) {
		throw new Error('VideoEditorProvider is missing in the React tree')
	}

	return value
}
