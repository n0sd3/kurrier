"use server";

import { db, pushSubscriptions } from "@db";
import { and, eq } from "drizzle-orm";
import { isSignedIn } from "@/lib/actions/auth";
import { getWorkspaceId, rlsClient, rlsClientForWorkspace } from "@/lib/actions/clients";

export async function subscribeToPush(subscription: {
	endpoint: string;
	keys: { p256dh: string; auth: string };
	userAgent?: string;
}) {
	const user = await isSignedIn();
	if (!user?.id) throw new Error("Not authenticated");
	const workspaceId = await getWorkspaceId();

	// Basic defense-in-depth: reject anything that isn't a well-formed https
	// URL before it can be stored and later handed to webpush.sendNotification.
	let endpointUrl: URL;
	try {
		endpointUrl = new URL(subscription.endpoint);
	} catch {
		throw new Error("Invalid push subscription endpoint");
	}
	if (endpointUrl.protocol !== "https:") {
		throw new Error("Invalid push subscription endpoint");
	}

	// Confirms the caller is actually a member of workspaceId (throws
	// otherwise). We don't use the rls-scoped client this returns for the
	// write below — see the comment on the upsert for why.
	await rlsClientForWorkspace(workspaceId);

	// `endpoint` is unique per (browser profile, origin), NOT per account —
	// browsers hand back the same endpoint on re-subscribe regardless of who
	// is signed in. On a shared browser, or for a user who belongs to more
	// than one workspace, the row that already exists for this endpoint can
	// belong to a different owner/workspace than the current session. A plain
	// rls-scoped UPDATE can't reassign it: Postgres evaluates the UPDATE
	// policy's USING clause against the PRE-EXISTING row before the new
	// values are applied (per the RLS docs, this happens even if the new
	// values would satisfy WITH CHECK), so if the stored workspace_id differs
	// from the session's active workspace, the write is rejected outright
	// rather than merely leaving stale data. We therefore perform this
	// specific write with the RLS-bypassing admin client, having already
	// authenticated the user and verified their workspace membership above,
	// and explicitly reassign ownerId/workspaceId to the current session so
	// re-subscribing the same endpoint under a different account/workspace
	// correctly transfers ownership instead of erroring or leaking data to
	// the previous owner.
	await db
		.insert(pushSubscriptions)
		.values({
			ownerId: user.id,
			workspaceId,
			endpoint: subscription.endpoint,
			p256dh: subscription.keys.p256dh,
			auth: subscription.keys.auth,
			userAgent: subscription.userAgent ?? null,
		})
		.onConflictDoUpdate({
			target: pushSubscriptions.endpoint,
			set: {
				ownerId: user.id,
				workspaceId,
				p256dh: subscription.keys.p256dh,
				auth: subscription.keys.auth,
				userAgent: subscription.userAgent ?? null,
			},
		});

	return { success: true };
}

export async function unsubscribeFromPush(endpoint: string) {
	const user = await isSignedIn();
	if (!user?.id) throw new Error("Not authenticated");
	const rls = await rlsClient();

	await rls((tx) =>
		tx
			.delete(pushSubscriptions)
			.where(
				and(
					eq(pushSubscriptions.endpoint, endpoint),
					eq(pushSubscriptions.ownerId, user.id),
				),
			),
	);

	return { success: true };
}
