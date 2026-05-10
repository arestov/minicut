/**
 * Local registry types for the render pipeline.
 * These types describe the render data shape and are intentionally isolated
 * from the domain/ command layer, which is being removed.
 */

export type ProjectId = string
export type EntityId = string
export type RelValue = EntityId | EntityId[] | null

export type EntityType = 'project' | 'timeline' | 'track' | 'resource' | 'clip' | 'effect' | 'text' | 'keyframe'

export interface Entity {
	id: EntityId
	type: EntityType
	attrs: Record<string, unknown>
	rels: Record<string, RelValue>
}

export interface GraphRoot {
	entitiesById: Record<EntityId, Entity>
}

export interface ProjectGraph {
	id: ProjectId
	version: number
	rootEntityId: EntityId
}

export interface ProjectRenderGraph extends GraphRoot {
	activeProjectId: ProjectId | null
	projects: Record<ProjectId, ProjectGraph>
}

export type ResourceKind = 'video' | 'audio' | 'image' | 'text'

export interface ResourceAttrs {
	name: string
	kind: ResourceKind
	url: string
	mime: string
	duration: number
	width?: number
	height?: number
	size?: number
	source?: Record<string, unknown>
	data?: Record<string, unknown>
	status?: string
}

export interface TrackAttrs {
	kind: 'video' | 'audio'
	name: string
	muted: boolean
	locked: boolean
	height: number
}

export interface ProjectAttrs {
	title: string
	fps: number
	width: number
	height: number
	duration: number
	createdAt: number
	updatedAt: number
}

export interface TimelineAttrs {
	name: string
	duration: number
}

export interface AnimatedScalar {
	value: number
	keyframes?: EntityId[]
}

export interface TransformAttrs {
	x: AnimatedScalar
	y: AnimatedScalar
	scale: AnimatedScalar
	rotation: AnimatedScalar
}

export interface ClipAttrs {
	name: string
	color?: string
	mediaKind?: ResourceKind
	start: number
	duration: number
	in: number
	fadeIn?: number
	fadeOut?: number
	audio?: {
		gain: number
		pan: number
	}
	opacity: AnimatedScalar
	transform: TransformAttrs
}

export interface OklchColor {
	l: number
	c: number
	h: number
	alpha: number
	gamut?: 'srgb' | 'p3'
}

export interface ColorCorrectionAttrs {
	exposure: AnimatedScalar
	contrast: AnimatedScalar
	highlights: AnimatedScalar
	shadows: AnimatedScalar
	saturation: AnimatedScalar
	vibrance: AnimatedScalar
	temperature: AnimatedScalar
	tint: AnimatedScalar
	hue: AnimatedScalar
	gamma: AnimatedScalar
}

export type EffectKind = 'blur' | 'sharpen' | 'tint' | 'color-correction' | 'vignette' | 'lut'

export interface EffectAttrs {
	name: string
	kind: EffectKind
	enabled: boolean
	amount?: number
	params?: Partial<ColorCorrectionAttrs> | Record<string, unknown>
	color?: OklchColor
}

export interface KeyframeAttrs {
	time: number
	value: number
	interpolation?: 'linear' | 'hold'
}

export interface TextStyleAttrs {
	fontFamily: string
	fontSize: number
	fontWeight: number
	lineHeight: number
	letterSpacing: number
	color: string
	backgroundColor?: string
	align: 'left' | 'center' | 'right'
}

export interface TextBoxAttrs {
	width: number
	height: number
}

export interface TextAttrs {
	content: string
	style: TextStyleAttrs
	box: TextBoxAttrs
}
