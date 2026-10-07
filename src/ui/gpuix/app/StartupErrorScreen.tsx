import { colors } from "../theme";

/** Shown instead of the app when the real host cannot start; nothing else runs. */
export const StartupErrorScreen = (props: { title: string; hint: string; detail?: string }) => (
	<div
		testId="startup-error"
		style={{
			display: "flex",
			flexDirection: "column",
			gap: 12,
			width: "100%",
			height: "100%",
			padding: 32,
			backgroundColor: colors.window,
		}}
	>
		<text style={{ color: colors.danger, fontSize: 18, fontWeight: 600 }}>
			MiniCut cannot start
		</text>
		<text testId="startup-error-title" style={{ color: colors.text, fontSize: 14 }}>
			{props.title}
		</text>
		<text testId="startup-error-hint" style={{ color: colors.textMuted, fontSize: 13 }}>
			{props.hint}
		</text>
		{props.detail ? (
			<text style={{ color: colors.textMuted, fontSize: 11 }}>{props.detail}</text>
		) : null}
	</div>
);
