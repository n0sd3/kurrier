import { eq, inArray } from "drizzle-orm";
import { db, identities, mailboxes, workspaces } from "@db";
import { deliverPush } from "./deliver-push";
import { buildPushPayloads, type PushMessageInfo } from "./build-push-payloads";

export type PushableMessage = PushMessageInfo & { mailboxId: string };

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

	const inboxMessages = messages.filter(
		(m) => mailboxById.get(m.mailboxId)?.kind === "inbox",
	);
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
