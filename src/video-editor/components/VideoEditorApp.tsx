import { Toolbar } from './Toolbar'
import { MediaBin } from './MediaBin'
import { TimelineView } from './TimelineView'
import { Inspector } from './Inspector'
import { PreviewPanel } from './PreviewPanel'
import { useEffect, useRef, useState, type CSSProperties, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent } from 'react'
import { useActions } from '../../dkt-react-sync/hooks/useActions'
import { useAttrs } from '../../dkt-react-sync/hooks/useAttrs'
import { createPreviewMediaElementRegistry } from './mediaElementRegistry'

const playbackUiFrameMs = 1000 / 30
const inspectorWidthMin = 240
const inspectorWidthMax = 460
const previewWidthMin = 360

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value))

const PlaybackLoop = () => {
	const sessionDispatch = useActions()
	const { isPlaying } = useAttrs(['isPlaying']) as { isPlaying?: unknown }

	useEffect(() => {
		if (!isPlaying) {
			return
		}

		let lastTime = performance.now()
		let accumulatedMs = 0
		let frameId = 0
		const tick = (time: number) => {
			const elapsedMs = time - lastTime
			lastTime = time
			accumulatedMs += elapsedMs
			if (accumulatedMs >= playbackUiFrameMs) {
				const deltaSeconds = Math.min(accumulatedMs / 1000, 0.25)
				accumulatedMs = 0
				sessionDispatch('tickPlayback', { deltaSeconds })
			}
			frameId = requestAnimationFrame(tick)
		}

		frameId = requestAnimationFrame(tick)
		return () => cancelAnimationFrame(frameId)
	}, [sessionDispatch, isPlaying])

	return null
}

export const VideoEditorApp = () => {
	const { activeInspectorTab } = useAttrs(['activeInspectorTab']) as { activeInspectorTab?: unknown }
	const mediaElementRegistryRef = useRef(createPreviewMediaElementRegistry())
	const mainTopRef = useRef<HTMLDivElement | null>(null)
	const isResizingInspectorRef = useRef(false)
	const stopDocumentResizeRef = useRef<(() => void) | null>(null)
	const [inspectorWidth, setInspectorWidth] = useState(280)
	const [isResizingInspector, setIsResizingInspector] = useState(false)
	const showColorScopes = activeInspectorTab === 'color'
	const resizeInspector = (clientX: number): void => {
		const rect = mainTopRef.current?.getBoundingClientRect()
		if (!rect) {
			return
		}

		const availableMax = Math.max(inspectorWidthMin, rect.width - 280 - previewWidthMin - 8)
		setInspectorWidth(clamp(rect.right - clientX, inspectorWidthMin, Math.min(inspectorWidthMax, availableMax)))
	}
	const startInspectorResize = (clientX: number): void => {
		if (isResizingInspectorRef.current) {
			return
		}

		isResizingInspectorRef.current = true
		setIsResizingInspector(true)
		resizeInspector(clientX)
		const handleDocumentPointerMove = (pointerEvent: PointerEvent): void => {
			if (!isResizingInspectorRef.current) {
				return
			}

			resizeInspector(pointerEvent.clientX)
			pointerEvent.preventDefault()
		}
		const stopDocumentResize = (): void => {
			isResizingInspectorRef.current = false
			setIsResizingInspector(false)
			window.removeEventListener('pointermove', handleDocumentPointerMove)
			window.removeEventListener('pointerup', stopDocumentResize)
			window.removeEventListener('pointercancel', stopDocumentResize)
			window.removeEventListener('mousemove', handleDocumentMouseMove)
			window.removeEventListener('mouseup', stopDocumentResize)
			stopDocumentResizeRef.current = null
		}
		const handleDocumentMouseMove = (mouseEvent: MouseEvent): void => {
			if (!isResizingInspectorRef.current) {
				return
			}

			resizeInspector(mouseEvent.clientX)
			mouseEvent.preventDefault()
		}
		stopDocumentResizeRef.current?.()
		stopDocumentResizeRef.current = stopDocumentResize
		window.addEventListener('pointermove', handleDocumentPointerMove)
		window.addEventListener('pointerup', stopDocumentResize)
		window.addEventListener('pointercancel', stopDocumentResize)
		window.addEventListener('mousemove', handleDocumentMouseMove)
		window.addEventListener('mouseup', stopDocumentResize)
	}
	const handleResizePointerDown = (event: ReactPointerEvent<HTMLDivElement>): void => {
		event.currentTarget.setPointerCapture?.(event.pointerId)
		startInspectorResize(event.clientX)
		event.preventDefault()
	}
	const handleResizeMouseDown = (event: ReactMouseEvent<HTMLDivElement>): void => {
		startInspectorResize(event.clientX)
		event.preventDefault()
	}
	const handleResizePointerMove = (event: ReactPointerEvent<HTMLDivElement>): void => {
		if (!isResizingInspectorRef.current) {
			return
		}

		resizeInspector(event.clientX)
		event.preventDefault()
	}
	const stopResize = (event: ReactPointerEvent<HTMLDivElement>): void => {
		if (!isResizingInspectorRef.current) {
			return
		}

		isResizingInspectorRef.current = false
		setIsResizingInspector(false)
		stopDocumentResizeRef.current?.()
		event.currentTarget.releasePointerCapture?.(event.pointerId)
	}

	return (
		<div className="ve-shell">
			<PlaybackLoop />
			<Toolbar />
			<main className="ve-main">
				<div
					ref={mainTopRef}
					className={`ve-main__top${showColorScopes ? ' ve-main__top--scopes' : ''}`}
					style={{ '--ve-inspector-width': `${inspectorWidth}px` } as CSSProperties}
				>
					<MediaBin />
					<PreviewPanel mediaElementRegistry={mediaElementRegistryRef.current} />
					<div
						role="separator"
						aria-label="Resize preview and inspector panels"
						aria-orientation="vertical"
						aria-valuemin={inspectorWidthMin}
						aria-valuemax={inspectorWidthMax}
						aria-valuenow={Math.round(inspectorWidth)}
						className={`ve-panel-resizer${isResizingInspector ? ' is-dragging' : ''}`}
						tabIndex={0}
						onPointerDown={handleResizePointerDown}
						onPointerMove={handleResizePointerMove}
						onPointerUp={stopResize}
						onPointerCancel={stopResize}
						onMouseDown={handleResizeMouseDown}
					/>
					<Inspector mediaElementRegistry={mediaElementRegistryRef.current} />
				</div>
				<TimelineView />
			</main>
		</div>
	)
}
