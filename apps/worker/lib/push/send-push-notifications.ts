import webpush from "web-push";
import { eq, inArray } from "drizzle-orm";
import { db, identities, mailboxes, pushSubscriptions, workspaces } from "@db";
import { getVapidConfig } from "./vapid-config";
import { buildPushPayloads, type PushMessageInfo } from "./build-push-payloads";

export type PushableMessage = PushMessageInfo & { mailboxId: string };

export async function sendPushNotifications({
	ownerId,
	messages,
}: {
	ownerId: string;
	messages: PushableMessage[];
}) {
	const vapid = getVapidConfig();
	if (!vapid || messages.length === 0) return;

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

	const subs = await db
		.select()
		.from(pushSubscriptions)
		.where(eq(pushSubscriptions.ownerId, ownerId));
	if (subs.length === 0) return;

	const payloads = buildPushPayloads(inboxMessages);

	// A grouped payload has no threadId, so it can't carry per-mailbox
	// routing info — fall back to the first message's mailbox for the link.
	const linkMailbox = mailboxById.get(inboxMessages[0].mailboxId)!;

	webpush.setVapidDetails(vapid.subject, vapid.publicKey, vapid.privateKey);

	for (const sub of subs) {
		for (const payload of payloads) {
			const mailbox = payload.threadId
				? mailboxById.get(
					inboxMessages.find((m) => m.threadId === payload.threadId)!.mailboxId,
				)!
				: linkMailbox;

			const url = payload.threadId
				? `/w/${mailbox.workspacePublicId}/dashboard/mail/${mailbox.identityPublicId}/${mailbox.slug}/threads/${payload.threadId}`
				: `/w/${mailbox.workspacePublicId}/dashboard/mail`;

			try {
				await webpush.sendNotification(
					{ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
					JSON.stringify({ title: payload.title, body: payload.body, url }),
				);
			} catch (err: any) {
				if (err?.statusCode === 404 || err?.statusCode === 410) {
					await db.delete(pushSubscriptions).where(eq(pushSubscriptions.id, sub.id));
				} else {
					console.error(`[push] Error sending to ${sub.endpoint}:`, err?.message ?? err);
				}
			}
		}
	}
}
