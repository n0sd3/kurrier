import { kvGet, kvSet } from "@common";

// Rules run before push notifications for the same message (both are queued on
// common-worker, rules first — see flushBatches in lib/message-payload-parser.ts),
// but a rule action like `trash` only *enqueues* the mailbox move. By the time
// sendPushNotifications looks at the message it is still sitting in the inbox,
// so the user gets pinged about mail a rule is about to take away.
//
// processRules therefore leaves a marker the moment it decides a message is
// silenced, and the push job honours it. The TTL only needs to outlive the gap
// between the two jobs; a stale marker would at worst drop one notification.
const TTL_SECONDS = 15 * 60;

const key = (messageId: string) => `push-suppressed:${messageId}`;

export async function markPushSuppressed(messageId: string) {
	await kvSet(key(messageId), "1", TTL_SECONDS);
}

export async function isPushSuppressed(messageId: string) {
	return (await kvGet(key(messageId))) !== null;
}
