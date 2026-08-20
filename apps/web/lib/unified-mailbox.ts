import type { IdentityEntity, MailboxEntity, MailboxSyncEntity } from "@db";

export const UNIFIED_MAILBOX_KINDS = [
	"inbox",
	"sent",
	"spam",
	"trash",
] as const;

export type UnifiedMailboxKind = (typeof UNIFIED_MAILBOX_KINDS)[number];

export function isUnifiedMailboxKind(
	value: string,
): value is UnifiedMailboxKind {
	return (UNIFIED_MAILBOX_KINDS as readonly string[]).includes(value);
}

/**
 * A thread row knows which mailbox it belongs to, but not which account that
 * mailbox is on, nor whether that account propagates changes over IMAP. In a
 * unified list every row can answer those differently, so each row resolves its
 * own context instead of sharing one.
 */
export type MailboxContext = {
	mailbox: MailboxEntity;
	identity: IdentityEntity;
	sync: MailboxSyncEntity | null;
};

export type MailboxContextMap = Record<string, MailboxContext>;

export function resolveRowMailbox(
	mailboxById: MailboxContextMap,
	row: { mailboxId: string },
): MailboxContext | null {
	return mailboxById[row.mailboxId] ?? null;
}

/**
 * Selection state is keyed by threadId alone, but every action needs the
 * mailboxId that owns the thread. Grouping here lets the caller fire one
 * action call per account for a selection that spans several.
 */
export function groupSelectionByMailbox(
	rows: ReadonlyArray<{ threadId: string; mailboxId: string }>,
	selectedIds: ReadonlySet<string>,
): Array<{ mailboxId: string; threadIds: string[] }> {
	const byMailbox = new Map<string, string[]>();

	for (const row of rows) {
		if (!selectedIds.has(row.threadId)) continue;

		const bucket = byMailbox.get(row.mailboxId);
		if (bucket) bucket.push(row.threadId);
		else byMailbox.set(row.mailboxId, [row.threadId]);
	}

	return [...byMailbox].map(([mailboxId, threadIds]) => ({
		mailboxId,
		threadIds,
	}));
}

export function sumUnreadByKind(
	mailboxes: ReadonlyArray<{ id: string; kind: string }>,
	unreadCounts: ReadonlyMap<
		string,
		{ unreadThreads: number; unreadTotal: number }
	>,
): Record<string, number> {
	const totals: Record<string, number> = {};

	for (const mailbox of mailboxes) {
		const counts = unreadCounts.get(mailbox.id);
		if (!counts) continue;
		totals[mailbox.kind] = (totals[mailbox.kind] ?? 0) + counts.unreadTotal;
	}

	return totals;
}
