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
	const q = (sp.q as string) ?? "";
	const has = (sp.has as string) === "1";
	const unread = (sp.unread as string) === "1";
	const starred = (sp.starred as string) === "1";
	const page = Math.max(1, Number((sp.page as string) ?? 1));

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
				/>
			)}
		</div>
	);
}
