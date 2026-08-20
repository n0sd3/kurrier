"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";

// A single trashed thread fires one notification, but a rule sweeping the
// mailbox fires hundreds in a few seconds. Every one of them would otherwise
// mean a full RSC round-trip, so bursts collapse into one refresh.
const COALESCE_MS = 1200;

export default function MailboxRealtime() {
	const router = useRouter();
	const pendingRef = useRef(false);
	const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

	useEffect(() => {
		const flush = () => {
			timerRef.current = null;
			if (!pendingRef.current) return;

			// Refreshing a hidden tab burns work nobody is looking at; the
			// visibilitychange handler below picks it up when they come back.
			if (document.visibilityState === "hidden") return;

			pendingRef.current = false;
			router.refresh();
		};

		const schedule = () => {
			pendingRef.current = true;
			if (timerRef.current) return;
			timerRef.current = setTimeout(flush, COALESCE_MS);
		};

		const source = new EventSource("/api/realtime/mailbox");

		// EventSource reconnects on its own, but anything that happened while it
		// was down was missed — so treat every reconnect as "something changed".
		let seenOpen = false;
		source.onopen = () => {
			if (seenOpen) schedule();
			seenOpen = true;
		};

		source.onmessage = schedule;

		const onVisible = () => {
			if (document.visibilityState !== "visible") return;
			if (!pendingRef.current) return;
			pendingRef.current = false;
			router.refresh();
		};

		document.addEventListener("visibilitychange", onVisible);

		return () => {
			document.removeEventListener("visibilitychange", onVisible);
			if (timerRef.current) clearTimeout(timerRef.current);
			timerRef.current = null;
			source.close();
		};
	}, [router]);

	return null;
}
