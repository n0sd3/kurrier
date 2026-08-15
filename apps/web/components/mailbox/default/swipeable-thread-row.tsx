"use client";
import React, { useRef, useState, type ReactNode } from "react";

export type SwipeAction = {
	icon: ReactNode;
	label: string;
	/** Background revealed while dragging toward this action. */
	bgClassName: string;
	onCommit: () => void;
};

type Props = {
	/** Revealed by dragging left (finger moves toward the start of the row). */
	left?: SwipeAction | null;
	/** Revealed by dragging right. */
	right?: SwipeAction | null;
	className?: string;
	children: ReactNode;
};

/** Fraction of the row width the finger must pass for the action to fire. */
const COMMIT_RATIO = 0.4;
/** Movement needed before we decide the gesture is horizontal, not a scroll. */
const LOCK_SLOP_PX = 8;

export default function SwipeableThreadRow({
	left,
	right,
	className,
	children,
}: Props) {
	const rowRef = useRef<HTMLLIElement>(null);
	const start = useRef<{ x: number; y: number } | null>(null);
	const axis = useRef<"undecided" | "horizontal" | "vertical">("undecided");

	const [offset, setOffset] = useState(0);
	const [dragging, setDragging] = useState(false);

	// A fast flick can deliver its moves and the release in one batch, before
	// React re-renders. The release must read the live value, not the rendered one.
	const offsetRef = useRef(0);
	const setDragOffset = (next: number) => {
		offsetRef.current = next;
		setOffset(next);
	};

	// Only touch input swipes. A mouse on desktop never arms the gesture, so
	// this needs no breakpoint and no media query.
	const isTouch = (e: React.PointerEvent) => e.pointerType === "touch";

	const actionFor = (dx: number) => (dx < 0 ? left : right);

	const reset = () => {
		start.current = null;
		axis.current = "undecided";
		setDragging(false);
		setDragOffset(0);
	};

	const onPointerDown = (e: React.PointerEvent<HTMLLIElement>) => {
		if (!isTouch(e) || (!left && !right)) return;
		start.current = { x: e.clientX, y: e.clientY };
		axis.current = "undecided";
	};

	const onPointerMove = (e: React.PointerEvent<HTMLLIElement>) => {
		if (!start.current || !isTouch(e)) return;

		const dx = e.clientX - start.current.x;
		const dy = e.clientY - start.current.y;

		if (axis.current === "undecided") {
			if (Math.abs(dy) > LOCK_SLOP_PX && Math.abs(dy) > Math.abs(dx)) {
				// Vertical scroll wins; stay out of its way for the rest of the gesture.
				axis.current = "vertical";
				start.current = null;
				return;
			}
			if (Math.abs(dx) > LOCK_SLOP_PX) {
				axis.current = "horizontal";
				setDragging(true);
				e.currentTarget.setPointerCapture(e.pointerId);
			} else {
				return;
			}
		}

		if (axis.current !== "horizontal") return;

		// Don't let the row drag toward a direction that has no action.
		const clamped = actionFor(dx) ? dx : 0;
		setDragOffset(clamped);
	};

	const onPointerUp = (e: React.PointerEvent<HTMLLIElement>) => {
		if (!isTouch(e)) return;
		if (axis.current !== "horizontal") {
			reset();
			return;
		}

		const width = rowRef.current?.offsetWidth ?? 0;
		const released = offsetRef.current;
		const action = actionFor(released);
		const passed = width > 0 && Math.abs(released) >= width * COMMIT_RATIO;

		reset();
		if (action && passed) action.onCommit();
	};

	const revealed = actionFor(offset);
	const progress = Math.min(
		1,
		Math.abs(offset) / ((rowRef.current?.offsetWidth ?? 1) * COMMIT_RATIO),
	);

	return (
		<li
			ref={rowRef}
			className="relative overflow-hidden bg-background"
			style={{ touchAction: "pan-y" }}
			onPointerDown={onPointerDown}
			onPointerMove={onPointerMove}
			onPointerUp={onPointerUp}
			onPointerCancel={reset}
		>
			{revealed && offset !== 0 && (
				<div
					aria-hidden
					className={[
						"absolute inset-0 flex items-center px-6 text-white",
						offset < 0 ? "justify-end" : "justify-start",
						revealed.bgClassName,
					].join(" ")}
				>
					<span
						className="transition-transform"
						style={{ transform: `scale(${0.7 + progress * 0.3})` }}
					>
						{revealed.icon}
					</span>
				</div>
			)}

			{/*
				Opaque wrapper: row tints like bg-muted/30 are translucent and would
				let the action colour bleed through the row while it slides.
			*/}
			<div
				className={[
					"relative bg-background",
					dragging ? "" : "transition-transform duration-200",
				].join(" ")}
				style={{ transform: `translateX(${offset}px)` }}
			>
				<div className={className}>{children}</div>
			</div>
		</li>
	);
}
