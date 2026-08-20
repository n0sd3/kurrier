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

	const publicConfig = getPublicEnv();
	const workspacePublicId = await getWorkspacePublicId();
	const mailboxById = await fetchUnifiedMailboxContext(mailboxKind);

	const mailboxThreadPromise = fetchUnifiedThreads(
		mailboxKind,
		Number(page),
	).then(async (mailboxThreads) => {
		const labelsByThreadId = await fetchMailboxThreadLabels(mailboxThreads);
		return { mailboxThreads, labelsByThreadId };
	});

	// Full pagination is out of scope here, so the list only ever shows the
	// first PAGE_SIZE threads. The count is RLS-scoped and mirrors the list
	// query's WHERE clause, so it's safe to use purely to tell the user
	// there's more, without fetching or rendering the rest.
	const totalCount = await fetchUnifiedThreadCount(mailboxKind);

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
					Showing the {PAGE_SIZE} most recent of {totalCount}
				</div>
			)}
		</div>
	);
}
