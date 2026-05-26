import type { TextAttrs } from "./types";

export const defaultTextStyle: TextAttrs["style"] = {
	fontFamily: "Inter, Segoe UI, sans-serif",
	fontSize: 64,
	fontWeight: 700,
	lineHeight: 1.1,
	letterSpacing: 0,
	color: "#ffffff",
	backgroundColor: "rgba(0, 0, 0, 0)",
	align: "center",
};

export const defaultTextBox: TextAttrs["box"] = {
	width: 760,
	height: 220,
};
