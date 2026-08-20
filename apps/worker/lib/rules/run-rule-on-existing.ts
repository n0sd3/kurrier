import {
	db,
	identities,
	mailboxes,
	mailRuleActions,
	mailRules,
	messages,
	threads,
} from "@db";
import { and, asc, desc, eq, inArray, notInArray, sql } from "drizzle-orm";
import type { MailRuleMatchV1 } from "@schema";
import { applyRuleActions, evalMatch } from "./rules-processor";

// Rules normally only ever see mail as it arrives, so a freshly created rule
// leaves everything already in the mailbox untouched. This is the "Run now"
// path: the same matcher and the same actions, replayed over stored messages.

// Folders a retroactive run must not touch. Trash is already the end state for
// the common `trash` action, and rewriting drafts/outbox/sent from a rule the
// user wrote for incoming mail would be a nasty surprise.
const SKIPPED_MAILBOX_KINDS = ["trash", "drafts", "outbox", "sent"] as const;

const BATCH_SIZE = 200;
const MAX_MESSAGES = 5000;

export async function runRuleOnExistingMessages({ ruleId }: { ruleId: string }) {
	const [rule] = await db.select().from(mailRules).where(eq(mailRules.id, ruleId));
	if (!rule) {
		console.warn("[RULES] Run-now requested for unknown rule:", ruleId);
		return { scanned: 0, matched: 0 };
	}

	const match = rule.match as MailRuleMatchV1;
	if (!match?.conditions?.length) {
		console.warn("[RULES] Run-now skipped, rule has no conditions:", ruleId);
		return { scanned: 0, matched: 0 };
	}

	const actions = await db
		.select()
		.from(mailRuleActions)
		.where(eq(mailRuleActions.ruleId, rule.id))
		.orderBy(asc(mailRuleActions.order));

	if (!actions.length) {
		console.warn("[RULES] Run-now skipped, rule has no actions:", ruleId);
		return { scanned: 0, matched: 0 };
	}

	const [identity] = await db
		.select()
		.from(identities)
		.where(eq(identities.id, rule.identityId));
	if (!identity) return { scanned: 0, matched: 0 };

	const targetMailboxes = await db
		.select({ id: mailboxes.id, ownerId: mailboxes.ownerId })
		.from(mailboxes)
		.where(
			and(
				eq(mailboxes.identityId, identity.id),
				notInArray(mailboxes.kind, [...SKIPPED_MAILBOX_KINDS]),
			),
		);

	if (!targetMailboxes.length) return { scanned: 0, matched: 0 };

	const mailboxById = new Map(targetMailboxes.map((m) => [m.id, m]));
	const mailboxIds = targetMailboxes.map((m) => m.id);

	// Every action operates on the whole thread, so a thread only needs one pass
	// even when several of its messages match.
	const handledThreadIds = new Set<string>();
	let scanned = 0;
	let matched = 0;
	// Keyset, not OFFSET: the `trash` action moves messages out of the mailboxes
	// we are paging over, which would shift an offset window past unread rows.
	// The cursor is carried as an ISO string with explicit casts: bound as a
	// bare param it reaches Postgres as text ("operator does not exist:
	// timestamp with time zone < text"), and a JS Date serialises to a format
	// timestamptz refuses to parse.
	let cursor: { createdAt: string; id: string } | null = null;

	while (scanned < MAX_MESSAGES) {
		const batch: any[] = await db
			.select()
			.from(messages)
			.where(
				cursor
					? and(
							inArray(messages.mailboxId, mailboxIds),
							sql`(${messages.createdAt}, ${messages.id}) < (${cursor.createdAt}::timestamptz, ${cursor.id}::uuid)`,
						)
					: inArray(messages.mailboxId, mailboxIds),
			)
			.orderBy(desc(messages.createdAt), desc(messages.id))
			.limit(BATCH_SIZE);

		if (!batch.length) break;

		const last = batch[batch.length - 1];
		cursor = {
			createdAt: new Date(last.createdAt).toISOString(),
			id: last.id,
		};

		for (const message of batch) {
			scanned++;
			if (handledThreadIds.has(message.threadId)) continue;
			if (!evalMatch(message, match)) continue;

			const mailbox = mailboxById.get(message.mailboxId);
			if (!mailbox) continue;

			const [thread] = await db
				.select()
				.from(threads)
				.where(eq(threads.id, message.threadId));
			if (!thread) continue;

			handledThreadIds.add(thread.id);
			matched++;

			await applyRuleActions(actions, { message, thread, mailbox, identity });
		}

		if (batch.length < BATCH_SIZE) break;
	}

	if (scanned >= MAX_MESSAGES) {
		console.warn(
			`[RULES] Run-now for rule ${ruleId} hit the ${MAX_MESSAGES} message cap; run it again to continue.`,
		);
	}

	console.info(
		`[RULES] Run-now for rule ${ruleId} (${rule.name}): scanned ${scanned}, matched ${matched} threads`,
	);

	return { scanned, matched };
}
