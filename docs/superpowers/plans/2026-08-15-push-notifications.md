# Push Notifications for New Email Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Send a browser push notification when a new email lands in a user's
Inbox (live sync only, not backfill), with click-to-open-thread behavior.

**Architecture:** A new `pushSubscriptions` table stores one row per
browser/device. `apps/web` server actions handle subscribe/unsubscribe. A new
`pushBuffer` in the existing message-ingestion pipeline
(`apps/worker/lib/message-payload-parser.ts`) mirrors the existing
`webhookBuffer`, gated the same way (`mode === "live"`), and flushes into
`push:notify` BullMQ jobs grouped by owner. The job handler filters to Inbox
messages, resolves each subscriber's deep link, and sends via the `web-push`
library, pruning expired subscriptions on 404/410.

**Tech Stack:** Next.js (apps/web) server actions, Nitro/BullMQ (apps/worker),
Drizzle ORM/Postgres, `web-push` npm package, vanilla Service Worker API
(`apps/web/public/sw.js`), Node's built-in `node:test` runner.

**Spec:** [docs/superpowers/specs/2026-08-15-push-notifications-design.md](../specs/2026-08-15-push-notifications-design.md)

## Global Constraints

- Push only fires for `mode === "live"` messages (never during backfill) —
  `apps/worker/lib/message-payload-parser.ts` opts already carry this flag.
- Push only fires for messages whose mailbox has `kind === "inbox"`.
- One global on/off switch per user, covering every connected identity — no
  per-identity toggle, no `enabled` column (a stored subscription row **is**
  the opt-in).
- Batch limit: ≤3 messages in the same flush → one push per message; 4+ →
  collapse into a single "N new emails" notification.
- Single click target: a single-message push opens
  `/w/{workspacePublicId}/dashboard/mail/{identityPublicId}/{mailboxSlug}/threads/{threadId}`;
  a grouped push opens `/w/{workspacePublicId}/dashboard/mail`.
- New table follows the existing `workspaceCrudPolicies` RLS convention (see
  spec Amendments) even though the feature itself is user-scoped.

---

### Task 1: Database schema — `push_subscriptions` table

**Files:**
- Modify: `packages/db/src/drizzle/schema.ts` (add table, after `webhooks` at line 940)
- Modify: `packages/db/src/drizzle/drizzle-types.ts` (add entity types, after line 82)
- Generated: `db/migrations/00N_migration.sql` (via drizzle-kit, do not hand-write)

**Interfaces:**
- Produces: `pushSubscriptions` table export (columns: `id`, `ownerId`,
  `workspaceId`, `endpoint`, `p256dh`, `auth`, `userAgent`, `createdAt`);
  `PushSubscriptionSelectEntity`, `PushSubscriptionInsertEntity` types. Later
  tasks import these from `@db`.

- [ ] **Step 1: Add the table definition**

In `packages/db/src/drizzle/schema.ts`, immediately after the `webhooks`
table closes (after line 940, before `export const labels = pgTable(`), add:

```ts
export const pushSubscriptions = pgTable(
	"push_subscriptions",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		ownerId: uuid("owner_id")
			.references(() => users.id, { onDelete: "cascade" })
			.notNull()
			.default(authUid),

		endpoint: text("endpoint").notNull(),
		p256dh: text("p256dh").notNull(),
		auth: text("auth").notNull(),
		userAgent: text("user_agent"),

		workspaceId: uuid("workspace_id")
			.references(() => workspaces.id)
			.notNull()
			.default(authWorkspaceId),

		createdAt: timestamp("created_at", { withTimezone: true })
			.defaultNow()
			.notNull(),
	},
	(t) => [
		uniqueIndex("uniq_push_subscription_endpoint").on(t.endpoint),
		index("ix_push_subscriptions_owner").on(t.ownerId),
		...workspaceCrudPolicies(t, "push_subscriptions"),
	],
).enableRLS();
```

- [ ] **Step 2: Add entity types**

In `packages/db/src/drizzle/drizzle-types.ts`, add `pushSubscriptions` to the
import list at the top (line 21, alongside `mailSubscriptions, users,
workspaces`), then add near the `WebhookSelectEntity`/`WebhookInsertEntity`
pair (after line 82):

```ts
export type PushSubscriptionSelectEntity = typeof pushSubscriptions.$inferSelect;
export type PushSubscriptionInsertEntity = typeof pushSubscriptions.$inferInsert;
```

- [ ] **Step 3: Generate the migration**

Run: `pnpm --filter @kurrier/db db:generate`
Expected: a new `db/migrations/00N_migration.sql` file is created containing
`CREATE TABLE "push_subscriptions" (...)`, plus RLS policy statements. Inspect
it to confirm it only adds this table (no unrelated diffs).

- [ ] **Step 4: Apply the migration to the local dev database**

Run: `pnpm run app:migrate`
Expected: migration applies cleanly with no errors.

- [ ] **Step 5: Commit**

```bash
git add packages/db/src/drizzle/schema.ts packages/db/src/drizzle/drizzle-types.ts db/migrations/
git commit -m "feat: add push_subscriptions table"
```

---

### Task 2: VAPID configuration and `web-push` dependency

**Files:**
- Modify: `packages/schema/src/types/config.ts` (add optional `VAPID_PUBLIC_KEY` to `ZPublicConfig`)
- Modify: `apps/worker/package.json` (add `web-push` dependency)
- Create: `apps/worker/lib/push/vapid-config.ts`
- Modify: `db/NOTES-INSTALL.md` (document the three env vars — this file is untracked/local-only per repo convention, edit it directly, don't worry about it reaching the public fork)

**Interfaces:**
- Produces: `getVapidConfig(): { publicKey: string; privateKey: string; subject: string } | null`
  — later tasks (Task 4) call this and no-op the whole send path if it returns `null`.

- [ ] **Step 1: Add `web-push` to the worker**

Run: `pnpm --filter @kurrier/worker add web-push` and `pnpm --filter @kurrier/worker add -D @types/web-push`
Expected: `apps/worker/package.json` gains `"web-push"` under `dependencies` and `"@types/web-push"` under `devDependencies`.

- [ ] **Step 2: Add the public VAPID key to the public config**

In `packages/schema/src/types/config.ts`, add to `ZPublicConfig` (after `DOCS_URL` at line 38):

```ts
	VAPID_PUBLIC_KEY: z.string().optional(),
```

This must be `.optional()` — unlike every other field in `ZPublicConfig`,
push notifications are an opt-in feature and installs without VAPID keys
configured must keep booting normally.

- [ ] **Step 3: Write `getVapidConfig()`**

Create `apps/worker/lib/push/vapid-config.ts`:

```ts
export function getVapidConfig(): {
	publicKey: string;
	privateKey: string;
	subject: string;
} | null {
	const publicKey = process.env.VAPID_PUBLIC_KEY;
	const privateKey = process.env.VAPID_PRIVATE_KEY;
	const subject = process.env.VAPID_SUBJECT;

	if (!publicKey || !privateKey || !subject) return null;

	return { publicKey, privateKey, subject };
}
```

This follows the same opt-in, unvalidated `process.env` read as
`isAdminApiRequest` in `apps/worker/lib/api-helpers.ts:152` — these three
vars are deliberately excluded from `ZServerConfig` since they're optional,
not required at boot.

- [ ] **Step 4: Generate a real VAPID keypair for local dev and document it**

Run: `npx web-push generate-vapid-keys`
Expected: prints a public/private key pair. Add all three vars to
`db/NOTES-INSTALL.md` (create a "Push notifications" section) with the
generated local values:

```
VAPID_PUBLIC_KEY=<generated public key>
VAPID_PRIVATE_KEY=<generated private key>
VAPID_SUBJECT=mailto:you@example.com
```

Add the same three keys to whatever local `.env` file `db/local/.env` (or
equivalent) already uses for `apps/worker` and `apps/web` env vars — check
`db/docker-compose.yml` for how existing env vars like `JWT_SECRET` are wired
into the `web` and `worker` services, and add these three the same way.

- [ ] **Step 5: Commit**

```bash
git add packages/schema/src/types/config.ts apps/worker/package.json apps/worker/pnpm-lock.yaml pnpm-lock.yaml apps/worker/lib/push/vapid-config.ts
git commit -m "feat: add VAPID config and web-push dependency"
```

(Do not commit `db/NOTES-INSTALL.md` — it's an untracked local-only file per
this repo's convention; leave it modified in the working tree.)

---

### Task 3: Push payload batching logic (pure, TDD)

**Files:**
- Create: `apps/worker/lib/push/build-push-payloads.ts`
- Test: `apps/worker/lib/push/build-push-payloads.test.ts`

**Interfaces:**
- Consumes: nothing (pure function, no DB/network)
- Produces: `buildPushPayloads(messages: PushMessageInfo[]): PushPayload[]`
  and the `PushMessageInfo`/`PushPayload` types — Task 4 imports and calls
  this directly.

- [ ] **Step 1: Write the failing tests**

Create `apps/worker/lib/push/build-push-payloads.test.ts`:

```ts
import test from "node:test";
import assert from "node:assert/strict";
import { buildPushPayloads } from "./build-push-payloads";

const msg = (overrides: Partial<Parameters<typeof buildPushPayloads>[0][number]> = {}) => ({
	threadId: "thread-1",
	subject: "Hello",
	from: { value: [{ name: "Ada Lovelace", address: "ada@example.com" }], html: "", text: "" },
	...overrides,
});

test("empty input produces no payloads", () => {
	assert.deepEqual(buildPushPayloads([]), []);
});

test("1-3 messages produce one payload per message", () => {
	const messages = [msg({ threadId: "t1" }), msg({ threadId: "t2" }), msg({ threadId: "t3" })];
	const payloads = buildPushPayloads(messages);

	assert.equal(payloads.length, 3);
	assert.deepEqual(payloads[0], { title: "Ada Lovelace", body: "Hello", threadId: "t1" });
});

test("falls back to the sender's address when there's no name", () => {
	const payloads = buildPushPayloads([
		msg({ from: { value: [{ name: "", address: "ada@example.com" }], html: "", text: "" } }),
	]);
	assert.equal(payloads[0].title, "ada@example.com");
});

test("falls back to a generic subject when missing", () => {
	const payloads = buildPushPayloads([msg({ subject: null })]);
	assert.equal(payloads[0].body, "(no subject)");
});

test("4+ messages collapse into a single grouped payload with no threadId", () => {
	const messages = [msg({ threadId: "t1" }), msg({ threadId: "t2" }), msg({ threadId: "t3" }), msg({ threadId: "t4" })];
	const payloads = buildPushPayloads(messages);

	assert.deepEqual(payloads, [{ title: "4 new emails", body: "Tap to open your inbox", threadId: null }]);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx tsx --test apps/worker/lib/push/build-push-payloads.test.ts`
Expected: FAIL — `build-push-payloads.ts` does not exist yet (module not found).

- [ ] **Step 3: Write the implementation**

Create `apps/worker/lib/push/build-push-payloads.ts`:

```ts
type AddressObjectJSON = {
	value: Array<{ address?: string | null; name: string }>;
};

export type PushMessageInfo = {
	threadId: string;
	subject: string | null;
	from: AddressObjectJSON | null;
};

export type PushPayload = {
	title: string;
	body: string;
	threadId: string | null;
};

const GROUP_THRESHOLD = 3;

export function buildPushPayloads(messages: PushMessageInfo[]): PushPayload[] {
	if (messages.length === 0) return [];

	if (messages.length > GROUP_THRESHOLD) {
		return [
			{
				title: `${messages.length} new emails`,
				body: "Tap to open your inbox",
				threadId: null,
			},
		];
	}

	return messages.map((message) => ({
		title: senderLabel(message.from),
		body: message.subject || "(no subject)",
		threadId: message.threadId,
	}));
}

function senderLabel(from: AddressObjectJSON | null): string {
	const first = from?.value?.[0];
	return first?.name || first?.address || "New email";
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx tsx --test apps/worker/lib/push/build-push-payloads.test.ts`
Expected: PASS, all 5 tests green.

- [ ] **Step 5: Commit**

```bash
git add apps/worker/lib/push/build-push-payloads.ts apps/worker/lib/push/build-push-payloads.test.ts
git commit -m "feat: add push notification payload batching logic"
```

---

### Task 4: Worker send pipeline

**Files:**
- Create: `apps/worker/lib/push/send-push-notifications.ts`
- Modify: `apps/worker/server/plugins/common-worker.ts` (add `push:notify` case, after `webhook:message.received` at line 43)

**Interfaces:**
- Consumes: `getVapidConfig()` (Task 2), `buildPushPayloads()` + `PushMessageInfo` (Task 3), `pushSubscriptions` + `mailboxes` + `identities` + `workspaces` tables (Task 1, all from `@db`)
- Produces: `sendPushNotifications({ ownerId, messages }): Promise<void>` —
  Task 5's flush logic enqueues jobs whose handler calls this.

- [ ] **Step 1: Write `sendPushNotifications`**

Create `apps/worker/lib/push/send-push-notifications.ts`:

```ts
import webpush from "web-push";
import { and, eq, inArray } from "drizzle-orm";
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
```

- [ ] **Step 2: Wire up the BullMQ job case**

In `apps/worker/server/plugins/common-worker.ts`, add the import at the top
(alongside `processWebhook` at line 7):

```ts
import { sendPushNotifications } from "../../lib/push/send-push-notifications";
```

Then add a new case after `"webhook:message.received"` (after line 43, before `case "rules:processor":`):

```ts
				case "push:notify": {
					const { ownerId, messages } = job.data as {
						ownerId: string;
						messages: import("../../lib/push/send-push-notifications").PushableMessage[];
					};
					await sendPushNotifications({ ownerId, messages });
					return { success: true };
				}
```

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter @kurrier/worker build`
Expected: compiles with no type errors.

- [ ] **Step 4: Commit**

```bash
git add apps/worker/lib/push/send-push-notifications.ts apps/worker/server/plugins/common-worker.ts
git commit -m "feat: send push notifications for new inbox mail"
```

---

### Task 5: Trigger — buffer new live messages into `push:notify` jobs

**Files:**
- Modify: `apps/worker/lib/message-payload-parser.ts`

**Interfaces:**
- Consumes: `PushableMessage` type (Task 4, imported as a type-only import to avoid a require cycle)
- Produces: enqueues `push:notify` jobs onto `commonWorkerQueue`, one per
  `ownerId` per flush — consumed by Task 4's `common-worker.ts` case.

- [ ] **Step 1: Add the buffer**

In `apps/worker/lib/message-payload-parser.ts`, add a new job type next to
`WebhookJob` (line 33):

```ts
type PushJob = {
	ownerId: string;
	mailboxId: string;
	threadId: string;
	subject: string | null;
	from: any;
};
```

Add a new buffer next to `webhookBuffer` (line 44):

```ts
let pushBuffer: PushJob[] = [];
```

- [ ] **Step 2: Flush it into grouped jobs**

In `flushBatches()`, update the emptiness check at line 50 to include it:

```ts
	if (!searchBuffer.length && !webhookBuffer.length && !icsBuffer.length && !rulesBuffer.length && !pushBuffer.length)
		return;
```

Then add a new block after the `rulesBuffer` block (after line 117, before
the closing `} catch`):

```ts
		if (pushBuffer.length) {
			const byOwner = new Map<string, PushJob[]>();
			for (const job of pushBuffer) {
				const existing = byOwner.get(job.ownerId) ?? [];
				existing.push(job);
				byOwner.set(job.ownerId, existing);
			}

			const jobs = [...byOwner.entries()].map(([ownerId, jobsForOwner]) => ({
				name: "push:notify",
				data: {
					ownerId,
					messages: jobsForOwner.map((j) => ({
						mailboxId: j.mailboxId,
						threadId: j.threadId,
						subject: j.subject,
						from: j.from,
					})),
				},
			}));

			await commonWorkerQueue.addBulk(jobs);
			pushBuffer = [];
		}
```

- [ ] **Step 3: Push into the buffer alongside the webhook buffer**

Find the existing block (around line 432 before this edit):

```ts
	if (mode === "live") {
		webhookBuffer.push({ message, rawEmail });
		rulesBuffer.push({ messageId: message.id });
		if ((webhookBuffer.length >= WEBHOOK_BATCH_SIZE) || (rulesBuffer.length >= RULES_BATCH_SIZE)) {
			await flushBatches();
		} else {
			scheduleFlush();
		}
	}
```

Replace it with:

```ts
	if (mode === "live") {
		webhookBuffer.push({ message, rawEmail });
		rulesBuffer.push({ messageId: message.id });
		pushBuffer.push({
			ownerId: message.ownerId,
			mailboxId: message.mailboxId,
			threadId: message.threadId,
			subject: message.subject,
			from: message.from,
		});
		if ((webhookBuffer.length >= WEBHOOK_BATCH_SIZE) || (rulesBuffer.length >= RULES_BATCH_SIZE)) {
			await flushBatches();
		} else {
			scheduleFlush();
		}
	}
```

- [ ] **Step 4: Typecheck**

Run: `pnpm --filter @kurrier/worker build`
Expected: compiles with no type errors.

- [ ] **Step 5: Manual smoke check**

Follow this repo's `run` skill (or `pnpm run dev`) to start the local stack,
send a test email through the local pipeline (e.g. via the existing inbound
webhook route used in dev), and confirm in worker logs that a `push:notify`
job is added and processed (it will no-op harmlessly since no subscriptions
exist yet — that's expected until Task 8 is done).

- [ ] **Step 6: Commit**

```bash
git add apps/worker/lib/message-payload-parser.ts
git commit -m "feat: trigger push notifications for new live inbox messages"
```

---

### Task 6: Web server actions — subscribe / unsubscribe

**Files:**
- Create: `apps/web/lib/actions/push.ts`

**Interfaces:**
- Consumes: `rlsClient()` (`apps/web/lib/actions/clients.ts`), `pushSubscriptions` table (Task 1)
- Produces: `subscribeToPush(subscription): Promise<{ success: boolean }>`,
  `unsubscribeFromPush(endpoint: string): Promise<{ success: boolean }>` —
  Task 8's settings component calls these directly (not via `<form action>`).

- [ ] **Step 1: Write the actions**

Create `apps/web/lib/actions/push.ts`:

```ts
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
```

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter @kurrier/web build`
Expected: compiles with no type errors. (This also validates the RLS insert
policy shape from Task 1 against real Drizzle types.)

- [ ] **Step 3: Commit**

```bash
git add apps/web/lib/actions/push.ts
git commit -m "feat: add subscribe/unsubscribe push notification actions"
```

---

### Task 7: Service worker — push and click handling

**Files:**
- Modify: `apps/web/public/sw.js`

**Interfaces:**
- Consumes: JSON payload shape `{ title: string; body: string; url: string }`
  sent by `sendPushNotifications` (Task 4) — must match exactly.
- Produces: OS-level notifications; click navigates the app.

- [ ] **Step 1: Add the listeners**

In `apps/web/public/sw.js`, add after the existing `fetch` listener (after
line 62, end of file):

```js
self.addEventListener("push", (event) => {
	if (!event.data) return;

	let payload;
	try {
		payload = event.data.json();
	} catch {
		return;
	}

	const { title, body, url } = payload;

	event.waitUntil(
		self.registration.showNotification(title, {
			body,
			icon: "/icons/icon-192.png",
			data: { url },
		}),
	);
});

self.addEventListener("notificationclick", (event) => {
	event.notification.close();
	const url = event.notification.data?.url || "/";

	event.waitUntil(
		clients.matchAll({ type: "window", includeUncontrolled: true }).then((windowClients) => {
			for (const client of windowClients) {
				if ("focus" in client) {
					client.navigate(url);
					return client.focus();
				}
			}
			return clients.openWindow(url);
		}),
	);
});
```

- [ ] **Step 2: Manual smoke check**

Since service workers can't be exercised by `node:test`, verify manually
once Task 8's UI exists: open dev tools → Application → Service Workers,
confirm `sw.js` re-registers with the new listeners after a hard refresh
(the browser diffs the file automatically; no cache-name bump needed since
this doesn't touch the caching logic).

- [ ] **Step 3: Commit**

```bash
git add apps/web/public/sw.js
git commit -m "feat: handle push and notification-click events in the service worker"
```

---

### Task 8: Settings UI and navigation

**Files:**
- Create: `apps/web/components/dashboard/notifications/manage-push-notifications.tsx`
- Create: `apps/web/app/[locale]/w/[wPublicId]/dashboard/(unified)/(platform)/platform/notifications/page.tsx`
- Modify: `apps/web/components/nav-main.tsx` (add nav entry)

**Interfaces:**
- Consumes: `subscribeToPush`/`unsubscribeFromPush` (Task 6),
  `useConfigContext()` (`apps/web/components/providers/config-provider.tsx`)
  for `VAPID_PUBLIC_KEY` (Task 2).
- Produces: user-facing toggle; no other task depends on this one.

- [ ] **Step 1: Write the toggle component**

Create `apps/web/components/dashboard/notifications/manage-push-notifications.tsx`:

```tsx
"use client";

import { useEffect, useState } from "react";
import { Switch } from "@/components/ui/switch";
import { useConfigContext } from "@/components/providers/config-provider";
import { subscribeToPush, unsubscribeFromPush } from "@/lib/actions/push";

function urlBase64ToUint8Array(base64String: string) {
	const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
	const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
	const rawData = atob(base64);
	return Uint8Array.from([...rawData].map((char) => char.charCodeAt(0)));
}

export function ManagePushNotifications() {
	const { VAPID_PUBLIC_KEY } = useConfigContext();
	const [enabled, setEnabled] = useState(false);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
			setLoading(false);
			return;
		}
		navigator.serviceWorker.ready
			.then((reg) => reg.pushManager.getSubscription())
			.then((sub) => setEnabled(!!sub))
			.finally(() => setLoading(false));
	}, []);

	async function handleToggle(next: boolean) {
		setError(null);

		if (!VAPID_PUBLIC_KEY) {
			setError("Push notifications aren't configured on this server.");
			return;
		}

		const reg = await navigator.serviceWorker.ready;

		if (next) {
			const permission = await Notification.requestPermission();
			if (permission !== "granted") {
				setError("Notification permission was denied.");
				return;
			}

			const sub = await reg.pushManager.subscribe({
				userVisibleOnly: true,
				applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
			});

			await subscribeToPush({
				endpoint: sub.endpoint,
				keys: {
					p256dh: btoa(String.fromCharCode(...new Uint8Array(sub.getKey("p256dh")!))),
					auth: btoa(String.fromCharCode(...new Uint8Array(sub.getKey("auth")!))),
				},
				userAgent: navigator.userAgent,
			});
			setEnabled(true);
		} else {
			const sub = await reg.pushManager.getSubscription();
			if (sub) {
				await unsubscribeFromPush(sub.endpoint);
				await sub.unsubscribe();
			}
			setEnabled(false);
		}
	}

	if (loading) return null;

	return (
		<div className="flex flex-col gap-2">
			<div className="flex items-center justify-between">
				<div>
					<p className="font-medium">Push notifications</p>
					<p className="text-sm text-muted-foreground">
						Get notified in this browser when new email arrives in your Inbox.
					</p>
				</div>
				<Switch checked={enabled} onCheckedChange={handleToggle} />
			</div>
			{error && <p className="text-sm text-destructive">{error}</p>}
		</div>
	);
}
```

Check `apps/web/components/ui/switch.tsx` exists before writing this file —
if the project's toggle primitive has a different name or prop signature
(e.g. `onChange` instead of `onCheckedChange`), match it instead of what's
written above.

- [ ] **Step 2: Add the page**

Create `apps/web/app/[locale]/w/[wPublicId]/dashboard/(unified)/(platform)/platform/notifications/page.tsx`:

```tsx
import { SidebarTrigger } from "@/components/ui/sidebar";
import { Separator } from "@/components/ui/separator";
import { ManagePushNotifications } from "@/components/dashboard/notifications/manage-push-notifications";

export default function Page() {
	return (
		<>
			<header className="flex h-16 shrink-0 items-center gap-2">
				<div className="flex items-center gap-2 px-4">
					<SidebarTrigger className="-ml-1" />
					<Separator orientation="vertical" className="mr-2 data-[orientation=vertical]:h-4" />
				</div>
			</header>
			<div className="flex flex-1 flex-col gap-4 p-4 pt-0">
				<ManagePushNotifications />
			</div>
		</>
	);
}
```

- [ ] **Step 3: Add the nav entry**

In `apps/web/components/nav-main.tsx`, add `Bell` to the lucide-react import
(line 3-13), then add a new item to `navPlatformItems` right after
`"Overview"` (after line 48, before the `workspaceRole === "owner"` spread) —
unlike Webhooks/API Keys/Workspace, this is NOT gated to `workspaceRole ===
"owner"` since it's a personal setting any member can toggle for themselves:

```ts
			{
				title: "Notifications",
				url: `/w/${workspacePublicId}/dashboard/platform/notifications`,
				icon: Bell,
				items: [],
			},
```

- [ ] **Step 4: Manual end-to-end verification**

Start the local dev stack, sign in, open Settings → Notifications, toggle it
on (grant the browser permission prompt), confirm the toggle reflects
`enabled: true` after a page reload. Send a test email into the Inbox
through the local pipeline and confirm an OS notification appears; click it
and confirm it opens the right thread. Send 4+ emails in quick succession
and confirm they collapse into one "N new emails" notification that opens
the Inbox. Toggle notifications off and confirm the subscription row is
deleted (`select * from push_subscriptions` should be empty for that user).

- [ ] **Step 5: Commit**

```bash
git add apps/web/components/dashboard/notifications/manage-push-notifications.tsx "apps/web/app/[locale]/w/[wPublicId]/dashboard/(unified)/(platform)/platform/notifications/page.tsx" apps/web/components/nav-main.tsx
git commit -m "feat: add push notification settings UI"
```
