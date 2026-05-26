import { describe, expect, it } from "vitest";
import {
	reduceTextBoxAction,
	reduceTextContentAction,
	reduceTextStyleAction,
} from "../models/Text/actions";
import { defaultTextBox, defaultTextStyle } from "../models/Text/defaults";

describe("DKT text actions", () => {
	it("reduces concrete text attrs", () => {
		expect(reduceTextContentAction({ content: "After" })).toEqual({
			content: "After",
		});
		expect(
			reduceTextStyleAction(
				{ style: { color: "#111827" } },
				{ style: defaultTextStyle },
			),
		).toEqual({
			style: { ...defaultTextStyle, color: "#111827" },
		});
		expect(
			reduceTextBoxAction({ box: { width: 640 } }, { box: defaultTextBox }),
		).toEqual({
			box: { ...defaultTextBox, width: 640 },
		});
	});
});
