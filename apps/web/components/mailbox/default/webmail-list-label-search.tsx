"use client";
import * as React from "react";
import { MailboxEntity, MailboxSyncEntity } from "@db";
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
import type { MailboxContextMap } from "@/lib/unified-mailbox";

type WebListProps = {
    mailboxThreads: FetchMailboxThreadsResult;
    publicConfig: PublicConfig;
    activeMailbox: MailboxEntity;
    identityPublicId: string;
    identityMailboxes: FetchIdentityMailboxListResult;
    globalLabels: FetchLabelsResult;
    labelsByThreadId: FetchMailboxThreadLabelsResult;
    workspacePublicId?: string;
    mailboxSync?: MailboxSyncEntity;
    mailboxById: MailboxContextMap;
};

export default function WebmailListLabelSearch({
                                        mailboxThreads,
                                        identityPublicId,
                                        mailboxSync,
                                        activeMailbox,
                                        publicConfig,
                                        identityMailboxes,
                                        globalLabels,
                                        workspacePublicId,
                                        labelsByThreadId,
                                        mailboxById,
                                    }: WebListProps) {
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
