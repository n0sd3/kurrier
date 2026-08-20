import { notFound } from "next/navigation";
import { getPublicEnv, type ThreadHit } from "@schema";
import { getWorkspacePublicId } from "@/lib/actions/clients";
import { fetchIdentityMailboxList } from "@/lib/actions/mailbox";
import {
	fetchThreadsByMailboxPairs,
	fetchUnifiedMailboxContext,
	initUnifiedSearch,
} from "@/lib/actions/unified-mailbox";
import { fetchLabels, fetchMailboxThreadLabels } from "@/lib/actions/labels";
import { isUnifiedMailboxKind } from "@/lib/unified-mailbox";
import WebmailListLabelSearch from "@/components/mailbox/default/webmail-list-label-search";
import UnifiedPagination from "@/components/mailbox/default/unified-pagination";
import { PAGE_SIZE } from "@common/mail-client";

export default async function Page({
	params,
	searchParams,
}: {
	params: Promise<{ mailboxKind: string }>;
	searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
	const { mailboxKind } = await params;
	if (!isUnifiedMailboxKind(mailboxKind)) notFound();

	const sp = await searchParams;
	// searchParams values are string | string[] | undefined (e.g. a repeated
	// ?q=a&q=b makes sp.q an array) — narrow every read instead of asserting,
	// so a hand-built URL can't 500 the page.
	const first = (v: string | string[] | undefined) =>
		Array.isArray(v) ? (v[0] ?? "") : (v ?? "");

	const q = first(sp.q);
	const has = first(sp.has) === "1";
	const unread = first(sp.unread) === "1";
	const starred = first(sp.starred) === "1";
	const pageNum = Number(first(sp.page));
	const page = Number.isFinite(pageNum) && pageNum > 0 ? Math.floor(pageNum) : 1;

	const workspacePublicId = await getWorkspacePublicId();
	if (!workspacePublicId) {
		return (
			<div className="p-4 text-sm text-muted-foreground">
				Missing workspace context.
			</div>
		);
	}

	const publicConfig = await getPublicEnv();
	const mailboxById = await fetchUnifiedMailboxContext(mailboxKind);

	let items: ThreadHit[] = [];
	let totalThreads = 0;
	let totalMessages = 0;

	if (q.trim()) {
		const res = await initUnifiedSearch(
			q,
			workspacePublicId,
			mailboxKind,
			has,
			unread,
			starred,
			page,
		);
		items = res.items ?? [];
		totalThreads = res.totalThreads ?? items.length;
		totalMessages = res.totalMessages ?? items.length;
	}

	const threads = await fetchThreadsByMailboxPairs(
		items.map((i) => ({ threadId: i.threadId, mailboxId: i.mailboxId })),
	);

	const labelsByThreadId =
		threads.length > 0 ? await fetchMailboxThreadLabels(threads) : {};

	return (
		<div className="p-4 space-y-4">
			<header className="flex items-center justify-between">
				<h1 className="text-lg font-semibold">Search · All accounts</h1>
				<div className="text-sm text-muted-foreground">
					{q.trim()
						? `Threads: ${totalThreads} • Messages: ${totalMessages}`
						: "Type a query to search"}
				</div>
			</header>

			{!q.trim() ? (
				<div className="text-sm text-muted-foreground">
					Use the search box above to run a query.
				</div>
			) : threads.length === 0 ? (
				<div className="text-sm text-muted-foreground">No results found.</div>
			) : (
				<WebmailListLabelSearch
					mailboxThreads={threads}
					publicConfig={publicConfig}
					workspacePublicId={workspacePublicId}
					mailboxById={mailboxById}
					identityMailboxes={await fetchIdentityMailboxList()}
					globalLabels={await fetchLabels("thread")}
					labelsByThreadId={labelsByThreadId}
					isUnified
					viewKind={mailboxKind}
				/>
			)}

			{q.trim() && (
				<UnifiedPagination
					total={totalThreads}
					pageSize={PAGE_SIZE}
					page={page}
					basePath={`/w/${workspacePublicId}/dashboard/mail/all/${mailboxKind}/search`}
					preservedParams={{
						q,
						has: has ? "1" : "",
						unread: unread ? "1" : "",
						starred: starred ? "1" : "",
					}}
				/>
			)}
		</div>
	);
}
