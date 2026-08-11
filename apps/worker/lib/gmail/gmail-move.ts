import { and, eq, inArray, sql } from "drizzle-orm";
import { db, mailboxes, messages, mailboxThreads } from "@db";
import {gmailClientForIdentity} from "@providers";
import {getRedis} from "../../lib/get-redis";

type MoveGmailMailArgs = {
    threadId: string;
    mailboxId: string;
    toMailboxId?: string;
    messageId?: string;
    op: "move" | "trash" | "archive" | "spam";
    moveImap?: boolean;
};

async function getGmailMailboxPath(
    mailbox: typeof mailboxes.$inferSelect,
): Promise<string> {
    const parts = [mailbox.name];

    let parentId = mailbox.parentId;

    while (parentId) {
        const [parent] = await db
            .select()
            .from(mailboxes)
            .where(eq(mailboxes.id, parentId))
            .limit(1);

        if (!parent) break;

        parts.unshift(parent.name);
        parentId = parent.parentId;
    }

    return parts.join("/");
}

async function enqueueGmailDelta(identityId: string, workspaceId: string) {
    const { gmailQueue } = await getRedis();

    await gmailQueue.add(
        "gmail:delta-sync",
        { identityId, workspaceId },
        {
            jobId: `gmail-delta-sync-${identityId}-${Date.now()}`,
            attempts: 3,
            backoff: { type: "exponential", delay: 5000 },
            removeOnComplete: true,
            removeOnFail: true,
        },
    );
}

async function ensureGmailLabelForMailbox(opts: {
    gmail: any;
    mailbox: typeof mailboxes.$inferSelect;
}) {
    const { gmail, mailbox } = opts;

    const existingLabelId = (mailbox.metaData as any)?.gmail?.labelId;
    if (existingLabelId) return existingLabelId as string;

    const gmailName = await getGmailMailboxPath(mailbox);

    const created = await gmail.users.labels.create({
        userId: "me",
        requestBody: {
            name: gmailName,
            labelListVisibility: "labelShow",
            messageListVisibility: "show",
        },
    });

    const gmailLabelId = created.data.id;
    if (!gmailLabelId) throw new Error("Gmail returned no label id");

    await db
        .update(mailboxes)
        .set({
            metaData: {
                ...(mailbox.metaData ?? {}),
                gmail: {
                    ...((mailbox.metaData as any)?.gmail ?? {}),
                    labelId: gmailLabelId,
                    path: gmailName,
                },
            },
            updatedAt: new Date(),
        } as any)
        .where(eq(mailboxes.id, mailbox.id));

    await enqueueGmailDelta(mailbox.identityId, mailbox.workspaceId);

    return gmailLabelId as string;
}

export async function moveGmailMail(args: MoveGmailMailArgs) {
    const [fromMailbox] = await db
        .select()
        .from(mailboxes)
        .where(eq(mailboxes.id, args.mailboxId))
        .limit(1);

    if (!fromMailbox) throw new Error("Source mailbox not found");

    let toMailbox: typeof mailboxes.$inferSelect | undefined;

    if (args.op === "move") {
        if (!args.toMailboxId) throw new Error("Destination mailbox missing");

        [toMailbox] = await db
            .select()
            .from(mailboxes)
            .where(eq(mailboxes.id, args.toMailboxId))
            .limit(1);
    } else {
        [toMailbox] = await db
            .select()
            .from(mailboxes)
            .where(
                and(
                    eq(mailboxes.identityId, fromMailbox.identityId),
                    eq(mailboxes.kind, args.op as any),
                ),
            )
            .limit(1);
    }

    if (!toMailbox) throw new Error(`Destination mailbox not found for op=${args.op}`);

    const identityId = fromMailbox.identityId;

    if (toMailbox.identityId !== identityId) {
        throw new Error("Cannot move across identities");
    }

    const { gmail } = await gmailClientForIdentity(identityId);

    const fromLabelId = (fromMailbox.metaData as any)?.gmail?.labelId;
    let toLabelId = (toMailbox.metaData as any)?.gmail?.labelId as string | undefined;

    if (!fromLabelId) throw new Error("Source Gmail labelId missing");

    if (args.op === "move") {
        toLabelId = await ensureGmailLabelForMailbox({
            gmail,
            mailbox: toMailbox,
        });
    }

    if (args.op !== "archive" && args.op !== "trash" && args.op !== "spam" && !toLabelId) {
        throw new Error("Destination Gmail labelId missing");
    }

    const rows = await db
        .select({
            id: messages.id,
            gmailMessageId: sql<string | null>`
				${messages.metaData}->'gmail'->>'messageId'
			`,
            metaData: messages.metaData,
        })
        .from(messages)
        .where(
            and(
                eq(messages.threadId, args.threadId),
                eq(messages.mailboxId, args.mailboxId),
            ),
        );

    const targetRows = args.messageId
        ? rows.filter((row) => row.id === args.messageId)
        : rows;

    const staleIds = new Set<string>();
    const failures: string[] = [];

    for (const row of targetRows) {
        if (!row.gmailMessageId) continue;

        try {
            if (args.op === "trash") {
                await gmail.users.messages.trash({
                    userId: "me",
                    id: row.gmailMessageId,
                });
            } else if (args.op === "archive") {
                await gmail.users.messages.modify({
                    userId: "me",
                    id: row.gmailMessageId,
                    requestBody: {
                        removeLabelIds: ["INBOX"],
                    },
                });
            } else if (args.op === "spam") {
                await gmail.users.messages.modify({
                    userId: "me",
                    id: row.gmailMessageId,
                    requestBody: {
                        removeLabelIds: [fromLabelId],
                        addLabelIds: ["SPAM"],
                    },
                });
            } else {
                await gmail.users.messages.modify({
                    userId: "me",
                    id: row.gmailMessageId,
                    requestBody: {
                        removeLabelIds: [fromLabelId],
                        addLabelIds: [toLabelId!],
                    },
                });
            }
        } catch (err: any) {
            // Gmail returns 404 when the message no longer exists on their
            // side (e.g. it was already removed/reclassified since our last
            // sync). Treat that as stale data to reconcile locally instead
            // of failing (and endlessly retrying) the whole bulk operation.
            if (err?.code === 404) {
                staleIds.add(row.id);
                continue;
            }

            console.error(
                "[moveGmailMail] failed to update message",
                row.gmailMessageId,
                err,
            );
            failures.push(row.gmailMessageId);
        }
    }

    if (staleIds.size) {
        await db.delete(messages).where(inArray(messages.id, Array.from(staleIds)));
    }

    const syncedRows = targetRows.filter((row) => !staleIds.has(row.id));

    await db.transaction(async (tx) => {
        for (const row of syncedRows) {
            const currentMeta = (row.metaData as any) ?? {};
            const currentGmailMeta = currentMeta.gmail ?? {};
            const oldLabelIds = Array.isArray(currentGmailMeta.labelIds)
                ? currentGmailMeta.labelIds
                : [];

            const nextLabelIds =
                args.op === "archive"
                    ? oldLabelIds.filter((id: string) => id !== "INBOX")
                    : args.op === "trash"
                        ? Array.from(
                            new Set([
                                ...oldLabelIds.filter((id: string) => id !== fromLabelId),
                                "TRASH",
                            ]),
                        )
                        : args.op === "spam"
                            ? Array.from(
                                new Set([
                                    ...oldLabelIds.filter((id: string) => id !== fromLabelId),
                                    "SPAM",
                                ]),
                            )
                            : Array.from(
                                new Set([
                                    ...oldLabelIds.filter((id: string) => id !== fromLabelId),
                                    toLabelId!,
                                ]),
                            );

            await tx
                .update(messages)
                .set({
                    mailboxId: toMailbox.id,
                    metaData: {
                        ...currentMeta,
                        gmail: {
                            ...currentGmailMeta,
                            labelIds: nextLabelIds,
                        },
                    },
                    updatedAt: new Date(),
                } as any)
                .where(eq(messages.id, row.id));
        }

        if (syncedRows.length) {
            await tx
                .update(mailboxThreads)
                .set({
                    mailboxId: toMailbox.id,
                    mailboxSlug: toMailbox.slug ?? args.op,
                    updatedAt: new Date(),
                })
                .where(
                    and(
                        eq(mailboxThreads.threadId, args.threadId),
                        eq(mailboxThreads.mailboxId, args.mailboxId),
                    ),
                );
        } else if (staleIds.size) {
            // Every message we tried to act on was already gone on Gmail's
            // side and got cleaned up locally above — drop the now-orphaned
            // thread entry from the source mailbox so it stops lingering in
            // the UI.
            await tx
                .delete(mailboxThreads)
                .where(
                    and(
                        eq(mailboxThreads.threadId, args.threadId),
                        eq(mailboxThreads.mailboxId, args.mailboxId),
                    ),
                );
        }
    });

    if (failures.length) {
        throw new Error(
            `Failed to ${args.op} ${failures.length} Gmail message(s): ${failures.join(", ")}`,
        );
    }

    return {
        moved: syncedRows.length,
        fromMailboxId: args.mailboxId,
        toMailboxId: toMailbox.id,
        op: args.op,
    };
}
