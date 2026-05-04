export type PreviewMediaElementKind = 'video' | 'audio'

export interface PreviewMediaElementEntry {
	clipId: string
	kind: PreviewMediaElementKind
	resourceUrl: string
	element: HTMLMediaElement
}

export class PreviewMediaElementRegistry {
	private readonly elements = new Map<string, PreviewMediaElementEntry>()

	set(clipId: string, kind: PreviewMediaElementKind, resourceUrl: string, element: HTMLMediaElement): void {
		this.elements.set(clipId, { clipId, kind, resourceUrl, element })
	}

	delete(clipId: string, element?: HTMLMediaElement | null): void {
		const current = this.elements.get(clipId)
		if (!current || (element && current.element !== element)) {
			return
		}
		this.elements.delete(clipId)
	}

	get(clipId: string): PreviewMediaElementEntry | undefined {
		return this.elements.get(clipId)
	}

	getVideo(clipId: string): HTMLVideoElement | undefined {
		const entry = this.elements.get(clipId)
		return entry?.kind === 'video' && entry.element instanceof HTMLVideoElement
			? entry.element
			: undefined
	}

	getVideos(): HTMLVideoElement[] {
		return Array.from(this.elements.values())
			.filter((entry): entry is PreviewMediaElementEntry & { element: HTMLVideoElement } =>
				entry.kind === 'video' && entry.element instanceof HTMLVideoElement)
			.map((entry) => entry.element)
	}
}

export const createPreviewMediaElementRegistry = (): PreviewMediaElementRegistry => new PreviewMediaElementRegistry()
