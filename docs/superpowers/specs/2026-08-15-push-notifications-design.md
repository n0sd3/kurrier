# Web push notifications for new email

**Date:** 2026-08-15
**Status:** Approved for planning

## Problem

Kurrier is a PWA (`apps/web/public/sw.js`, `apps/web/components/common/pwa-register.tsx`)
but the service worker only caches assets — there is no `push` or
`notificationclick` listener, no VAPID key handling, no subscription storage, and
no code anywhere in the repo that sends a push notification. Users get no signal
that new mail has arrived unless the app is open.

## Scope

In scope: browser push notifications for new mail landing in the Inbox, covering
subscribe/unsubscribe, the send pipeline, and click-to-open-thread behavior.

Out of scope: notifications for other event types (calendar invites, mentions,
etc.), native mobile push (APNs/FCM outside the web push standard), per-identity
notification toggles, and notification preference granularity beyond a single
on/off switch.

## Key decisions

- **Trigger:** new email landing in the **Inbox** only (not Spam or other
  folders), and only for messages processed in **live** mode — not during the
  initial backfill/sync of a newly connected account.
- **Grouping:** one push per email normally; if more than 3 messages for the same
  user land in the same processing batch, collapse into a single "N new emails"
  notification instead of flooding the device.
- **Click behavior:** clicking a single-email notification opens that thread
  directly (`/mail/thread/{threadId}`); clicking a grouped notification opens the
  Inbox.
- **Toggle scope:** one global on/off switch per user in Settings, covering all
  connected accounts/identities — not per-identity.
- **Opt-in model:** no separate "enabled" flag in the DB. A stored, non-expired
  push subscription *is* the opt-in. Toggling off in Settings deletes the
  subscription both from the browser (`PushSubscription.unsubscribe()`) and the
  server.

## Existing infrastructure this builds on

- **Service worker:** `apps/web/public/sw.js` (cache-only today), registered by
  `apps/web/components/common/pwa-register.tsx` in production.
- **Live vs. backfill distinction already exists:** `parseAndStoreEmail` in
  `apps/worker/lib/message-payload-parser.ts` takes `opts.mode: "live" |
  "backfill"` (default `"live"`). The existing `webhookBuffer`/`rulesBuffer`
  buffering block (~line 432) is gated on `mode === "live"` — the same gate the
  new push buffer will use. Backfill call sites
  (`apps/worker/lib/gmail/gmail-backfill.ts`,
  `apps/worker/lib/imap/backfill/backfill-full.ts`) pass `mode: "backfill"`;
  live call sites (`apps/worker/lib/imap/imap-delta-fetch.ts`, Gmail delta sync,
  inbound webhook routes under `apps/worker/server/routes/api/v1/hooks/`) either
  pass `mode: "live"` or rely on the default.
- **Inbox filter:** `mailboxes.kind` enum (`packages/db/src/drizzle/schema.ts`,
  default `"inbox"`) identifies the Inbox mailbox; the push buffer only pushes
  when the message's mailbox has `kind === "inbox"`.
- **Job queue:** BullMQ, queue `commonWorkerQueue`, consumed by
  `apps/worker/server/plugins/common-worker.ts`. `webhook:message.received` is
  the existing sibling job — the new job (`push:notify`) follows the same
  add/consume pattern.
- **Auth:** JWT session cookie, verified via `isSignedIn()` in
  `apps/web/lib/actions/auth.ts` — the subscribe/unsubscribe server actions use
  this exactly like other authenticated actions in `apps/web/lib/actions/*.ts`.
- **Env var pattern for optional secrets:** `API_ADMIN_KEY` in
  `apps/worker/lib/api-helpers.ts` is read directly from `process.env`, guarded
  by a presence/length check, and deliberately excluded from the validated Zod
  `ZServerConfig` (`packages/schema/src/types/config.ts`) because it's an
  opt-in feature flag, not a required boot-time config. VAPID keys follow the
  same pattern.

## Design

### 1. Schema — `packages/db/src/drizzle/schema.ts`

New table `pushSubscriptions`, modeled on the existing `webhooks` table
(same file, ~line 900) for RLS conventions:

- `id` (uuid, pk)
- `ownerId` (fk → `users`, cascade delete)
- `endpoint` (text, unique) — the push service URL from the browser
- `p256dh` (text) — subscription encryption key
- `auth` (text) — subscription auth secret
- `userAgent` (text, nullable) — informational only, not used for logic
- `createdAt` (timestamptz, default now)
- RLS policy mirroring `webhookCrudPolicies`, scoped to `ownerId = auth.uid()`
  (subscriptions aren't workspace-scoped since the toggle is per-user, not
  per-identity)

A user can have multiple rows (one per browser/device). Generate the migration
with `pnpm --filter @kurrier/db db:generate` (drizzle-kit), consistent with how
`db/migrations/*.sql` is produced today — do not hand-write the SQL.

### 2. VAPID keys and config

- `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` / `VAPID_SUBJECT` (a `mailto:` contact
  the push services can reach out to) read directly from `process.env` in
  `apps/worker`, following the `API_ADMIN_KEY` pattern — absent means the push
  pipeline no-ops (skip sending, log once).
- `VAPID_PUBLIC_KEY` also needs to reach the browser to build the subscription's
  `applicationServerKey`. Add it to the public config surface
  (`ZPublicConfig`/`getPublicEnv()` in `packages/schema/src/types/config.ts`) —
  it's not a secret, the public key is meant to be exposed to clients.
- Generate the keypair once with `web-push generate-vapid-keys` (CLI from the
  `web-push` npm package) and document the three env vars in
  `db/NOTES-INSTALL.md` alongside the other local-stack setup notes.

### 3. Subscribe / unsubscribe — `apps/web/lib/actions/push.ts`

Two server actions, following the existing pattern in `apps/web/lib/actions/*.ts`:

- `subscribeToPush(subscription: { endpoint, keys: { p256dh, auth } })` — calls
  `isSignedIn()`, upserts a `pushSubscriptions` row keyed on `endpoint`.
- `unsubscribeFromPush(endpoint: string)` — calls `isSignedIn()`, deletes the row
  where `endpoint` matches and `ownerId` matches the session user.

### 4. Service worker — `apps/web/public/sw.js`

Two new listeners, added without touching the existing cache logic:

- `push` — parses the JSON payload (`{ title, body, threadId | null, count |
  null }`), calls `self.registration.showNotification(title, { body, icon:
  "/icons/icon-192.png", data: { url } })` where `url` is
  `/mail/thread/{threadId}` for a single message or `/mail` for a grouped
  notification.
- `notificationclick` — closes the notification, then focuses an existing
  client window if one is open (navigating it to `data.url`), or opens a new
  window at `data.url` otherwise. Standard `clients.matchAll` /
  `clients.openWindow` pattern.

### 5. Settings UI

A toggle in the existing Settings surface:

- **Turning on:** request `Notification` permission (browser prompt) → if
  granted, `navigator.serviceWorker.ready` → `pushManager.subscribe({
  userVisibleOnly: true, applicationServerKey: <VAPID_PUBLIC_KEY> })` → send the
  resulting subscription to `subscribeToPush`.
- **Turning off:** read the current `PushSubscription` via
  `pushManager.getSubscription()`, call `unsubscribeFromPush(endpoint)`, then
  `subscription.unsubscribe()` locally.
- Toggle state on load reflects whether `pushManager.getSubscription()` returns
  a non-null subscription (source of truth is the browser, not a DB flag,
  consistent with "no enabled column" decision above).

### 6. Trigger — `apps/worker/lib/message-payload-parser.ts`

Alongside the existing block:

```ts
if (mode === "live") {
  webhookBuffer.push({ message, rawEmail });
  rulesBuffer.push({ messageId: message.id });
  ...
}
```

add a parallel push-notification buffer, additionally gated on the message's
mailbox being the Inbox:

```ts
if (mode === "live" && mailboxKind === "inbox") {
  pushBuffer.push({ ownerId, messageId: message.id, threadId: message.threadId, subject, from });
  ...
}
```

`mailboxKind` needs to be resolved (or passed in via `opts`) the same way the
rest of `parseAndStoreEmail` already has `mailboxId` available — check the
mailbox row's `kind` column. Flushing follows the existing `flushBatches()` /
`scheduleFlush()` pattern and enqueues a `push:notify` job per affected
`ownerId` onto `commonWorkerQueue`, batching all of that owner's buffered
messages from this flush into one job payload.

### 7. Send — `apps/worker/server/plugins/common-worker.ts`

New `case "push:notify"` alongside the existing `webhook:message.received`
handler, implemented in a new `apps/worker/lib/push/send-notification.ts`:

1. Look up all `pushSubscriptions` rows for the job's `ownerId`.
2. If none, no-op.
3. If none of the required VAPID env vars are set, log once and no-op.
4. Build the payload: if the job's batch has ≤3 messages, send one
   `web-push.sendNotification()` call per message (subject as title, sender as
   body, `threadId` in the payload); if >3, send a single notification per
   subscription with `{ title: "N new emails", body: "in <account/workspace
   name>", count: N }` (no `threadId`, so the click target is `/mail`).
5. For each subscription, call `webpush.sendNotification(subscription, payload,
   { vapidDetails })`. On a `410 Gone` or `404` response, delete that
   subscription row (expired/unregistered) — same cleanup pattern webhook
   delivery likely already uses for dead endpoints.

## Testing

- Unit: the mailbox-kind + mode gating logic that decides whether a message
  enters `pushBuffer` (mirror however `webhookBuffer`'s gating is tested today,
  if at all — otherwise add a focused test in
  `apps/worker/lib/message-payload-parser.test.ts` or equivalent).
- Unit: the send logic's batching decision (≤3 vs >3) and the subject/body
  formatting for both cases.
- Manual: end-to-end in the local dev stack — subscribe a browser, send a test
  email through the local pipeline, confirm the OS-level notification appears
  and clicking it opens the right thread; repeat with 4+ messages in one flush
  to confirm grouping; disconnect a subscription (simulate 410) and confirm the
  row is cleaned up.
