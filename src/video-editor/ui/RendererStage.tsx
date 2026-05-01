import { useEffect, useMemo, useRef, useState } from 'react'
import {
renderPreviewStructureAtCursor,
type PreviewStructure,
type RenderedClip,
} from '../legend/derivedTimeline'
import PreviewCanvasWorker from './previewCanvasWorker?worker'

const offscreenWorkers = new WeakMap<HTMLCanvasElement, Worker>()
const pausedSeekToleranceSeconds = 0.04
const playingSeekToleranceSeconds = 0.18
const pausedSeekIntervalMs = 45
const playingSeekIntervalMs = 250

interface MediaSeekState {
lastSeekAt: number
wasPlaying: boolean
}

interface RendererStageProps {
structure: PreviewStructure
cursor: number
isPlaying: boolean
}

const isRealMediaUrl = (url: string): boolean =>
url.startsWith('blob:') ||
url.startsWith('/') ||
url.startsWith('./') ||
url.startsWith('http') ||
url.startsWith('data:')

const drawFallbackPreview = (
canvas: HTMLCanvasElement,
cursor: number,
clips: RenderedClip[],
): void => {
const context = canvas.getContext('2d')
if (!context) {
return
}

const width = canvas.clientWidth || 640
const height = canvas.clientHeight || 360
canvas.width = width
canvas.height = height
context.clearRect(0, 0, width, height)
context.fillStyle = '#27272a'
context.fillRect(0, 0, width, height)
context.fillStyle = 'rgba(37, 99, 235, 0.2)'
context.fillRect(0, 0, width, height)
context.strokeStyle = 'rgba(244,244,245,0.28)'
context.setLineDash([6, 6])
context.strokeRect(10, 10, width - 20, height - 20)
context.setLineDash([])
context.fillStyle = '#f4f4f5'
context.font = '600 14px Inter, Segoe UI, sans-serif'
context.fillText(`Cursor ${cursor.toFixed(1)}s`, 22, 32)

if (clips.length === 0) {
return
}

clips.forEach((clip, index) => {
const y = 54 + index * 28
context.globalAlpha = Math.max(0.2, clip.opacity)
context.fillStyle = clip.color
context.fillRect(22, y, Math.min(width - 44, 260), 20)
context.globalAlpha = 1
context.fillStyle = '#18181b'
context.font = '600 12px Inter, Segoe UI, sans-serif'
context.fillText(`${clip.resourceKind}: ${clip.name}`, 30, y + 14)
})
}

const getClipLocalMediaTime = (clip: RenderedClip, cursor: number): number =>
Math.max(0, clip.inPoint + cursor - clip.start)

const syncMediaPlayback = (
element: HTMLMediaElement,
shouldPlay: boolean,
): void => {
if (shouldPlay) {
void element.play().catch(() => undefined)
return
}

element.pause()
}

const seekMediaElement = (
element: HTMLMediaElement,
localTime: number,
tolerance = pausedSeekToleranceSeconds,
): boolean => {
if (
Number.isFinite(localTime) &&
Math.abs(element.currentTime - localTime) > tolerance
) {
try {
element.currentTime = localTime
return true
} catch {
// Some browsers reject seeking before metadata is ready; metadata handlers retry.
}
}

return false
}

export const RendererStage = ({ structure, cursor, isPlaying }: RendererStageProps) => {
const canvasRef = useRef<HTMLCanvasElement | null>(null)
const workerRef = useRef<Worker | null>(null)
const mediaElementsRef = useRef(new Map<string, HTMLMediaElement>())
const mediaSeekStateRef = useRef(new Map<string, MediaSeekState>())
const [renderMode, setRenderMode] = useState<'offscreen' | 'fallback'>(
'fallback',
)
const renderedClips = useMemo(
() => renderPreviewStructureAtCursor(structure, cursor),
[structure, cursor],
)
const visualRenderedClips = renderedClips.filter((clip) => clip.resourceKind !== 'audio')
const audioRenderedClips = renderedClips.filter((clip) => clip.resourceKind === 'audio')

useEffect(() => {
const canvas = canvasRef.current
if (!canvas) {
return
}
if (navigator.userAgent.includes('jsdom')) {
return
}

const existingWorker = offscreenWorkers.get(canvas)
if (existingWorker) {
workerRef.current = existingWorker
setRenderMode('offscreen')
} else if (!workerRef.current && 'transferControlToOffscreen' in canvas) {
const offscreen = canvas.transferControlToOffscreen()
const worker = new PreviewCanvasWorker()
worker.postMessage({ type: 'init', canvas: offscreen }, [offscreen])
offscreenWorkers.set(canvas, worker)
workerRef.current = worker
setRenderMode('offscreen')
}

const width = canvas.clientWidth || 640
const height = canvas.clientHeight || 360
const frameClips = renderPreviewStructureAtCursor(structure, cursor)
const canvasClips = frameClips.map((clip) => ({
name: clip.name,
color: clip.color,
kind: clip.resourceKind,
opacity: clip.opacity,
}))
if (workerRef.current) {
workerRef.current.postMessage({
type: 'render',
width,
height,
cursor,
clips: canvasClips,
})
return
}

setRenderMode('fallback')
drawFallbackPreview(canvas, cursor, frameClips)
}, [cursor, structure])

useEffect(() => {
const now = performance.now()
for (const clip of renderPreviewStructureAtCursor(structure, cursor)) {
if (clip.resourceKind !== 'video' && clip.resourceKind !== 'audio') {
continue
}

const element = mediaElementsRef.current.get(clip.id)
if (!element) {
continue
}

const localTime = getClipLocalMediaTime(clip, cursor)
const seekState = mediaSeekStateRef.current.get(clip.id) ?? {
lastSeekAt: 0,
wasPlaying: false,
}
const playbackStateChanged = seekState.wasPlaying !== isPlaying
const tolerance = isPlaying
? playingSeekToleranceSeconds
: pausedSeekToleranceSeconds
const interval = isPlaying ? playingSeekIntervalMs : pausedSeekIntervalMs
const canSeek =
playbackStateChanged || now - seekState.lastSeekAt >= interval

if (canSeek && seekMediaElement(element, localTime, tolerance)) {
seekState.lastSeekAt = now
}
seekState.wasPlaying = isPlaying
mediaSeekStateRef.current.set(clip.id, seekState)
element.volume = Math.min(1, Math.max(0, clip.audio.gain))
element.dataset.pan = String(clip.audio.pan)
syncMediaPlayback(element, isPlaying)
}
}, [cursor, isPlaying, structure])

return (
<div className="ve-renderer" aria-label="Renderer stage">
<div className="ve-renderer__safe-area">
<canvas ref={canvasRef} className="ve-renderer__canvas" aria-label="Offscreen preview canvas" data-render-mode={renderMode} />
{visualRenderedClips.length === 0 ? (
<div className="ve-renderer__empty">No frame at cursor</div>
) : (
visualRenderedClips.map((clip) => {
const hasMedia = isRealMediaUrl(clip.resourceUrl)
return (
<div
key={clip.id}
className={`ve-renderer__layer ve-renderer__layer--${clip.resourceKind}`}
style={{
opacity: clip.opacity,
filter: clip.filters.join(' '),
borderColor: clip.color,
boxShadow: `0 0 0 2px ${clip.color}, 0 20px 45px rgba(0, 0, 0, 0.3)`,
transform: `translate(${clip.transform.x}px, ${clip.transform.y}px) scale(${clip.transform.scale}) rotate(${clip.transform.rotation}deg)`,
}}
>
{hasMedia && clip.resourceKind === 'image' ? <img src={clip.resourceUrl} alt={clip.resourceName} /> : null}
{hasMedia && clip.resourceKind === 'video' ? (
<video
ref={(element) => {
if (element) {
mediaElementsRef.current.set(clip.id, element)
return
}
mediaElementsRef.current.delete(clip.id)
mediaSeekStateRef.current.delete(clip.id)
}}
src={clip.resourceUrl}
muted
playsInline
preload="metadata"
onLoadedMetadata={(event) =>
seekMediaElement(event.currentTarget, getClipLocalMediaTime(clip, cursor))
}
/>
) : null}
{!hasMedia ? (
<>
<strong>{clip.name}</strong>
<span>{clip.resourceName}</span>
</>
) : null}
</div>
)
})
)}
<div className="ve-renderer__audio-elements" aria-hidden="true">
{audioRenderedClips.map((clip) =>
isRealMediaUrl(clip.resourceUrl) ? (
<audio
key={clip.id}
ref={(element) => {
if (element) {
mediaElementsRef.current.set(clip.id, element)
return
}
mediaElementsRef.current.delete(clip.id)
mediaSeekStateRef.current.delete(clip.id)
}}
src={clip.resourceUrl}
data-resource-name={clip.resourceName}
data-gain={clip.audio.gain}
data-pan={clip.audio.pan}
preload="metadata"
onLoadedMetadata={(event) =>
seekMediaElement(event.currentTarget, getClipLocalMediaTime(clip, cursor))
}
/>
) : null,
)}
</div>
</div>
</div>
)
}