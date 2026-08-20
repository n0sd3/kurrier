"use client";
import * as React from "react";
import { PublicConfig } from "@schema";
import {
	FetchIdentityMailboxListResult, FetchMailboxResult,
	FetchMailboxThreadsResult,
} from "@/lib/actions/mailbox";
import {
	FetchLabelsResult,
	FetchMailboxThreadLabelsResult,
} from "@/lib/actions/labels";
import MailListHeader from "@/components/mailbox/default/mail-list-header";
import WebmailListItem from "@/components/mailbox/default/webmail-list-item";
import { DynamicContextProvider } from "@/hooks/use-dynamic-context";
import { PendingThreadActionsProvider } from "@/hooks/use-pending-thread-actions";
import { useParams, useRouter } from "next/navigation";
import {use} from "react";
import type { MailboxContextMap } from "@/lib/unified-mailbox";

type WebListProps = {
	mailboxThreadPromise: Promise<{ mailboxThreads: FetchMailboxThreadsResult, labelsByThreadId: FetchMailboxThreadLabelsResult }>;
	publicConfig: PublicConfig;
	identityPublicId: string;
	identityMailboxesPromise: Promise<FetchIdentityMailboxListResult>;
	fetchMailboxPromise: Promise<FetchMailboxResult>;
	globalLabelsPromise: Promise<FetchLabelsResult>;
	workspacePublicId?: string;
	mailboxById: MailboxContextMap;
};

export default function WebmailList({
	mailboxThreadPromise,
	identityPublicId,
	publicConfig,
	identityMailboxesPromise,
	globalLabelsPromise,
	workspacePublicId,
	fetchMailboxPromise,
	mailboxById
}: WebListProps) {
	const {labelsByThreadId, mailboxThreads} = use(mailboxThreadPromise)
	const globalLabels = use(globalLabelsPromise)
	const {mailboxSync, activeMailbox, identity} = use(fetchMailboxPromise)
	const identityMailboxes = use(identityMailboxesPromise)
	const params = useParams();
	const router = useRouter();

	return (
		<div className={params?.threadId ? "hidden" : ""}>
			<DynamicContextProvider
				initialState={{
					selectedThreadIds: new Set(),
					activeMailbox,
					identityPublicId,
				}}
			>
				{mailboxThreads.length === 0 ? (
					<div className="p-4 text-center text-base text-muted-foreground">
						No messages in{" "}
						<span className={"lowercase"}>{activeMailbox.name}</span>
					</div>
				) : (
					<div className="overflow-hidden rounded-xl border bg-background/50 z-[50]">
						<MailListHeader
							mailboxThreads={mailboxThreads}
							mailboxSync={mailboxSync ?? undefined}
							publicConfig={publicConfig}
							identityMailboxes={identityMailboxes}
							activeMailbox={activeMailbox}
							identity={identity}
						/>

						<PendingThreadActionsProvider onSettled={() => router.refresh()}>
						<ul role="list" className="divide-y">
							{mailboxThreads.map((mailboxThreadItem) => (
								<WebmailListItem
									key={
										mailboxThreadItem.threadId + mailboxThreadItem.mailboxId
									}
									mailboxThreadItem={mailboxThreadItem}
									workspacePublicId={workspacePublicId}
									mailboxById={mailboxById}
									globalLabels={globalLabels}
									labelsByThreadId={labelsByThreadId}
								/>
							))}
						</ul>
						</PendingThreadActionsProvider>
					</div>
				)}
			</DynamicContextProvider>
		</div>
	);
}
