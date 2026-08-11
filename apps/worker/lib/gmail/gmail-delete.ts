import { and, eq, inArray, sql } from "drizzle-orm";
import { db, mailboxes, messages } from "@db";
import { gmailClientForIdentity } from "@providers";

type DeleteGmailMailArgs = {
	mailboxId: string;
	threadId?: string | string[];
	emptyAll?: boolean;
};

export async function deleteGmailMail(args: DeleteGmailMailArgs) {
	const { mailboxId, emptyAll } = args;
	if (!mailboxId) return;

	const threadIds = Array.isArray(args.threadId)
		? args.threadId.filter(Boolean)
		: args.threadId
			? [args.threadId]
			: [];

	if (!emptyAll && !threadIds.length) return;

	const [mailbox] = await db
		.select()
		.from(mailboxes)
		.where(eq(mailboxes.id, mailboxId))
		.limit(1);

	if (!mailbox) return;

	const { gmail } = await gmailClientForIdentity(mailbox.identityId);

	const rows = await db
		.select({
			id: messages.id,
			gmailMessageId: sql<string | null>`
				${messages.metaData}->'gmail'->>'messageId'
			`,
		})
		.from(messages)
		.where(
			emptyAll
				? eq(messages.mailboxId, mailboxId)
				: and(
						eq(messages.mailboxId, mailboxId),
						inArray(messages.threadId, threadIds),
					),
		);

	const failures: string[] = [];

	for (const row of rows) {
		if (!row.gmailMessageId) continue;

		try {
			await gmail.users.messages.delete({
				userId: "me",
				id: row.gmailMessageId,
			});
		} catch (err: any) {
			if (err?.code === 404) continue;

			console.error(
				"[deleteGmailMail] failed to delete message",
				row.gmailMessageId,
				err,
			);
			failures.push(row.gmailMessageId);
		}
	}

	if (failures.length) {
		throw new Error(
			`Failed to permanently delete ${failures.length} Gmail message(s): ${failures.join(", ")}`,
		);
	}
}
