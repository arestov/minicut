import { model } from 'dkt/model.js'
import {
	defaultTextBox,
	defaultTextStyle,
	reduceTextBoxAction,
	reduceTextContentAction,
	reduceTextStyleAction,
} from '../dkt/textActions'

export const Text = model({
	model_name: 'minicut_text',
	attrs: {
		sourceTextId: ['input', null],
		content: ['input', 'Text'],
		style: ['input', defaultTextStyle],
		box: ['input', defaultTextBox],
	},
	actions: {
		setTextContent: {
			to: {
				content: ['content'],
			},
			fn: (payload: unknown) => reduceTextContentAction(payload) ?? '$noop',
		},
		setTextStyle: {
			to: {
				style: ['style'],
			},
			fn: [
				['style'] as const,
				(payload: unknown, style: unknown) => {
					const patch = reduceTextStyleAction(payload, {
						style: style && typeof style === 'object' ? style as typeof defaultTextStyle : defaultTextStyle,
					})
					return patch ?? '$noop'
				},
			],
		},
		setTextBox: {
			to: {
				box: ['box'],
			},
			fn: [
				['box'] as const,
				(payload: unknown, box: unknown) => reduceTextBoxAction(payload, {
					box: box && typeof box === 'object' ? box as typeof defaultTextBox : defaultTextBox,
				}) ?? '$noop',
			],
		},
	},
})

export const TEXT_PROXY_CREATION_SHAPE = {
	attrs: ['sourceTextId', 'content', 'style', 'box'],
} as const
