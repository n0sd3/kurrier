import webpush from "web-push";
import { eq } from "drizzle-orm";
import { db, pushSubscriptions } from "@db";
import { getVapidConfig } from "./vapid-config";

export type PushPayload = {
	title: string;
	body: string;
	url: string;
};

/**
 * Fan a payload out to every push subscription an owner has, dropping the
 * ones the push service reports as gone.
 */
export async function deliverPush(ownerId: string, payloads: PushPayload[]) {
	const vapid = getVapidConfig();
	if (!vapid) {
		console.warn(
			"[push] Skipping push delivery: VAPID is not configured (set VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY / VAPID_SUBJECT).",
		);
		return;
	}
	if (payloads.length === 0) return;

	const subs = await db
		.select()
		.from(pushSubscriptions)
		.where(eq(pushSubscriptions.ownerId, ownerId));
	if (subs.length === 0) return;

	webpush.setVapidDetails(vapid.subject, vapid.publicKey, vapid.privateKey);

	for (const sub of subs) {
		for (const payload of payloads) {
			try {
				await webpush.sendNotification(
					{
						endpoint: sub.endpoint,
						keys: { p256dh: sub.p256dh, auth: sub.auth },
					},
					JSON.stringify(payload),
				);
			} catch (err: any) {
				if (err?.statusCode === 404 || err?.statusCode === 410) {
					await db
						.delete(pushSubscriptions)
						.where(eq(pushSubscriptions.id, sub.id));
				} else {
					console.error(
						`[push] Error sending to subscription ${sub.id}:`,
						err?.message ?? err,
					);
				}
			}
		}
	}
}
