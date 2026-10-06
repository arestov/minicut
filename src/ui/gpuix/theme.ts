/** Design tokens of the GPUIX shell. Plain values: native styles take numbers and CSS colors. */
export const colors = {
	window: "#18181b",
	panel: "#202024",
	panelHeader: "#27272c",
	border: "#34343b",
	text: "#e4e4e7",
	textMuted: "#8b8b95",
	accent: "#3b82f6",
	control: "#2d2d33",
	controlHover: "#38383f",
	controlActive: "#44444c",
	danger: "#ef4444",
} as const;

export const metrics = {
	toolbarHeight: 44,
	statusBarHeight: 26,
	sidebarWidth: 280,
	timelineHeight: 280,
	panelHeaderHeight: 30,
	gap: 8,
	radius: 6,
	fontSize: 13,
} as const;
