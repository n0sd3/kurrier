import postgres from "postgres";
import { getServerEnv } from "@schema";

declare global {
	var _pgListen: ReturnType<typeof postgres> | undefined;
}

export const MAILBOX_THREADS_CHANNEL = "kurrier_mailbox_threads";

export type MailboxThreadsNotification = {
	ownerId: string;
	mailboxId: string;
	identityPublicId: string;
	op: "INSERT" | "UPDATE" | "DELETE";
};

// A LISTEN connection is long-lived and cannot be shared with query traffic, so
// this is a separate client from the pooled ones in @db. postgres.js keeps a
// single connection behind all listeners on one instance, so every open tab
// adds a callback here rather than another connection — hence the global, which
// also survives dev hot reloads the way init-db does.
export function getListenClient() {
	if (!global._pgListen) {
		const { DATABASE_URL } = getServerEnv();
		global._pgListen = postgres(String(DATABASE_URL), {
			prepare: false,
			max: 1,
		});
	}
	return global._pgListen;
}
