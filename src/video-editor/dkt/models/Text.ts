import { model } from 'dkt/model.js'
import { defaultTextBox, defaultTextStyle, reduceDktTextAction } from '../textActions'

export const Text = model({
	model_name: 'minicut_text',
	attrs: {
		sourceTextId: ['input', null],
		content: ['input', 'Text'],
		style: ['input', defaultTextStyle],
		box: ['input', defaultTextBox],
	},
	actions: {
		updateText: {
			to: {
				content: ['content'],
				style: ['style'],
				box: ['box'],
			},
			fn: [
				['style', 'box'] as const,
				(payload: unknown, style: unknown, box: unknown) => {
					const patch = reduceDktTextAction(payload, {
						style: style && typeof style === 'object' ? style as typeof defaultTextStyle : defaultTextStyle,
						box: box && typeof box === 'object' ? box as typeof defaultTextBox : defaultTextBox,
					})
					return patch ?? '$noop'
				},
			],
		},
	},
})

export const TEXT_PROXY_CREATION_SHAPE = {
	attrs: ['sourceTextId', 'content', 'style', 'box'],
} as const
