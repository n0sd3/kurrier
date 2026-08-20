import { eq, inArray } from "drizzle-orm";
import { db, identities, mailboxes, workspaces } from "@db";
import { deliverPush } from "./deliver-push";
import { buildPushPayloads, type PushMessageInfo } from "./build-push-payloads";
import { isPushSuppressed } from "../rules/push-suppression";

export type PushableMessage = PushMessageInfo & {
	mailboxId: string;
	messageId?: string;
};

export async function sendPushNotifications({
	ownerId,
	messages,
}: {
	ownerId: string;
	messages: PushableMessage[];
}) {
	if (messages.length === 0) return;

	const mailboxIds = [...new Set(messages.map((m) => m.mailboxId))];
	const mailboxRows = await db
		.select({
			id: mailboxes.id,
			kind: mailboxes.kind,
			slug: mailboxes.slug,
			identityPublicId: identities.publicId,
			workspacePublicId: workspaces.publicId,
		})
		.from(mailboxes)
		.innerJoin(identities, eq(mailboxes.identityId, identities.id))
		.innerJoin(workspaces, eq(mailboxes.workspaceId, workspaces.id))
		.where(inArray(mailboxes.id, mailboxIds));

	const mailboxById = new Map(mailboxRows.map((row) => [row.id, row]));

	const candidates = messages.filter(
		(m) => mailboxById.get(m.mailboxId)?.kind === "inbox",
	);

	// A rule that trashes or reads a message has already run by the time this
	// job starts, but its mailbox move is still in flight — so ask the rules
	// processor what it decided rather than looking at where the message sits.
	const suppressed = await Promise.all(
		candidates.map((m) => (m.messageId ? isPushSuppressed(m.messageId) : false)),
	);
	const inboxMessages = candidates.filter((_, i) => !suppressed[i]);

	if (inboxMessages.length === 0) return;

	const payloads = buildPushPayloads(inboxMessages);

	// A grouped payload has no threadId, so it can't carry per-mailbox
	// routing info — fall back to the first message's mailbox for the link.
	const linkMailbox = mailboxById.get(inboxMessages[0].mailboxId)!;

	await deliverPush(
		ownerId,
		payloads.map((payload) => {
			const mailbox = payload.threadId
				? mailboxById.get(
						inboxMessages.find((m) => m.threadId === payload.threadId)!
							.mailboxId,
					)!
				: linkMailbox;

			const url = payload.threadId
				? `/w/${mailbox.workspacePublicId}/dashboard/mail/${mailbox.identityPublicId}/${mailbox.slug || mailbox.kind}/threads/${payload.threadId}`
				: `/w/${mailbox.workspacePublicId}/dashboard/mail`;

			return { title: payload.title, body: payload.body, url };
		}),
	);
}
