interface PreviewCanvasInitMessage {
	type: 'init'
	canvas: OffscreenCanvas
}

interface PreviewCanvasRenderMessage {
	type: 'render'
	width: number
	height: number
	cursor: number
	clips: Array<{
		name: string
		kind: string
		opacity: number
	}>
}

type PreviewCanvasMessage = PreviewCanvasInitMessage | PreviewCanvasRenderMessage

let canvas: OffscreenCanvas | null = null
let context: OffscreenCanvasRenderingContext2D | null = null

const drawPreview = (
	ctx: OffscreenCanvasRenderingContext2D,
	width: number,
	height: number,
	cursor: number,
	clips: PreviewCanvasRenderMessage['clips'],
): void => {
	ctx.clearRect(0, 0, width, height)
	ctx.fillStyle = '#27272a'
	ctx.fillRect(0, 0, width, height)

	const gradient = ctx.createLinearGradient(0, 0, width, height)
	gradient.addColorStop(0, 'rgba(255,255,255,0.16)')
	gradient.addColorStop(0.48, 'rgba(255,255,255,0.02)')
	gradient.addColorStop(1, 'rgba(37,99,235,0.2)')
	ctx.fillStyle = gradient
	ctx.fillRect(0, 0, width, height)

	ctx.strokeStyle = 'rgba(244,244,245,0.28)'
	ctx.lineWidth = 1
	ctx.setLineDash([6, 6])
	ctx.strokeRect(10, 10, width - 20, height - 20)
	ctx.setLineDash([])

	ctx.fillStyle = '#f4f4f5'
	ctx.font = '600 14px Inter, Segoe UI, sans-serif'
	ctx.fillText(`Cursor ${cursor.toFixed(1)}s`, 22, 32)

	if (clips.length === 0) {
		ctx.fillStyle = '#d4d4d8'
		ctx.font = '500 16px Inter, Segoe UI, sans-serif'
		ctx.textAlign = 'center'
		ctx.fillText('No frame at cursor', width / 2, height / 2)
		ctx.textAlign = 'left'
		return
	}

	clips.forEach((clip, index) => {
		const y = 54 + index * 28
		ctx.globalAlpha = Math.max(0.2, clip.opacity)
		ctx.fillStyle = clip.kind === 'audio' ? '#cffafe' : clip.kind === 'video' ? '#dbeafe' : '#dcfce7'
		ctx.fillRect(22, y, Math.min(width - 44, 260), 20)
		ctx.globalAlpha = 1
		ctx.fillStyle = '#18181b'
		ctx.font = '600 12px Inter, Segoe UI, sans-serif'
		ctx.fillText(`${clip.kind}: ${clip.name}`, 30, y + 14)
	})
}

self.onmessage = (event: MessageEvent<PreviewCanvasMessage>) => {
	const message = event.data
	if (message.type === 'init') {
		canvas = message.canvas
		context = canvas.getContext('2d')
		return
	}

	if (!canvas || !context) {
		return
	}

	canvas.width = message.width
	canvas.height = message.height
	drawPreview(context, message.width, message.height, message.cursor, message.clips)
}
