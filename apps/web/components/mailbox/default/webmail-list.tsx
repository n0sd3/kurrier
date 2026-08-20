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
import type { MailboxKind } from "@schema";

type WebListProps = {
	mailboxThreadPromise: Promise<{ mailboxThreads: FetchMailboxThreadsResult, labelsByThreadId: FetchMailboxThreadLabelsResult }>;
	publicConfig: PublicConfig;
	mailboxById: MailboxContextMap;
	identityMailboxesPromise: Promise<FetchIdentityMailboxListResult>;
	fetchMailboxPromise?: Promise<FetchMailboxResult>;
	globalLabelsPromise: Promise<FetchLabelsResult>;
	workspacePublicId?: string;
	emptyLabel?: string;
	isUnified?: boolean;
	viewKind?: MailboxKind;
};

export default function WebmailList({
	mailboxThreadPromise,
	publicConfig,
	identityMailboxesPromise,
	globalLabelsPromise,
	workspacePublicId,
	fetchMailboxPromise,
	mailboxById,
	emptyLabel,
	isUnified,
	viewKind,
}: WebListProps) {
	const {labelsByThreadId, mailboxThreads} = use(mailboxThreadPromise)
	const globalLabels = use(globalLabelsPromise)
	const mailboxResult = fetchMailboxPromise ? use(fetchMailboxPromise) : null;
	const activeMailbox = mailboxResult?.activeMailbox ?? null;
	const mailboxSync = mailboxResult?.mailboxSync ?? null;
	const identity = mailboxResult?.identity;
	const identityMailboxes = use(identityMailboxesPromise)
	const params = useParams();
	const router = useRouter();

	return (
		<div className={params?.threadId ? "hidden" : ""}>
			<DynamicContextProvider
				initialState={{
					selectedThreadIds: new Set(),
				}}
			>
				{mailboxThreads.length === 0 ? (
					<div className="p-4 text-center text-base text-muted-foreground">
						No messages in{" "}
						<span className={"lowercase"}>
							{emptyLabel ?? activeMailbox?.name ?? "this mailbox"}
						</span>
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
							mailboxById={mailboxById}
							isUnified={isUnified}
							viewKind={viewKind}
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
									showAccount={isUnified}
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
