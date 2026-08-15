"use server";

import { pushSubscriptions } from "@db";
import { eq } from "drizzle-orm";
import { rlsClient } from "@/lib/actions/clients";

export async function subscribeToPush(subscription: {
	endpoint: string;
	keys: { p256dh: string; auth: string };
	userAgent?: string;
}) {
	const rls = await rlsClient();

	await rls((tx) =>
		tx
			.insert(pushSubscriptions)
			.values({
				endpoint: subscription.endpoint,
				p256dh: subscription.keys.p256dh,
				auth: subscription.keys.auth,
				userAgent: subscription.userAgent ?? null,
			})
			.onConflictDoUpdate({
				target: pushSubscriptions.endpoint,
				set: {
					p256dh: subscription.keys.p256dh,
					auth: subscription.keys.auth,
				},
			}),
	);

	return { success: true };
}

export async function unsubscribeFromPush(endpoint: string) {
	const rls = await rlsClient();

	await rls((tx) =>
		tx.delete(pushSubscriptions).where(eq(pushSubscriptions.endpoint, endpoint)),
	);

	return { success: true };
}
