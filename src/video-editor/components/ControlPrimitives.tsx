import type { LucideIcon } from "lucide-react";
import type { ButtonHTMLAttributes, ReactNode } from "react";

type ButtonVariant =
	| "default"
	| "secondary"
	| "outline"
	| "ghost"
	| "destructive";
type ButtonSize = "sm" | "default" | "icon";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
	variant?: ButtonVariant;
	size?: ButtonSize;
}

const joinClassNames = (
	...classNames: Array<string | false | null | undefined>
): string => classNames.filter(Boolean).join(" ");

export const Button = ({
	className,
	variant = "outline",
	size = "default",
	...props
}: ButtonProps) => (
	<button
		className={joinClassNames(
			"ve-button",
			`ve-button--${variant}`,
			`ve-button--${size}`,
			className,
		)}
		{...props}
	/>
);

interface IconButtonProps extends ButtonProps {
	icon: LucideIcon;
	label: string;
	children?: ReactNode;
}

export const IconButton = ({
	icon: Icon,
	label,
	children,
	className,
	size = children ? "sm" : "icon",
	title,
	...props
}: IconButtonProps) => (
	<Button
		aria-label={label}
		title={title ?? label}
		className={joinClassNames(
			"ve-icon-button",
			children ? "ve-icon-button--with-label" : null,
			className,
		)}
		size={size}
		{...props}
	>
		<Icon size={16} strokeWidth={2} aria-hidden="true" />
		{children ? <span>{children}</span> : null}
	</Button>
);

export const VisuallyHidden = ({ children }: { children: ReactNode }) => (
	<span className="ve-sr-only">{children}</span>
);
