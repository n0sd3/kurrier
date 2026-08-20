import { notFound } from "next/navigation";
import { getPublicEnv } from "@schema";
import { getWorkspacePublicId } from "@/lib/actions/clients";
import { fetchIdentityMailboxList } from "@/lib/actions/mailbox";
import {
	fetchUnifiedMailboxContext,
	fetchUnifiedThreads,
} from "@/lib/actions/unified-mailbox";
import { fetchLabels, fetchMailboxThreadLabels } from "@/lib/actions/labels";
import { isUnifiedMailboxKind } from "@/lib/unified-mailbox";
import WebmailList from "@/components/mailbox/default/webmail-list";

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
		</div>
	);
}
