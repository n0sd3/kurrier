"use server";

import { cache } from "react";
import { rlsClient } from "@/lib/actions/clients";
import { identities, mailboxes, mailboxSync, mailboxThreads } from "@db";
import { and, count, desc, eq, isNull, lte, or, sql } from "drizzle-orm";
import { PAGE_SIZE } from "@common/mail-client";
import type {
	MailboxContextMap,
	UnifiedMailboxKind,
} from "@/lib/unified-mailbox";
import type { SearchThreadsResponse } from "@schema";
import { searchMessages } from "@/lib/search/search-messages";

// Mirrors the ordering fetchMailboxThreads uses, so a unified list and a
// per-account list agree on what "most recent" means.
const effectiveActivityAt = sql`
	COALESCE(${mailboxThreads.unsnoozedAt}, ${mailboxThreads.lastActivityAt})
`;

function notSnoozed(now: Date) {
	return or(
		isNull(mailboxThreads.snoozedUntil),
		lte(mailboxThreads.snoozedUntil, now),
	);
}

export const fetchUnifiedThreads = async (
	kind: UnifiedMailboxKind,
	page: number,
) => {
	const rls = await rlsClient();
	const now = new Date();
	const safePage = page && page > 0 ? page : 1;

	// Joined on kind rather than filtered on mailboxSlug: slugs come from the
	// provider's folder names, so one account's Spam is "junk" and another's
	// is "spam". A slug filter would drop accounts without any error.
	const rows = await rls((tx) =>
		tx
			.select({ thread: mailboxThreads })
			.from(mailboxThreads)
			.innerJoin(mailboxes, eq(mailboxThreads.mailboxId, mailboxes.id))
			.where(and(eq(mailboxes.kind, kind), notSnoozed(now)))
			.orderBy(
				desc(effectiveActivityAt),
				desc(mailboxThreads.lastActivityAt),
				desc(mailboxThreads.threadId),
			)
			.offset((safePage - 1) * PAGE_SIZE)
			.limit(PAGE_SIZE),
	);

	return rows.map((r) => r.thread);
};

export const fetchUnifiedMailboxContext = cache(
	async (kind: UnifiedMailboxKind): Promise<MailboxContextMap> => {
		const rls = await rlsClient();

		const rows = await rls((tx) =>
			tx
				.select({
					mailbox: mailboxes,
					identity: identities,
					sync: mailboxSync,
				})
				.from(mailboxes)
				.innerJoin(identities, eq(mailboxes.identityId, identities.id))
				.leftJoin(mailboxSync, eq(mailboxSync.mailboxId, mailboxes.id))
				.where(and(eq(mailboxes.kind, kind), eq(identities.kind, "email"))),
		);

		const mailboxById: MailboxContextMap = {};

		for (const row of rows) {
			mailboxById[row.mailbox.id] = {
				mailbox: row.mailbox,
				identity: row.identity,
				sync: row.sync ?? null,
			};
		}

		return mailboxById;
	},
);

export const initUnifiedSearch = async (
	query: string,
	workspacePublicId: string,
	kind: UnifiedMailboxKind,
	hasAttachment: boolean,
	onlyUnread: boolean,
	starred: boolean,
	page: number,
): Promise<SearchThreadsResponse> => {
	const q = query.trim();
	if (!q) return { items: [], totalThreads: 0, totalMessages: 0 };

	// The indexed document has no "kind" field, only a provider-derived slug.
	// Resolve the concrete mailbox ids for this kind and filter on those, so
	// the search covers exactly the folders the unified list shows.
	const mailboxById = await fetchUnifiedMailboxContext(kind);
	const mailboxIds = Object.keys(mailboxById);
	if (!mailboxIds.length) return { items: [], totalThreads: 0, totalMessages: 0 };

	const filters = [
		`workspacePublicId:=${JSON.stringify(workspacePublicId)}`,
		`mailboxId:=[${mailboxIds.map((id) => JSON.stringify(id)).join(",")}]`,
	];

	if (hasAttachment) filters.push("hasAttachment:=1");
	if (onlyUnread) filters.push("unread:=1");
	if (starred) filters.push("starred:=1");

	return searchMessages(filters, q, page);
};

export const fetchThreadsByMailboxPairs = async (
	pairs: Array<{ threadId: string; mailboxId: string }>,
) => {
	if (!pairs.length) return [];

	const rls = await rlsClient();

	const rows = await rls((tx) =>
		tx
			.select()
			.from(mailboxThreads)
			.where(
				or(
					...pairs.map((p) =>
						and(
							eq(mailboxThreads.threadId, p.threadId),
							eq(mailboxThreads.mailboxId, p.mailboxId),
						),
					),
				),
			),
	);

	// Preserve the relevance order the search engine returned.
	const rank = new Map(pairs.map((p, i) => [`${p.threadId}:${p.mailboxId}`, i]));
	rows.sort(
		(a, b) =>
			(rank.get(`${a.threadId}:${a.mailboxId}`) ?? Number.MAX_SAFE_INTEGER) -
			(rank.get(`${b.threadId}:${b.mailboxId}`) ?? Number.MAX_SAFE_INTEGER),
	);

	return rows;
};

export const fetchUnifiedThreadCount = cache(
	async (kind: UnifiedMailboxKind) => {
		const rls = await rlsClient();
		const now = new Date();

		const [row] = await rls((tx) =>
			tx
				.select({ total: count() })
				.from(mailboxThreads)
				.innerJoin(mailboxes, eq(mailboxThreads.mailboxId, mailboxes.id))
				.where(and(eq(mailboxes.kind, kind), notSnoozed(now))),
		);

		return Number(row?.total ?? 0);
	},
);
