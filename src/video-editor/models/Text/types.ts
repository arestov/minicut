/**
 * Local type declarations for the Text model.
 * Migrated from domain/types.ts in the DKT hard rewrite.
 */

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
