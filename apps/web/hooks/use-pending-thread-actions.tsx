"use client";
import React, {
	createContext,
	useCallback,
	useContext,
	useEffect,
	useMemo,
	useRef,
	useState,
	type ReactNode,
} from "react";
import { toast } from "sonner";

export const UNDO_WINDOW_MS = 5000;

type Pending = {
	timer: ReturnType<typeof setTimeout>;
	run: () => Promise<void> | void;
};

type PendingThreadActionsType = {
	/** Hide the thread now, run the action once the undo window closes. */
	schedule: (
		threadId: string,
		run: () => Promise<void> | void,
		label: string,
	) => void;
	cancel: (threadId: string) => void;
	isPending: (threadId: string) => boolean;
};

const Ctx = createContext<PendingThreadActionsType | null>(null);

export function PendingThreadActionsProvider({
	children,
	onSettled,
}: {
	children: ReactNode;
	/** Called after a deferred action actually runs, to refresh the list. */
	onSettled?: () => void;
}) {
	const [pendingIds, setPendingIds] = useState<Set<string>>(new Set());
	const pending = useRef(new Map<string, Pending>());

	const forget = useCallback((threadId: string) => {
		pending.current.delete(threadId);
		setPendingIds((prev) => {
			if (!prev.has(threadId)) return prev;
			const next = new Set(prev);
			next.delete(threadId);
			return next;
		});
	}, []);

	const cancel = useCallback(
		(threadId: string) => {
			const entry = pending.current.get(threadId);
			if (!entry) return;
			clearTimeout(entry.timer);
			forget(threadId);
		},
		[forget],
	);

	const onSettledRef = useRef(onSettled);
	onSettledRef.current = onSettled;

	const schedule = useCallback<PendingThreadActionsType["schedule"]>(
		(threadId, run, label) => {
			// A second gesture on the same thread replaces the first.
			cancel(threadId);

			const timer = setTimeout(async () => {
				forget(threadId);
				try {
					await run();
					onSettledRef.current?.();
				} catch {
					toast.error("Action failed", { position: "bottom-left" });
					onSettledRef.current?.();
				}
			}, UNDO_WINDOW_MS);

			pending.current.set(threadId, { timer, run });
			setPendingIds((prev) => new Set(prev).add(threadId));

			toast(label, {
				position: "bottom-left",
				duration: UNDO_WINDOW_MS,
				action: {
					label: "Undo",
					onClick: () => cancel(threadId),
				},
			});
		},
		[cancel, forget],
	);

	// Navigating away unmounts us with timers still armed. Nothing has reached
	// the server yet, so run them now rather than silently dropping them.
	useEffect(() => {
		const armed = pending.current;
		return () => {
			for (const [, entry] of armed) {
				clearTimeout(entry.timer);
				void entry.run();
			}
			armed.clear();
		};
	}, []);

	const value = useMemo(
		() => ({
			schedule,
			cancel,
			isPending: (threadId: string) => pendingIds.has(threadId),
		}),
		[schedule, cancel, pendingIds],
	);

	return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function usePendingThreadActions(): PendingThreadActionsType {
	const ctx = useContext(Ctx);
	if (!ctx) {
		throw new Error(
			"usePendingThreadActions must be used within a PendingThreadActionsProvider",
		);
	}
	return ctx;
}
