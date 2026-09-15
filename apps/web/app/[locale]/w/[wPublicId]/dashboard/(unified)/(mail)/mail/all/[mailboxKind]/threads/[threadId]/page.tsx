import type { MessageEntity } from "@db";
import { Divider } from "@mantine/core";
import { notFound } from "next/navigation";
import ThreadBackLink from "@/components/mailbox/default/thread-back-link";
import ThreadItem from "@/components/mailbox/default/thread-item";
import { getWorkspacePublicId } from "@/lib/actions/clients";
import {
	fetchLabelsByIdentityPublicId,
	fetchMailboxThreadLabels,
} from "@/lib/actions/labels";
import {
	fetchThreadMailSubscriptions,
	fetchWebMailThreadDetail,
} from "@/lib/actions/mailbox";
import { fetchUnifiedThreadContext } from "@/lib/actions/unified-mailbox";
import { isUnifiedMailboxKind } from "@/lib/unified-mailbox";

async function Page({
	params,
}: {
	params: Promise<{
		mailboxKind: string;
		threadId: string;
	}>;
}) {
	const { mailboxKind, threadId } = await params;

	if (!isUnifiedMailboxKind(mailboxKind)) notFound();

	const [threadContext, activeThread, workspacePublicId] = await Promise.all([
		fetchUnifiedThreadContext(mailboxKind, threadId),
		fetchWebMailThreadDetail(threadId),
		getWorkspacePublicId(),
	]);

	if (!threadContext) notFound();

	const { mailbox: activeMailbox, identityPublicId, sync } = threadContext;

	const { byMessageId } = await fetchThreadMailSubscriptions({
		ownerId: activeMailbox.ownerId,
		messages:
			activeThread?.messages.map((m: MessageEntity) => ({
				id: m.id,
				headersJson: m.headersJson,
			})) ?? [],
	});

	const allLabels = await fetchLabelsByIdentityPublicId({
		identityPublicId,
		scope: "thread",
	});
	const labelsByThreadId = await fetchMailboxThreadLabels([{ threadId }]);

	return (
		<>
			<ThreadBackLink
				href={`/w/${workspacePublicId}/dashboard/mail/all/${mailboxKind}`}
			/>
			{activeThread?.messages.map((message, threadIndex) => {
				return (
					<div key={message.id}>
						<ThreadItem
							message={message}
							threadIndex={threadIndex}
							numberOfMessages={activeThread.messages.length}
							threadId={threadId}
							activeMailboxId={activeMailbox.id}
							markSmtp={!!sync}
							identityPublicId={identityPublicId}
							mailSubscription={byMessageId.get(message.id) ?? null}
							allLabels={allLabels}
							labelsByThreadId={labelsByThreadId}
						/>
						<Divider className={"opacity-50 mb-6"} ml={"xl"} mr={"xl"} />
					</div>
				);
			})}
		</>
	);
}

export default Page;
