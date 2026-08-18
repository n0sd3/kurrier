import { and, eq, ne } from "drizzle-orm";
import { db, googleAccounts, workspaces } from "@db";
import { deliverPush } from "../push/deliver-push";
import { buildAccountAlert } from "./build-account-alert";
import { shouldAlert } from "./should-alert";

/**
 * Push an alert for every Google account whose connection is broken, then
 * record that we did so — `shouldAlert` uses that record to stay quiet until
 * the state changes or the reminder window elapses.
 */
export async function runAccountHealthTick(now = new Date()) {
	const broken = await db
		.select({
			id: googleAccounts.id,
			ownerId: googleAccounts.ownerId,
			email: googleAccounts.email,
			status: googleAccounts.status,
			errorCount: googleAccounts.errorCount,
			alertedStatus: googleAccounts.alertedStatus,
			lastAlertedAt: googleAccounts.lastAlertedAt,
			workspacePublicId: workspaces.publicId,
		})
		.from(googleAccounts)
		.innerJoin(workspaces, eq(googleAccounts.workspaceId, workspaces.id))
		.where(ne(googleAccounts.status, "connected"));

	for (const account of broken) {
		if (!shouldAlert(account, now)) continue;
		if (account.status === "connected") continue;

		try {
			await deliverPush(account.ownerId, [
				buildAccountAlert({
					status: account.status,
					email: account.email,
					workspacePublicId: account.workspacePublicId,
				}),
			]);
		} catch (err: any) {
			console.error(
				`[accounts] Failed to alert on google account ${account.id}:`,
				err?.message ?? err,
			);
			continue;
		}

		// Only stamp after a successful send, so a failed delivery is retried
		// on the next tick instead of being silently swallowed.
		await db
			.update(googleAccounts)
			.set({ alertedStatus: account.status, lastAlertedAt: now })
			.where(
				and(
					eq(googleAccounts.id, account.id),
					eq(googleAccounts.status, account.status),
				),
			);
	}
}
