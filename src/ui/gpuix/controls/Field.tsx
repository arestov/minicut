import type { JSX } from "solid-js";
import { colors } from "../theme";

/** A muted label with its control or value on one row. */
export const Field = (props: { label: string; labelWidth?: number; children: JSX.Element }) => (
	<div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0, minHeight: 28 }}>
		<text style={{ color: colors.textMuted, fontSize: 12, width: props.labelWidth ?? 96 }}>
			{props.label}
		</text>
		{props.children}
	</div>
);

/** A small bold heading inside a panel body. */
export const SectionTitle = (props: { children: string }) => (
	<text style={{ color: colors.text, fontSize: 12, fontWeight: 600, flexShrink: 0 }}>
		{props.children}
	</text>
);
