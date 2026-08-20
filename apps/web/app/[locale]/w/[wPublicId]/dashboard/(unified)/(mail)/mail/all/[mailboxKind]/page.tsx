import { notFound } from "next/navigation";
import { getPublicEnv } from "@schema";
import { getWorkspacePublicId } from "@/lib/actions/clients";
import { fetchIdentityMailboxList } from "@/lib/actions/mailbox";
import {
	fetchUnifiedMailboxContext,
	fetchUnifiedThreadCount,
	fetchUnifiedThreads,
} from "@/lib/actions/unified-mailbox";
import { fetchLabels, fetchMailboxThreadLabels } from "@/lib/actions/labels";
import { isUnifiedMailboxKind } from "@/lib/unified-mailbox";
import WebmailList from "@/components/mailbox/default/webmail-list";
import UnifiedPagination from "@/components/mailbox/default/unified-pagination";
import { PAGE_SIZE } from "@common/mail-client";

const TITLE: Record<string, string> = {
	inbox: "Inbox",
	sent: "Sent",
	spam: "Spam",
	trash: "Trash",
};

export default async function Page({
	params,
	searchParams,
}: {
	params: Promise<{ mailboxKind: string }>;
	searchParams: Promise<{ page?: string }>;
}) {
	const { mailboxKind } = await params;
	const { page } = await searchParams;

	if (!isUnifiedMailboxKind(mailboxKind)) notFound();

	const parsedPage = Number(page);
	const currentPage =
		Number.isFinite(parsedPage) && parsedPage > 0 ? Math.floor(parsedPage) : 1;

	const publicConfig = getPublicEnv();
	const workspacePublicId = await getWorkspacePublicId();

	const mailboxThreadPromise = fetchUnifiedThreads(
		mailboxKind,
		currentPage,
	).then(async (mailboxThreads) => {
		const labelsByThreadId = await fetchMailboxThreadLabels(mailboxThreads);
		return { mailboxThreads, labelsByThreadId };
	});

	// The count is RLS-scoped and mirrors the list query's WHERE clause, so it
	// gives the page count without fetching the rows. Both awaits happen
	// together: serialising them would add the count's latency to the shell's
	// first flush for no reason.
	const [mailboxById, totalCount] = await Promise.all([
		fetchUnifiedMailboxContext(mailboxKind),
		fetchUnifiedThreadCount(mailboxKind),
	]);

	return (
		<div className="flex flex-1 flex-col gap-4 p-4 mb-12">
			<WebmailList
				mailboxThreadPromise={mailboxThreadPromise}
				publicConfig={publicConfig}
				mailboxById={mailboxById}
				identityMailboxesPromise={fetchIdentityMailboxList()}
				globalLabelsPromise={fetchLabels("thread")}
				workspacePublicId={workspacePublicId}
				emptyLabel={`${TITLE[mailboxKind]} across all accounts`}
				isUnified
				viewKind={mailboxKind}
			/>

			{totalCount > PAGE_SIZE && (
				<div className="text-center text-xs text-muted-foreground">
					{totalCount} conversations across all accounts
				</div>
			)}

			<UnifiedPagination
				total={totalCount}
				pageSize={PAGE_SIZE}
				page={currentPage}
				basePath={`/w/${workspacePublicId}/dashboard/mail/all/${mailboxKind}`}
			/>
		</div>
	);
}
