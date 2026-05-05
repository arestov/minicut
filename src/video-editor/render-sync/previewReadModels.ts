import { useCallback, useMemo, useSyncExternalStore } from 'react'
import { useVideoEditor } from '../app/VideoEditorContext'
import {
	createPreviewFrame$,
	createPreviewStructure$,
	type PreviewFrame,
	type PreviewStructure,
} from '../legend/derivedTimeline'

const subscribeComputed = (computedValue: { onChange(listener: () => void): () => void }, listener: () => void): (() => void) =>
	computedValue.onChange(() => listener())

export const usePreviewReadModels = (): {
	frame: PreviewFrame
	structure: PreviewStructure
} => {
	const { projects$, session$ } = useVideoEditor()
	const previewStructure$ = useMemo(
		() => createPreviewStructure$(projects$, session$),
		[projects$, session$],
	)
	const previewFrame$ = useMemo(
		() => createPreviewFrame$(previewStructure$, session$),
		[previewStructure$, session$],
	)
	const subscribeStructure = useCallback(
		(listener: () => void) => subscribeComputed(previewStructure$, listener),
		[previewStructure$],
	)
	const subscribeFrame = useCallback(
		(listener: () => void) => subscribeComputed(previewFrame$, listener),
		[previewFrame$],
	)
	const getStructure = useCallback(() => previewStructure$.get(), [previewStructure$])
	const getFrame = useCallback(() => previewFrame$.get(), [previewFrame$])

	return {
		structure: useSyncExternalStore(subscribeStructure, getStructure, getStructure),
		frame: useSyncExternalStore(subscribeFrame, getFrame, getFrame),
	}
}
