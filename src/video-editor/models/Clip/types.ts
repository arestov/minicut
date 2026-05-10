/**
 * Local type declarations for the Clip model.
 * Migrated from domain/types.ts in the DKT hard rewrite.
 */
import type { ResourceKind } from "../../render/registryTypes";

export interface TransformAttrs {
	x: { value: number; keyframes?: string[] };
	y: { value: number; keyframes?: string[] };
	scale: { value: number; keyframes?: string[] };
	rotation: { value: number; keyframes?: string[] };
}

export interface ClipAttrs {
	name: string;
	color?: string;
	mediaKind?: ResourceKind;
	start: number;
	duration: number;
	in: number;
	fadeIn?: number;
	fadeOut?: number;
	audio?: {
		gain: number;
		pan: number;
	};
	opacity: { value: number; keyframes?: string[] };
	transform: TransformAttrs;
}
