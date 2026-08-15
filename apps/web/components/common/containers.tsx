type ContainerVariant = "wide" | "medium" | "narrow" | "full";

export function Container({
	children,
	variant = "medium",
	className = "",
}: {
	children: React.ReactNode;
	variant?: ContainerVariant;
	className?: string;
}) {
	const base = "w-full mx-auto px-4 sm:px-6 lg:px-8";

	// No min-w-* here: a min-width wins over max-width, so it would both stop
	// mx-auto from ever centring the container and force the page to overflow
	// horizontally once the sidebar leaves less room than the minimum.
	const variants: Record<ContainerVariant, string> = {
		wide: "max-w-7xl",
		medium: "max-w-3xl lg:max-w-5xl",
		narrow: "max-w-xl lg:max-w-3xl",
		full: "max-w-none",
	};

	return (
		<div className={`${base} ${variants[variant]} ${className}`}>
			{children}
		</div>
	);
}
