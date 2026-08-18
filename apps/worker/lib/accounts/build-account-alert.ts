import type { PushPayload } from "../push/deliver-push";

export type AccountAlertInfo = {
	status: "revoked" | "error";
	email: string;
	workspacePublicId: string;
};

export function buildAccountAlert(account: AccountAlertInfo): PushPayload {
	const url = `/w/${account.workspacePublicId}/dashboard/platform/providers`;

	if (account.status === "revoked") {
		return {
			title: "Google account disconnected",
			body: `Kurrier lost access to ${account.email}. Reconnect it to keep sending and receiving mail.`,
			url,
		};
	}

	return {
		title: "Google account is having trouble",
		body: `Kurrier can't sync ${account.email} right now. Open providers to check the connection.`,
		url,
	};
}
