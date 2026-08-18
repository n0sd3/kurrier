/** Consecutive `error` syncs before a transient failure is worth a push. */
export const ERROR_ALERT_THRESHOLD = 3;

/** How long a broken account stays quiet before it nags again. */
export const REMINDER_INTERVAL_MS = 24 * 60 * 60 * 1000;

export type AlertableAccount = {
	status: "connected" | "revoked" | "error";
	errorCount: number;
	alertedStatus: "connected" | "revoked" | "error" | null;
	lastAlertedAt: Date | null;
};

export function shouldAlert(account: AlertableAccount, now: Date) {
	if (account.status === "connected") return false;

	if (
		account.status === "error" &&
		account.errorCount < ERROR_ALERT_THRESHOLD
	) {
		return false;
	}

	// A status we haven't announced yet — including error escalating to
	// revoked — is news, so it skips the reminder window.
	if (account.alertedStatus !== account.status) return true;

	if (!account.lastAlertedAt) return true;

	return (
		now.getTime() - account.lastAlertedAt.getTime() >= REMINDER_INTERVAL_MS
	);
}
