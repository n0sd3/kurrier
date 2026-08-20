# Unified mailbox across connected accounts

**Date:** 2026-08-20
**Status:** Approved for planning

## Problem

Mail navigation is scoped to a single connected account. Every route lives under
`/w/{wPublicId}/dashboard/mail/{identityPublicId}/{mailboxSlug}`, and the sidebar
([`identity-mailboxes-list.tsx`](../../../apps/web/components/dashboard/identity-mailboxes-list.tsx))
lists each identity with its own folders underneath. A user with three connected
accounts has to visit three Inboxes to know what arrived, and there is no view that
answers "what is new across everything".

This spec covers a unified view of **Inbox, Sent, Spam and Trash** across all
connected email identities, with full per-row action parity, plus **unified search**.

## What the code already supports

Three findings, measured against the current tree, shape the whole design.

### Thread rows are already denormalized

`mailbox_threads` ([`schema.ts:746`](../../../packages/db/src/drizzle/schema.ts))
carries `identityPublicId`, `mailboxId`, `mailboxSlug`, `subject`, `participants`,
`lastActivityAt`, `unreadCount` and `starred` on the same row. A cross-account list
is one query over an existing table. **No table or column migration is required** — the
only open migration question is an index, addressed in §1.

Its RLS select policy is `identitySelectCondition(t, t.identityId)`, so dropping the
identity filter from a query does not widen access beyond the user's own identities.
The unified query needs no new security filter.

### Thread actions are already identity-agnostic

Every mutation takes `mailboxId` as an explicit parameter:

| Action | Signature | Location |
| --- | --- | --- |
| `markAsRead` | `(threadIds, mailboxId, markSmtp, refresh, path)` | `mailbox.ts:709` |
| `markAsUnread` | `(threadIds, mailboxId, markSmtp, refresh, path)` | `mailbox.ts:784` |
| `moveToTrash` | `(threadIds, mailboxId, moveImap, refresh, messageId, path)` | `mailbox.ts:882` |
| `toggleStar` | `(threadId, mailboxId, starred, starImap, path)` | `mailbox.ts:935` |

None of them read an ambient "active identity". Full action parity in a unified list
therefore requires **no change to the data layer at all** — it is purely a matter of
each row supplying its own `mailboxId`.

### The search index already carries what unified search needs

Documents ingested into Typesense include `mailboxId` and `identityPublicId`
([`search-operations.ts:50`](../../../apps/worker/lib/search/search-operations.ts)).
Unified search needs **no reindex**; those fields are simply not surfaced in the
mapped result today.

## The actual obstacle: a single `activeMailbox` threaded through the UI

`webmail-list.tsx` receives one `activeMailbox: MailboxEntity` and passes it to the
header, every row, and `move-to-folder`. Row-level code reads `activeMailbox.id` for
actions, `.kind` to decide which buttons appear, and `.slug` to build the thread
link. In a unified list each row belongs to a different account, so a single shared
mailbox is wrong for every row but one.

`mailboxSync` has the same shape of problem and a quieter failure mode. The
`!!mailboxSync` argument passed to every action
([`webmail-list-item.tsx:219`](../../../apps/web/components/mailbox/default/webmail-list-item.tsx)
and five other call sites) controls whether the change is propagated over IMAP/SMTP.
Passing another account's sync row would skip propagation with no error surfaced.

### This bug already exists

The snoozed page ([`snoozed/page.tsx`](../../../apps/web/app/%5Blocale%5D/w/%5BwPublicId%5D/dashboard/%28unified%29/%28mail%29/mail/%5BidentityPublicId%5D/snoozed/page.tsx))
derives its `activeMailbox` from `threads[0]?.mailboxSlug` — the first thread of *any*
account, since `fetchIdentitySnoozedThreads()` is already cross-account — and then
filters the list down to one identity. When the first snoozed thread belongs to a
different account, the whole list acts against the wrong mailbox. Per-row resolution
removes this class of bug rather than working around it.

## Design

### 1. Data layer

New file `apps/web/lib/actions/unified-mailbox.ts`. It is kept separate from
`mailbox.ts`, which is already 1641 lines and is the file this work would otherwise
grow further.

- `fetchUnifiedThreads(kind, page)`
- `fetchUnifiedMailboxContext(kind)` → `mailboxById: Record<id, { mailbox, identity, sync }>`
- `fetchUnifiedThreadCount(kind)`

`fetchUnifiedThreads` joins `mailbox_threads` → `mailboxes` on `mailboxId` and filters
on **`mailboxes.kind`**, never on `mailboxSlug`. Slugs are derived from the provider's
own folder names via `slugify(name.toLowerCase())`
([`discover-mailboxes.ts:96`](../../../apps/worker/lib/imap/backfill/discover/discover-mailboxes.ts)),
so one account's Spam may be `junk` and another's `spam`. A slug filter would drop
accounts silently. It keeps today's snooze predicate, orders by
`COALESCE(unsnoozedAt, lastActivityAt) DESC`, and pages by offset with `PAGE_SIZE`.

**Index:** the existing `ix_mbth_identity_slug_effective_activity` is prefixed by
`identityPublicId` and will not serve a cross-account sort. `ix_mbth_mailbox_activity`
(`mailboxId, lastActivityAt, threadId`) may let Postgres merge per-mailbox scans. This
is not settled by reading — run `EXPLAIN ANALYZE` against the live database and add an
index migration only if the plan is bad. Do not add one speculatively.

### 2. Unified search

`initSearch` ([`mailbox.ts:474`](../../../apps/web/lib/actions/mailbox.ts)) builds
`filter_by` from three terms. The unified variant keeps `workspacePublicId` — the
security boundary — and drops `identityPublicId` and `mailboxSlug`.

Two coupled changes carry the risk here:

- `ThreadHit` in `packages/schema` gains `mailboxId` and `identityPublicId`. Both are
  already on the indexed document; only the mapping omits them.
- Hydration today is `fetchMailboxThreadsList(activeMailbox.id, threadIds)` — a single
  mailbox id. It becomes a lookup by **(threadId, mailboxId) pairs** taken from the
  hits themselves.

### 3. Routes

`(mail)/mail/all/[mailboxKind]/page.tsx` and `.../all/[mailboxKind]/search/page.tsx`,
with `mailboxKind ∈ {inbox, sent, spam, trash}` and a 404 for anything else. The static
`all` segment takes precedence over the sibling `[identityPublicId]`, so the two do not
collide. Opening a thread continues to route to the existing per-account thread view;
the reader is untouched.

### 4. Per-row mailbox resolution

Replace the `activeMailbox: MailboxEntity` prop with `mailboxById`, plus a pure helper
`resolveRowMailbox(mailboxById, row)`. Each row derives, from its own `row.mailboxId`:
the `id` used by actions, the `kind` that decides which buttons render, the `slug` for
its link, and **that account's `sync` row** for the IMAP/SMTP propagation flags.

Affected components: `webmail-list.tsx`, `webmail-list-item.tsx`,
`mail-list-header.tsx`, `move-to-folder.tsx`, `webmail-list-label-search.tsx`.

Per-account pages pass a single-entry map. Behavior there is unchanged, and there is
one code path rather than a fork.

### 5. Mixed-account bulk selection

`selectedThreadIds` is a `Set<threadId>`; thread ids are UUIDs, so they do not collide
across accounts. A pure helper `groupSelectionByMailbox(rows, selectedIds)` returns
`Array<{ mailboxId, threadIds }>`, and the header issues one call per group under
`Promise.all`. Because the actions already take `mailboxId`, none of them change.

The header's Sync and Resync buttons currently use a single `identityIdRef`. In the
unified view they run `deltaFetch` once per identity.

### 6. Sidebar and row presentation

A "Todas as contas" group is added at the top of `identity-mailboxes-list.tsx` with the
four entries. Its unread badge sums `fetchMailboxUnreadCounts` (already keyed by
`mailboxId`) grouped by kind. Existing per-account groups stay below, unchanged.

Each row in the unified list carries a compact marker of its source account. Without
it the list is unreadable once more than one account is connected.

### 7. Testing

The repo tests pure functions in `lib/` with `node:test`
(e.g. [`contact-duplicates.test.ts`](../../../apps/web/lib/contact-duplicates.test.ts));
there is no React testing setup. The three helpers — `resolveRowMailbox`,
`groupSelectionByMailbox`, and the unread-count aggregation by kind — therefore live in
`apps/web/lib/unified-mailbox.ts` as pure functions with `node:test` coverage.

Those tests are written **before** the component refactor. They are the safety net for
modifying a list that currently works.

## Decisions taken

| Decision | Choice | Rationale |
| --- | --- | --- |
| Navigation | "Todas as contas" group at top; per-account nav untouched | Additive; nothing existing changes behavior |
| Row actions | Full parity | Actions already take `mailboxId`; parity is cheap |
| Account scope | All email identities, always | No configuration, no migration; new accounts appear automatically |
| Mixed bulk selection | Group by `mailboxId`, one call per group | Invisible to the user; no action signature changes |
| Component strategy | Refactor to per-row resolution | Avoids forking ~900 lines that would drift |
| Mailbox matching | By `kind` | Slugs are provider-derived and inconsistent |

## Out of scope

Deferred deliberately, each needing its own spec:

- **Unified labels.** Every label carries `labels.identityId` and belongs to exactly one
  account, while `uniq_label_workspace_scope_slug` makes the slug unique per workspace —
  so two accounts cannot both have a "Faturas" label today. A unified label view would
  still show a single account's threads. Making one label span accounts is a data-model
  change, and interacts with Gmail's per-account native labels. The semantics must be
  decided before this is designed.
- **Drafts.** There is no Drafts view at all: drafts are excluded from
  `fetchIdentityMailboxList` (`kind NOT IN ('outbox','drafts')`), filtered out of
  `MailboxNav`, and have no route. Only "Scheduled" exists, backed by drafts with
  `status='scheduled'`. This is building the Drafts feature — list, reopen in composer,
  autosave, delete, provider sync — not unifying an existing one.
- **Unified Archive and Snoozed.** Both are cheap on top of this design (Archive is one
  more `kind`; `fetchIdentitySnoozedThreads` is already cross-account), and were
  explicitly deferred by the owner to keep v1 focused.
- **Composing from the unified view.** Compose continues to ask for the sending account.
