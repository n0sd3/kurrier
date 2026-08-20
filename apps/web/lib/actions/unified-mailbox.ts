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
