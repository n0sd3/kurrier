"use client";

import * as React from "react";
import { Search } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import type { UnifiedMailboxKind } from "@/lib/unified-mailbox";

// Deliberately not MailboxSearch: that component is a ~280-line client with
// debounced typeahead, a results popover, and filter toggles, all hardwired
// to a single publicId/mailboxSlug pair. A unified search has no single
// mailbox to hardwire to, and typeahead parity is out of scope here — this
// is navigate-on-submit only, matching MailboxSearch's visual treatment so
// the unified header doesn't look out of place next to the per-account one.
export default function UnifiedMailboxSearch({
	kind,
	workspacePublicId,
}: {
	kind: UnifiedMailboxKind;
	workspacePublicId: string;
}) {
	const searchParams = useSearchParams();
	// Seed from the current URL so a page refresh or navigation back to
	// /all/{kind}/search?q=... doesn't render an empty box next to results
	// that are actually for a query.
	const [query, setQuery] = React.useState(() => searchParams.get("q") ?? "");
	const router = useRouter();

	React.useEffect(() => {
		setQuery(searchParams.get("q") ?? "");
	}, [searchParams]);

	const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
		e.preventDefault();
		const q = query.trim();
		if (!q) return;

		// Not the filter toggles (still out of scope) — just don't silently
		// drop has/unread/starred/page that are already in the URL when the
		// query changes.
		const next = new URLSearchParams(searchParams.toString());
		next.set("q", q);
		router.push(`/w/${workspacePublicId}/dashboard/mail/all/${kind}/search?${next.toString()}`);
	};

	return (
		<form
			onSubmit={handleSubmit}
			className="flex w-full min-w-0 flex-1 items-center gap-2 rounded-lg border bg-background px-3 py-2.5 text-muted-foreground sm:px-4 focus-within:ring-2 focus-within:ring-ring"
		>
			<Search className="h-4 w-4 shrink-0 opacity-60" />
			<input
				type="text"
				value={query}
				onChange={(e) => setQuery(e.target.value)}
				placeholder="Search all accounts…"
				className="w-full min-w-0 flex-1 bg-transparent text-sm text-foreground placeholder:text-muted-foreground focus:outline-none"
			/>
		</form>
	);
}
