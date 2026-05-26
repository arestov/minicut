import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

export const InspectorSection = ({
	title,
	children,
	icon: Icon,
	ariaLabel,
}: {
	title: string;
	children: ReactNode;
	icon?: LucideIcon;
	ariaLabel?: string;
}) => (
	<section className="ve-property-section" aria-label={ariaLabel}>
		<div className="ve-property-section__header">
			{Icon ? <Icon size={15} aria-hidden="true" /> : null}
			<h3>{title}</h3>
		</div>
		{children}
	</section>
);
