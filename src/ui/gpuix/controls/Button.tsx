import type { JSX } from "solid-js";
import { colors, metrics } from "../theme";

/**
 * A focusable native div that acts like a button: Tab stop, role, click on
 * press, Enter and Space. (The installed @gpuix/solid has no Button primitive.)
 */
export const Button = (props: {
	children: JSX.Element;
	onClick?: () => void;
	disabled?: boolean;
	/** Pressed/selected look for toggles. */
	active?: boolean;
	testId?: string;
	"aria-label"?: string;
	width?: number;
}) => {
	const activate = () => {
		if (!props.disabled) props.onClick?.();
	};

	return (
		<div
			role="button"
			tabIndex={props.disabled ? -1 : 0}
			testId={props.testId}
			aria-label={props["aria-label"]}
			aria-selected={props.active}
			onClick={activate}
			onKeyDown={(event) => {
				if (event.key === "enter" || event.key === "space") activate();
			}}
			style={{
				display: "flex",
				alignItems: "center",
				justifyContent: "center",
				height: 28,
				minWidth: props.width ?? 28,
				paddingLeft: 10,
				paddingRight: 10,
				borderRadius: metrics.radius,
				backgroundColor: props.active ? colors.accent : colors.control,
				color: props.disabled ? colors.textMuted : colors.text,
				fontSize: metrics.fontSize,
				opacity: props.disabled ? 0.5 : 1,
				cursor: props.disabled ? "default" : "pointer",
				userSelect: "none",
				hover: props.disabled
					? undefined
					: { backgroundColor: props.active ? colors.accent : colors.controlHover },
				active: props.disabled ? undefined : { backgroundColor: colors.controlActive },
			}}
		>
			{props.children}
		</div>
	);
};
