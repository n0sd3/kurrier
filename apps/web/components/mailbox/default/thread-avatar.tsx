"use client";
import React from "react";
import { Check } from "lucide-react";

/**
 * Doubles as the selection control on touch: it shows who the thread is from,
 * and tapping it selects the row. Replaces the checkbox below md.
 */
const PALETTE = [
	"bg-rose-500",
	"bg-orange-500",
	"bg-amber-500",
	"bg-emerald-500",
	"bg-teal-500",
	"bg-sky-500",
	"bg-indigo-500",
	"bg-violet-500",
	"bg-fuchsia-500",
];

function colorFor(seed: string) {
	let hash = 0;
	for (let i = 0; i < seed.length; i++) {
		hash = (hash * 31 + seed.charCodeAt(i)) | 0;
	}
	return PALETTE[Math.abs(hash) % PALETTE.length];
}

function initialFor(label: string) {
	const ch = label.trim().charAt(0);
	// Fall back to a neutral glyph for names starting with punctuation.
	return /\p{L}|\p{N}/u.test(ch) ? ch.toUpperCase() : "?";
}

export default function ThreadAvatar({
	label,
	email,
	selected,
	onToggle,
	className,
}: {
	label: string;
	email: string;
	selected: boolean;
	onToggle: () => void;
	className?: string;
}) {
	return (
		<button
			type="button"
			aria-label={selected ? `Deselect ${label}` : `Select ${label}`}
			aria-pressed={selected}
			onClick={(e) => {
				e.stopPropagation();
				onToggle();
			}}
			className={[
				"flex h-9 w-9 shrink-0 items-center justify-center rounded-full",
				"text-sm font-semibold text-white transition-colors",
				selected ? "bg-primary" : colorFor(email || label),
				className ?? "",
			].join(" ")}
		>
			{selected ? (
				<Check className="h-5 w-5" />
			) : (
				<span aria-hidden>{initialFor(label)}</span>
			)}
		</button>
	);
}
