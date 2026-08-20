# Unified Mailbox Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a cross-account Inbox/Sent/Spam/Trash view with full per-row action parity, plus unified search across all connected email accounts.

**Architecture:** `mailbox_threads` is already denormalized and RLS-scoped, so the unified list is one query over an existing table joined to `mailboxes` on `kind`. The UI change is the real work: the list components currently receive a single `activeMailbox` and apply it to every row, which is wrong once rows come from different accounts. They are refactored to resolve each row's mailbox from its own `mailboxId` via a `mailboxById` map. Per-account pages pass a single-entry map and keep their exact current behavior.

**Tech Stack:** Next.js App Router (server components + server actions), Drizzle ORM on Postgres with RLS, Typesense for search, Mantine + Tailwind, `node:test` via `tsx` for unit tests.

**Spec:** [`docs/superpowers/specs/2026-08-20-unified-mailbox-design.md`](../specs/2026-08-20-unified-mailbox-design.md)

## Global Constraints

- **Match mailboxes by `kind`, never by `slug`.** Slugs are `slugify(providerFolderName)` and differ per account (`junk` vs `spam`). Filtering by slug drops accounts silently.
- **`PAGE_SIZE` is 50**, imported from `@common/mail-client`. Never hardcode it.
- **Never pass one account's `mailboxSync` to another account's row.** The `!!mailboxSync` argument controls IMAP/SMTP propagation; a wrong value skips propagation with no visible error.
- **Do not widen RLS.** `mailbox_threads` already restricts to the user's identities. Unified queries must not add `db` (non-RLS) access; always go through `rlsClient()`.
- **Unified mailbox kinds are exactly** `inbox`, `sent`, `spam`, `trash`. Archive, Snoozed, Drafts and labels are out of scope for this plan.
- **Test command:** `npx tsx --test <file>` (verified working; there is no `test` script in `package.json`).
- **Commit style:** Conventional Commits, matching existing history (`feat(worker):`, `fix(admin):`, `refactor(dashboard):`).
- **Live refresh comes for free.** `MailboxRealtime` (added in `f932ba8`) is mounted in the shared `(mail)/layout.tsx`, the parent of the new `all/[mailboxKind]` routes, and revalidates that RSC tree on any `mailbox_threads` change. The unified views inherit it — do not add a second subscription or a polling loop.

## Scope decisions locked here

Two UI affordances do not have a coherent unified meaning. Both are hidden when the view is unified, and this is deliberate, not an omission:

- **Empty Trash** — would mean emptying N separate trashes in one click. Hidden; "Delete forever" on an explicit selection still works.
- **Move to folder** — the destination folder list belongs to one account. Hidden; moving across accounts is not a thing this feature does.

---

### Task 1: Pure helpers for row resolution and selection grouping

These three functions carry all the logic that the component refactor depends on. They are pure and get real test coverage, which is the safety net for Tasks 3 and 4.

**Files:**
- Create: `apps/web/lib/unified-mailbox.ts`
- Test: `apps/web/lib/unified-mailbox.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces:
  - `UNIFIED_MAILBOX_KINDS: readonly ["inbox","sent","spam","trash"]`
  - `type UnifiedMailboxKind = "inbox" | "sent" | "spam" | "trash"`
  - `isUnifiedMailboxKind(value: string): value is UnifiedMailboxKind`
  - `type MailboxContext = { mailbox: MailboxEntity; identity: IdentityEntity; sync: MailboxSyncEntity | null }`
  - `type MailboxContextMap = Record<string, MailboxContext>`
  - `resolveRowMailbox(mailboxById: MailboxContextMap, row: { mailboxId: string }): MailboxContext | null`
  - `groupSelectionByMailbox(rows: ReadonlyArray<{ threadId: string; mailboxId: string }>, selectedIds: ReadonlySet<string>): Array<{ mailboxId: string; threadIds: string[] }>`
  - `sumUnreadByKind(mailboxes: ReadonlyArray<{ id: string; kind: string }>, unreadCounts: ReadonlyMap<string, { unreadThreads: number; unreadTotal: number }>): Record<string, number>`

- [ ] **Step 1: Write the failing test**

Create `apps/web/lib/unified-mailbox.test.ts`:

```ts
import test from "node:test";
import assert from "node:assert/strict";

import {
	UNIFIED_MAILBOX_KINDS,
	isUnifiedMailboxKind,
	resolveRowMailbox,
	groupSelectionByMailbox,
	sumUnreadByKind,
	type MailboxContextMap,
} from "./unified-mailbox";

function ctx(mailboxId: string, identityId: string, withSync: boolean) {
	return {
		mailbox: { id: mailboxId, identityId, kind: "inbox", slug: "inbox" },
		identity: { id: identityId, publicId: `pub-${identityId}` },
		sync: withSync ? { mailboxId } : null,
	} as unknown as MailboxContextMap[string];
}

test("isUnifiedMailboxKind accepts exactly the four supported kinds", () => {
	for (const kind of UNIFIED_MAILBOX_KINDS) {
		assert.equal(isUnifiedMailboxKind(kind), true);
	}
	assert.equal(isUnifiedMailboxKind("archive"), false);
	assert.equal(isUnifiedMailboxKind("drafts"), false);
	assert.equal(isUnifiedMailboxKind(""), false);
});

test("resolveRowMailbox returns the context belonging to the row's own mailbox", () => {
	const map: MailboxContextMap = {
		"mbx-a": ctx("mbx-a", "id-a", true),
		"mbx-b": ctx("mbx-b", "id-b", false),
	};

	assert.equal(resolveRowMailbox(map, { mailboxId: "mbx-b" })?.mailbox.id, "mbx-b");
	assert.equal(resolveRowMailbox(map, { mailboxId: "mbx-b" })?.identity.id, "id-b");
});

test("resolveRowMailbox carries each account's own sync row, not a shared one", () => {
	const map: MailboxContextMap = {
		"mbx-a": ctx("mbx-a", "id-a", true),
		"mbx-b": ctx("mbx-b", "id-b", false),
	};

	assert.notEqual(resolveRowMailbox(map, { mailboxId: "mbx-a" })?.sync, null);
	assert.equal(resolveRowMailbox(map, { mailboxId: "mbx-b" })?.sync, null);
});

test("resolveRowMailbox returns null for a row whose mailbox is absent", () => {
	assert.equal(resolveRowMailbox({}, { mailboxId: "missing" }), null);
});

test("groupSelectionByMailbox splits a mixed-account selection by mailbox", () => {
	const rows = [
		{ threadId: "t1", mailboxId: "mbx-a" },
		{ threadId: "t2", mailboxId: "mbx-b" },
		{ threadId: "t3", mailboxId: "mbx-a" },
	];

	const groups = groupSelectionByMailbox(rows, new Set(["t1", "t2", "t3"]));
	const byId = new Map(groups.map((g) => [g.mailboxId, g.threadIds]));

	assert.equal(groups.length, 2);
	assert.deepEqual(byId.get("mbx-a"), ["t1", "t3"]);
	assert.deepEqual(byId.get("mbx-b"), ["t2"]);
});

test("groupSelectionByMailbox ignores rows that are not selected", () => {
	const rows = [
		{ threadId: "t1", mailboxId: "mbx-a" },
		{ threadId: "t2", mailboxId: "mbx-b" },
	];

	const groups = groupSelectionByMailbox(rows, new Set(["t2"]));

	assert.deepEqual(groups, [{ mailboxId: "mbx-b", threadIds: ["t2"] }]);
});

test("groupSelectionByMailbox ignores selected ids with no visible row", () => {
	const rows = [{ threadId: "t1", mailboxId: "mbx-a" }];

	const groups = groupSelectionByMailbox(rows, new Set(["t1", "gone"]));

	assert.deepEqual(groups, [{ mailboxId: "mbx-a", threadIds: ["t1"] }]);
});

test("groupSelectionByMailbox returns an empty list for an empty selection", () => {
	assert.deepEqual(groupSelectionByMailbox([{ threadId: "t1", mailboxId: "m" }], new Set()), []);
});

test("sumUnreadByKind adds up unread totals across accounts per kind", () => {
	const mailboxes = [
		{ id: "mbx-a", kind: "inbox" },
		{ id: "mbx-b", kind: "inbox" },
		{ id: "mbx-c", kind: "spam" },
	];
	const counts = new Map([
		["mbx-a", { unreadThreads: 2, unreadTotal: 5 }],
		["mbx-b", { unreadThreads: 1, unreadTotal: 3 }],
		["mbx-c", { unreadThreads: 1, unreadTotal: 1 }],
	]);

	assert.deepEqual(sumUnreadByKind(mailboxes, counts), { inbox: 8, spam: 1 });
});

test("sumUnreadByKind omits kinds with no counted mailbox", () => {
	const mailboxes = [{ id: "mbx-a", kind: "inbox" }];

	assert.deepEqual(sumUnreadByKind(mailboxes, new Map()), {});
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx tsx --test apps/web/lib/unified-mailbox.test.ts`
Expected: FAIL — the module `./unified-mailbox` does not exist.

- [ ] **Step 3: Write the implementation**

Create `apps/web/lib/unified-mailbox.ts`:

```ts
import type { IdentityEntity, MailboxEntity, MailboxSyncEntity } from "@db";

export const UNIFIED_MAILBOX_KINDS = [
	"inbox",
	"sent",
	"spam",
	"trash",
] as const;

export type UnifiedMailboxKind = (typeof UNIFIED_MAILBOX_KINDS)[number];

export function isUnifiedMailboxKind(
	value: string,
): value is UnifiedMailboxKind {
	return (UNIFIED_MAILBOX_KINDS as readonly string[]).includes(value);
}

/**
 * A thread row knows which mailbox it belongs to, but not which account that
 * mailbox is on, nor whether that account propagates changes over IMAP. In a
 * unified list every row can answer those differently, so each row resolves its
 * own context instead of sharing one.
 */
export type MailboxContext = {
	mailbox: MailboxEntity;
	identity: IdentityEntity;
	sync: MailboxSyncEntity | null;
};

export type MailboxContextMap = Record<string, MailboxContext>;

export function resolveRowMailbox(
	mailboxById: MailboxContextMap,
	row: { mailboxId: string },
): MailboxContext | null {
	return mailboxById[row.mailboxId] ?? null;
}

/**
 * Selection state is keyed by threadId alone, but every action needs the
 * mailboxId that owns the thread. Grouping here lets the caller fire one
 * action call per account for a selection that spans several.
 */
export function groupSelectionByMailbox(
	rows: ReadonlyArray<{ threadId: string; mailboxId: string }>,
	selectedIds: ReadonlySet<string>,
): Array<{ mailboxId: string; threadIds: string[] }> {
	const byMailbox = new Map<string, string[]>();

	for (const row of rows) {
		if (!selectedIds.has(row.threadId)) continue;

		const bucket = byMailbox.get(row.mailboxId);
		if (bucket) bucket.push(row.threadId);
		else byMailbox.set(row.mailboxId, [row.threadId]);
	}

	return [...byMailbox].map(([mailboxId, threadIds]) => ({
		mailboxId,
		threadIds,
	}));
}

export function sumUnreadByKind(
	mailboxes: ReadonlyArray<{ id: string; kind: string }>,
	unreadCounts: ReadonlyMap<
		string,
		{ unreadThreads: number; unreadTotal: number }
	>,
): Record<string, number> {
	const totals: Record<string, number> = {};

	for (const mailbox of mailboxes) {
		const counts = unreadCounts.get(mailbox.id);
		if (!counts) continue;
		totals[mailbox.kind] = (totals[mailbox.kind] ?? 0) + counts.unreadTotal;
	}

	return totals;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx tsx --test apps/web/lib/unified-mailbox.test.ts`
Expected: PASS — 10 tests, 0 fail.

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/unified-mailbox.ts apps/web/lib/unified-mailbox.test.ts
git commit -m "feat(mail): add pure helpers for per-row mailbox resolution"
```

---

### Task 2: Unified query layer

**Files:**
- Create: `apps/web/lib/actions/unified-mailbox.ts`

**Interfaces:**
- Consumes: `UnifiedMailboxKind`, `MailboxContextMap` from Task 1.
- Produces:
  - `fetchUnifiedThreads(kind: UnifiedMailboxKind, page: number): Promise<MailboxThreadEntity[]>`
  - `fetchUnifiedMailboxContext(kind: UnifiedMailboxKind): Promise<MailboxContextMap>`
  - `fetchUnifiedThreadCount(kind: UnifiedMailboxKind): Promise<number>`

This task has no unit test: the functions require an authenticated RLS session and a live database, and the repo has no database test harness. Verification is an `EXPLAIN ANALYZE` against the running Postgres (Step 2) plus the UI check in Task 5. Do not fabricate a unit test that mocks Drizzle — it would assert nothing real.

- [ ] **Step 1: Write the implementation**

Create `apps/web/lib/actions/unified-mailbox.ts`:

```ts
"use server";

import { cache } from "react";
import { rlsClient } from "@/lib/actions/clients";
import { identities, mailboxes, mailboxSync, mailboxThreads } from "@db";
import { and, count, desc, eq, isNull, lte, or, sql } from "drizzle-orm";
import { PAGE_SIZE } from "@common/mail-client";
import type {
	MailboxContextMap,
	UnifiedMailboxKind,
} from "@/lib/unified-mailbox";

// Mirrors the ordering fetchMailboxThreads uses, so a unified list and a
// per-account list agree on what "most recent" means.
const effectiveActivityAt = sql`
	COALESCE(${mailboxThreads.unsnoozedAt}, ${mailboxThreads.lastActivityAt})
`;

function notSnoozed(now: Date) {
	return or(
		isNull(mailboxThreads.snoozedUntil),
		lte(mailboxThreads.snoozedUntil, now),
	);
}

export const fetchUnifiedThreads = async (
	kind: UnifiedMailboxKind,
	page: number,
) => {
	const rls = await rlsClient();
	const now = new Date();
	const safePage = page && page > 0 ? page : 1;

	// Joined on kind rather than filtered on mailboxSlug: slugs come from the
	// provider's folder names, so one account's Spam is "junk" and another's
	// is "spam". A slug filter would drop accounts without any error.
	const rows = await rls((tx) =>
		tx
			.select({ thread: mailboxThreads })
			.from(mailboxThreads)
			.innerJoin(mailboxes, eq(mailboxThreads.mailboxId, mailboxes.id))
			.where(and(eq(mailboxes.kind, kind), notSnoozed(now)))
			.orderBy(
				desc(effectiveActivityAt),
				desc(mailboxThreads.lastActivityAt),
				desc(mailboxThreads.threadId),
			)
			.offset((safePage - 1) * PAGE_SIZE)
			.limit(PAGE_SIZE),
	);

	return rows.map((r) => r.thread);
};

export const fetchUnifiedMailboxContext = cache(
	async (kind: UnifiedMailboxKind): Promise<MailboxContextMap> => {
		const rls = await rlsClient();

		const rows = await rls((tx) =>
			tx
				.select({
					mailbox: mailboxes,
					identity: identities,
					sync: mailboxSync,
				})
				.from(mailboxes)
				.innerJoin(identities, eq(mailboxes.identityId, identities.id))
				.leftJoin(mailboxSync, eq(mailboxSync.mailboxId, mailboxes.id))
				.where(and(eq(mailboxes.kind, kind), eq(identities.kind, "email"))),
		);

		const mailboxById: MailboxContextMap = {};

		for (const row of rows) {
			mailboxById[row.mailbox.id] = {
				mailbox: row.mailbox,
				identity: row.identity,
				sync: row.sync ?? null,
			};
		}

		return mailboxById;
	},
);

export const fetchUnifiedThreadCount = cache(
	async (kind: UnifiedMailboxKind) => {
		const rls = await rlsClient();
		const now = new Date();

		const [row] = await rls((tx) =>
			tx
				.select({ total: count() })
				.from(mailboxThreads)
				.innerJoin(mailboxes, eq(mailboxThreads.mailboxId, mailboxes.id))
				.where(and(eq(mailboxes.kind, kind), notSnoozed(now))),
		);

		return Number(row?.total ?? 0);
	},
);
```

- [ ] **Step 2: Check the query plan against the live database**

Open a psql shell in the database container (this host needs `sudo` for docker):

```bash
sudo docker compose -f db/docker-compose.yml exec -T postgres psql -U postgres -d kurrier
```

Run the plan check, which mirrors `fetchUnifiedThreads` exactly:

```sql
EXPLAIN ANALYZE
SELECT mt.*
FROM mailbox_threads mt
JOIN mailboxes mb ON mb.id = mt.mailbox_id
WHERE mb.kind = 'inbox'
  AND (mt.snoozed_until IS NULL OR mt.snoozed_until <= now())
ORDER BY COALESCE(mt.unsnoozed_at, mt.last_activity_at) DESC,
         mt.last_activity_at DESC,
         mt.thread_id DESC
LIMIT 50 OFFSET 0;
```

Read the output. If it ends in a top-level `Sort` over a full `Seq Scan` of `mailbox_threads` and the actual time is above roughly 100ms, record the plan and add an index migration in this task:

```sql
CREATE INDEX ix_mbth_effective_activity
  ON mailbox_threads (COALESCE(unsnoozed_at, last_activity_at) DESC, last_activity_at DESC, thread_id DESC);
```

If the planner already uses `ix_mbth_mailbox_activity` via a merge over per-mailbox scans, or the table is small enough that the scan is fast, **do not add the index**. Paste the actual plan into the commit message either way, so the decision is recorded rather than assumed.

- [ ] **Step 3: Verify the app still compiles**

Run: `npx tsc --noEmit -p apps/web/tsconfig.json`
Expected: no new errors introduced by this file. (Pre-existing errors elsewhere in the repo are not this task's problem — compare against a run on `HEAD` if unsure.)

- [ ] **Step 4: Commit**

```bash
git add apps/web/lib/actions/unified-mailbox.ts
git commit -m "feat(mail): add cross-account thread queries keyed by mailbox kind"
```

---

### Task 3: Resolve each row's mailbox from its own mailboxId

The behavior-preserving refactor. After this task the app looks and works exactly as before; the difference is that a row's mailbox, identity and sync come from the row rather than from a shared prop. Nothing unified is visible yet.

**Files:**
- Modify: `apps/web/components/mailbox/default/webmail-list-item.tsx`
- Modify: `apps/web/components/mailbox/default/webmail-list.tsx`
- Modify: `apps/web/components/mailbox/default/webmail-list-label-search.tsx`
- Modify: `apps/web/app/[locale]/w/[wPublicId]/dashboard/(unified)/(mail)/mail/[identityPublicId]/[mailboxSlug]/page.tsx`
- Modify: `apps/web/app/[locale]/w/[wPublicId]/dashboard/(unified)/(mail)/mail/[identityPublicId]/snoozed/page.tsx`
- Modify: `apps/web/app/[locale]/w/[wPublicId]/dashboard/(unified)/(mail)/mail/[identityPublicId]/[mailboxSlug]/search/page.tsx`
- Modify: `apps/web/app/[locale]/w/[wPublicId]/dashboard/(unified)/(mail)/mail/[identityPublicId]/[mailboxSlug]/label/[labelSlug]/page.tsx`

**Interfaces:**
- Consumes: `resolveRowMailbox`, `MailboxContextMap` from Task 1.
- Produces:
  - `WebmailListItem` props become `{ mailboxThreadItem, mailboxById, globalLabels, labelsByThreadId, workspacePublicId }` — `activeMailbox`, `identityPublicId` and `mailboxSync` are removed.
  - `WebmailList` and `WebmailListLabelSearch` both gain a required `mailboxById: MailboxContextMap` prop and keep `activeMailbox` (still used for the header and the empty-state label).

- [ ] **Step 1: Change `WebmailListItem` to resolve its own context**

In `webmail-list-item.tsx`, replace the props type and destructuring:

```tsx
import { resolveRowMailbox, type MailboxContextMap } from "@/lib/unified-mailbox";

type Props = {
	mailboxThreadItem: FetchMailboxThreadsResult[number];
	mailboxById: MailboxContextMap;
	globalLabels: FetchLabelsResult;
	labelsByThreadId: FetchMailboxThreadLabelsResult;
	workspacePublicId?: string;
};

export default function WebmailListItem({
	mailboxThreadItem,
	mailboxById,
	globalLabels,
	labelsByThreadId,
	workspacePublicId,
}: Props) {
```

Immediately after the destructuring, resolve the row's own context. Place this above every other hook-free statement but below the `formatDateLabel` / `formatRelative` / `getThreadTimeLabel` function declarations, and **before** the first `use*` hook call so the early return does not sit between hooks:

```tsx
	const rowContext = resolveRowMailbox(mailboxById, mailboxThreadItem);
	const rowMailbox = rowContext?.mailbox ?? null;
	const rowSync = rowContext?.sync ?? null;
	const rowIdentityPublicId = mailboxThreadItem.identityPublicId;
```

- [ ] **Step 2: Replace every `activeMailbox` and `mailboxSync` reference in the row**

There are six `!!mailboxSync` call sites and eight `activeMailbox.*` reads. Apply these substitutions throughout `webmail-list-item.tsx`:

| Before | After |
| --- | --- |
| `activeMailbox.id` | `rowMailbox.id` |
| `activeMailbox.kind` | `rowMailbox.kind` |
| `activeMailbox.slug` | `rowMailbox.slug` |
| `identityPublicId` | `rowIdentityPublicId` |
| `!!mailboxSync` | `!!rowSync` |

Guard the render on a resolved context. Put this immediately before the existing `if (isPending(...)) return null;` line, so it sits after all hooks have run:

```tsx
	// A row whose mailbox is missing from the map cannot be acted on safely —
	// every action needs a mailboxId, and guessing one would act on the wrong
	// account. Drop the row instead.
	if (!rowMailbox) return null;
```

TypeScript will still narrow `rowMailbox` to non-null only after this guard, so leave the `rowMailbox.id` reads below it. For the two reads that happen *above* the guard — `formatParticipants(..., activeMailbox.kind)` and `primaryParticipant(..., activeMailbox.kind)` — use `rowMailbox?.kind ?? "inbox"`.

- [ ] **Step 3: Pass `mailboxById` from both list containers**

In `webmail-list.tsx`, add the prop to `WebListProps`:

```tsx
	mailboxById: MailboxContextMap;
```

destructure it, and change the row render:

```tsx
							{mailboxThreads.map((mailboxThreadItem) => (
								<WebmailListItem
									key={
										mailboxThreadItem.threadId + mailboxThreadItem.mailboxId
									}
									mailboxThreadItem={mailboxThreadItem}
									workspacePublicId={workspacePublicId}
									mailboxById={mailboxById}
									globalLabels={globalLabels}
									labelsByThreadId={labelsByThreadId}
								/>
							))}
```

Apply the identical change to `webmail-list-label-search.tsx`. Both keep their existing `activeMailbox` prop — it still feeds `MailListHeader` and the "No messages in …" empty state.

- [ ] **Step 4: Build the single-entry map in each per-account page**

In `[mailboxSlug]/page.tsx`, the map is derived from the mailbox promise the page already awaits. Add after `const workspacePublicId = await getWorkspacePublicId()`:

```tsx
	const { activeMailbox, identity, mailboxSync } = await fetchMailboxPromise;
	const mailboxById = {
		[activeMailbox.id]: {
			mailbox: activeMailbox,
			identity,
			sync: mailboxSync ?? null,
		},
	};
```

and pass `mailboxById={mailboxById}` to `<WebmailList />`.

Do the same in `snoozed/page.tsx`, `[mailboxSlug]/search/page.tsx` and `[mailboxSlug]/label/[labelSlug]/page.tsx`, each of which already destructures `activeMailbox` from a `fetchMailbox(...)` call — extend that destructuring to `{ activeMailbox, identity, mailboxSync }` and build the same one-entry map.

Note for `snoozed/page.tsx`: it derives `activeMailbox` from `threads[0]?.mailboxSlug`, which can belong to a *different* account than the one being filtered — the bug recorded in the spec. Building the map from that same mailbox preserves today's behavior for now; it is fixed properly when the snoozed view becomes unified, which is out of scope here. Do not attempt to fix it in this task.

- [ ] **Step 5: Verify the build type-checks**

Run: `npx tsc --noEmit -p apps/web/tsconfig.json`
Expected: no errors referencing `activeMailbox`, `mailboxSync` or `identityPublicId` in the four touched components. If a page still passes a removed prop, TypeScript names it — fix and re-run.

- [ ] **Step 6: Verify behavior is unchanged in the running app**

Start the app (`pnpm dev:web`) and, on a single account, confirm each of these still works: open a thread, star and unstar, mark read and unread, swipe to trash, swipe to mark read, and the hover Trash button. Nothing should look or behave differently — this task is a refactor.

- [ ] **Step 7: Commit**

```bash
git add apps/web/components/mailbox/default/webmail-list-item.tsx \
        apps/web/components/mailbox/default/webmail-list.tsx \
        apps/web/components/mailbox/default/webmail-list-label-search.tsx \
        "apps/web/app/[locale]/w/[wPublicId]/dashboard/(unified)/(mail)/mail/[identityPublicId]"
git commit -m "refactor(mail): resolve each thread row's mailbox from its own id"
```

---

### Task 4: Group bulk actions by mailbox

**Files:**
- Modify: `apps/web/components/mailbox/default/mail-list-header.tsx`

**Interfaces:**
- Consumes: `groupSelectionByMailbox` from Task 1, `MailboxContextMap` from Task 1.
- Produces: `MailListHeader` gains `mailboxById: MailboxContextMap` (required) and `isUnified?: boolean` (default `false`). `activeMailbox` becomes `activeMailbox?: MailboxEntity | null`. `identity?: IdentityEntity` is unchanged — the unified view derives its identity list from `mailboxById` instead (Step 5), so no array prop is introduced.

- [ ] **Step 1: Add the new props**

Replace the component's props type in `mail-list-header.tsx`:

```tsx
function MailListHeader({
	mailboxThreads,
	mailboxSync,
	publicConfig,
	identityMailboxes,
	activeMailbox,
	identity,
	mailboxById,
	isUnified = false,
}: {
	mailboxThreads: FetchMailboxThreadsResult;
	publicConfig: PublicConfig;
	identityMailboxes: FetchIdentityMailboxListResult;
	activeMailbox?: MailboxEntity | null;
	mailboxSync?: MailboxSyncEntity;
	identity?: IdentityEntity;
	mailboxById: MailboxContextMap;
	isUnified?: boolean;
}) {
```

and import the helper:

```tsx
import { groupSelectionByMailbox, type MailboxContextMap } from "@/lib/unified-mailbox";
```

- [ ] **Step 2: Add a grouped dispatch helper**

Add this inside the component, after `clearSelection` is defined:

```tsx
	// A selection can span accounts, and every action takes a single mailboxId.
	// Fan out one call per mailbox, each carrying that account's own sync flag.
	const forEachSelectedGroup = async (
		run: (group: { mailboxId: string; threadIds: string[]; imap: boolean }) => Promise<unknown>,
	) => {
		const selected = state?.selectedThreadIds ?? new Set<string>();
		const groups = groupSelectionByMailbox(mailboxThreads, selected);

		await Promise.all(
			groups.map((group) =>
				run({
					mailboxId: group.mailboxId,
					threadIds: group.threadIds,
					imap: !!mailboxById[group.mailboxId]?.sync,
				}),
			),
		);
	};
```

- [ ] **Step 3: Rewrite the three bulk handlers to use it**

Replace the bodies of `markRead`, `deleteThreads` and `removeTrash`:

```tsx
	const [markingRead, setMarkingRead] = useState(false);
	const markRead = async () => {
		try {
			setMarkingRead(true);
			await forEachSelectedGroup(({ mailboxId, threadIds, imap }) =>
				markAsRead(threadIds, mailboxId, imap, true, pathName),
			);
			clearSelection();
			router.refresh();
		} catch {
			toast.error("Failed to mark as read", { position: "bottom-left" });
		} finally {
			setMarkingRead(false);
		}
	};
```

```tsx
	const [bulkDeleting, setBulkDeleting] = useState(false);
	const deleteThreads = async () => {
		if (viewKind === "trash") {
			await removeTrash();
			return;
		}
		const count = state?.selectedThreadIds?.size ?? 0;
		const toastId = toast.loading(
			count > 1 ? `Moving ${count} messages to Trash…` : "Moving message to Trash…",
			{ position: "bottom-left" },
		);
		try {
			setBulkDeleting(true);
			await forEachSelectedGroup(({ mailboxId, threadIds, imap }) =>
				moveToTrash(threadIds, mailboxId, imap, true, undefined, pathName),
			);
			clearSelection();
			router.refresh();
			toast.success("Messages moved to Trash", { id: toastId, position: "bottom-left" });
		} catch {
			toast.error("Failed to move messages to Trash", { id: toastId, position: "bottom-left" });
		} finally {
			setBulkDeleting(false);
		}
	};

	const removeTrash = async () => {
		const count = state?.selectedThreadIds?.size ?? 0;
		const toastId = toast.loading(
			count > 1 ? `Deleting ${count} messages forever…` : "Deleting message forever…",
			{ position: "bottom-left" },
		);
		try {
			setBulkDeleting(true);
			await forEachSelectedGroup(({ mailboxId, threadIds, imap }) =>
				deleteForever(threadIds, mailboxId, imap, true, undefined, pathName),
			);
			clearSelection();
			router.refresh();
			toast.success("Thread deleted forever", { id: toastId, position: "bottom-left" });
		} catch {
			toast.error("Failed to delete thread", { id: toastId, position: "bottom-left" });
		} finally {
			setBulkDeleting(false);
		}
	};
```

`viewKind` referenced above replaces the existing `mailboxKind` ref, which assumed a single mailbox. Define it near the top of the component:

```tsx
	// In a unified view every row shares the same kind (the route picks one),
	// so the first resolved row is representative.
	const viewKind =
		activeMailbox?.kind ??
		mailboxById[mailboxThreads[0]?.mailboxId ?? ""]?.mailbox.kind ??
		"inbox";
```

Delete the now-unused `mailboxKind` ref and its assignment in the existing `useEffect`.

- [ ] **Step 4: Hide the two affordances that have no unified meaning**

`emptyTrash` acts on one mailbox and cannot be grouped — emptying every account's trash from one button is not a behavior this feature offers. Leave the function as-is (it still uses `mailboxIdRef` for the per-account case) and gate its trigger in the JSX on `!isUnified`. Do the same for the `<MoveToFolder />` element, whose destination list belongs to a single account.

Find the `<MoveToFolder ... />` usage near line 299 and the Empty Trash trigger in the returned JSX, and wrap each:

```tsx
{!isUnified && (
	/* existing element unchanged */
)}
```

- [ ] **Step 5: Make Sync run across every account in a unified view**

Replace the body of `reload` so it syncs each identity present in the view:

```tsx
	const reload = async () => {
		try {
			setReloading(true);

			const identityIds = isUnified
				? [
						...new Set(
							Object.values(mailboxById).map((c) => c.identity.id),
						),
					]
				: [identityIdRef.current].filter(Boolean) as string[];

			await Promise.all(identityIds.map((id) => deltaFetch({ identityId: id })));
			await revalidateMailbox(pathName);
			router.refresh();
			toast.success("Mailbox synced", { position: "bottom-left" });
		} catch {
			toast.error("Sync failed", { position: "bottom-left" });
		} finally {
			setReloading(false);
		}
	};
```

Gate the Gmail Resync button on `!isUnified` as well — it targets one Google account.

- [ ] **Step 6: Pass the new props from both containers**

In `webmail-list.tsx` and `webmail-list-label-search.tsx`, add `mailboxById={mailboxById}` to the `<MailListHeader />` element. Leave `isUnified` unset; it defaults to `false`.

- [ ] **Step 7: Verify**

Run: `npx tsc --noEmit -p apps/web/tsconfig.json`
Expected: no errors.

Then in the running app, on a single account: select three threads, mark them read, confirm all three change. Select two and move to Trash, confirm both move. In Trash, select two and delete forever, confirm both go. Behavior must be identical to before.

- [ ] **Step 8: Commit**

```bash
git add apps/web/components/mailbox/default/mail-list-header.tsx \
        apps/web/components/mailbox/default/webmail-list.tsx \
        apps/web/components/mailbox/default/webmail-list-label-search.tsx
git commit -m "refactor(mail): dispatch bulk thread actions per owning mailbox"
```

---

### Task 5: The unified list route

First task with something visible. After it, `/mail/all/inbox` works.

**Files:**
- Create: `apps/web/app/[locale]/w/[wPublicId]/dashboard/(unified)/(mail)/mail/all/[mailboxKind]/page.tsx`
- Modify: `apps/web/components/mailbox/default/webmail-list.tsx`
- Modify: `apps/web/components/mailbox/default/webmail-list-item.tsx`

**Interfaces:**
- Consumes: Tasks 1–4 in full.
- Produces: route `/w/{wPublicId}/dashboard/mail/all/{kind}` for `kind ∈ {inbox, sent, spam, trash}`.

- [ ] **Step 1: Make the two single-mailbox props optional in the container**

`WebmailList` currently requires `fetchMailboxPromise`, which does not exist for a unified view. Change its props so the unified page can omit it:

```tsx
type WebListProps = {
	mailboxThreadPromise: Promise<{ mailboxThreads: FetchMailboxThreadsResult, labelsByThreadId: FetchMailboxThreadLabelsResult }>;
	publicConfig: PublicConfig;
	mailboxById: MailboxContextMap;
	identityMailboxesPromise: Promise<FetchIdentityMailboxListResult>;
	fetchMailboxPromise?: Promise<FetchMailboxResult>;
	globalLabelsPromise: Promise<FetchLabelsResult>;
	workspacePublicId?: string;
	emptyLabel?: string;
	isUnified?: boolean;
};
```

and inside, replace the single `use(fetchMailboxPromise)` destructuring:

```tsx
	const mailboxResult = fetchMailboxPromise ? use(fetchMailboxPromise) : null;
	const activeMailbox = mailboxResult?.activeMailbox ?? null;
	const mailboxSync = mailboxResult?.mailboxSync ?? null;
	const identity = mailboxResult?.identity;
```

Change the empty state to use a label that works for both shapes:

```tsx
					<div className="p-4 text-center text-base text-muted-foreground">
						No messages in{" "}
						<span className={"lowercase"}>
							{emptyLabel ?? activeMailbox?.name ?? "this mailbox"}
						</span>
					</div>
```

and pass `isUnified={isUnified}` through to `<MailListHeader />`. Remove `activeMailbox` from the `DynamicContextProvider` initial state — nothing reads it now that the header takes `mailboxById` — and drop `identityPublicId` from it too, replacing that initial state with `{ selectedThreadIds: new Set() }`.

- [ ] **Step 2: Show which account each row belongs to**

In `webmail-list-item.tsx`, add an `showAccount?: boolean` prop (default `false`), and render the account next to the participants line. Inside the `<div className="flex min-w-0 items-baseline gap-2">` block, immediately after the `<span className="min-w-0 flex-1 truncate">{allNames}</span>` line:

```tsx
						{showAccount && (
							<span
								className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] font-normal text-muted-foreground"
								title={rowContext?.identity.value ?? ""}
							>
								{rowContext?.identity.value}
							</span>
						)}
```

Pass `showAccount={isUnified}` from `webmail-list.tsx`'s row render.

- [ ] **Step 3: Create the route**

Create `apps/web/app/[locale]/w/[wPublicId]/dashboard/(unified)/(mail)/mail/all/[mailboxKind]/page.tsx`:

```tsx
import { notFound } from "next/navigation";
import { getPublicEnv } from "@schema";
import { getWorkspacePublicId } from "@/lib/actions/clients";
import { fetchIdentityMailboxList } from "@/lib/actions/mailbox";
import {
	fetchUnifiedMailboxContext,
	fetchUnifiedThreads,
} from "@/lib/actions/unified-mailbox";
import { fetchLabels, fetchMailboxThreadLabels } from "@/lib/actions/labels";
import { isUnifiedMailboxKind } from "@/lib/unified-mailbox";
import WebmailList from "@/components/mailbox/default/webmail-list";

const TITLE: Record<string, string> = {
	inbox: "Inbox",
	sent: "Sent",
	spam: "Spam",
	trash: "Trash",
};

export default async function Page({
	params,
	searchParams,
}: {
	params: Promise<{ mailboxKind: string }>;
	searchParams: Promise<{ page?: string }>;
}) {
	const { mailboxKind } = await params;
	const { page } = await searchParams;

	if (!isUnifiedMailboxKind(mailboxKind)) notFound();

	const publicConfig = getPublicEnv();
	const workspacePublicId = await getWorkspacePublicId();
	const mailboxById = await fetchUnifiedMailboxContext(mailboxKind);

	const mailboxThreadPromise = fetchUnifiedThreads(
		mailboxKind,
		Number(page),
	).then(async (mailboxThreads) => {
		const labelsByThreadId = await fetchMailboxThreadLabels(mailboxThreads);
		return { mailboxThreads, labelsByThreadId };
	});

	return (
		<div className="flex flex-1 flex-col gap-4 p-4 mb-12">
			<header className="flex items-center justify-between">
				<h1 className="text-lg font-semibold">
					{TITLE[mailboxKind]} · All accounts
				</h1>
			</header>

			<WebmailList
				mailboxThreadPromise={mailboxThreadPromise}
				publicConfig={publicConfig}
				mailboxById={mailboxById}
				identityMailboxesPromise={fetchIdentityMailboxList()}
				globalLabelsPromise={fetchLabels("thread")}
				workspacePublicId={workspacePublicId}
				emptyLabel={`${TITLE[mailboxKind]} across all accounts`}
				isUnified
			/>
		</div>
	);
}
```

Pagination is deliberately not wired here: `MailPagination` takes a `fetchMailboxPromise` for a single mailbox. Threads beyond the first 50 are reachable once a unified pagination component exists; note this as a known gap in the commit message rather than half-wiring it.

- [ ] **Step 4: Verify in the running app**

Visit `/w/{yourWorkspacePublicId}/dashboard/mail/all/inbox`. Confirm: rows from more than one account appear, ordered newest first; each row shows its account chip; opening a row lands on the correct account's thread view; starring a row from account B stars it on account B; selecting rows from two accounts and marking them read updates both.

Then visit `/w/{ws}/dashboard/mail/all/archive` and confirm it 404s.

- [ ] **Step 5: Commit**

```bash
git add "apps/web/app/[locale]/w/[wPublicId]/dashboard/(unified)/(mail)/mail/all" \
        apps/web/components/mailbox/default/webmail-list.tsx \
        apps/web/components/mailbox/default/webmail-list-item.tsx
git commit -m "feat(mail): add unified inbox/sent/spam/trash route across accounts"
```

---

### Task 6: Sidebar entry point

**Files:**
- Modify: `apps/web/components/dashboard/identity-mailboxes-list.tsx`

**Interfaces:**
- Consumes: `UNIFIED_MAILBOX_KINDS`, `sumUnreadByKind` from Task 1.
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Add the group above the per-account list**

In `identity-mailboxes-list.tsx`, import the helpers:

```tsx
import { UNIFIED_MAILBOX_KINDS, sumUnreadByKind } from "@/lib/unified-mailbox";
```

Inside `IdentityMailboxesList`, above the existing `return (`, compute the totals from data the component already receives:

```tsx
	const unreadByKind = React.useMemo(
		() =>
			sumUnreadByKind(
				identityMailboxes.flatMap(({ mailboxes }) =>
					mailboxes.map((m) => ({ id: m.id, kind: m.kind as string })),
				),
				unreadCounts,
			),
		[identityMailboxes, unreadCounts],
	);
```

Then render the group as the first child inside the outer `<div className="space-y-2 px-2">`, before the existing `<Select>` block:

```tsx
			<div>
				<div className="px-1 mb-1 mt-2 text-xs font-semibold text-sidebar-foreground/60">
					All accounts
				</div>

				<div className="space-y-1">
					{UNIFIED_MAILBOX_KINDS.map((kind) => {
						const Icon = ICON[kind] ?? Folder;
						const href = `/w/${workspacePublicId}/dashboard/mail/all/${kind}`;
						const isActive = pathname === href;
						const unread = unreadByKind[kind] ?? 0;

						return (
							<Link
								key={kind}
								href={href}
								className={cn(
									"group flex items-center gap-2 rounded-md px-2 py-1.5 text-sm",
									"hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
									isActive && "bg-sidebar-accent text-sidebar-accent-foreground",
								)}
							>
								<Icon className="h-4 w-4 shrink-0" />
								<span className="min-w-0 truncate">{TITLE[kind]}</span>
								{unread > 0 && (
									<span className="ml-auto text-xs text-muted-foreground">
										{unread}
									</span>
								)}
							</Link>
						);
					})}
				</div>
			</div>
```

`ICON`, `TITLE`, `cn` and `Link` are already imported in this file.

- [ ] **Step 2: Verify**

Run: `npx tsc --noEmit -p apps/web/tsconfig.json`
Expected: no errors.

In the running app: the sidebar shows "All accounts" above the per-account groups, with four entries. The Inbox badge equals the sum of the per-account Inbox badges. Clicking each entry lands on the matching unified view, and the active entry is highlighted. The per-account groups below are unchanged.

- [ ] **Step 3: Commit**

```bash
git add apps/web/components/dashboard/identity-mailboxes-list.tsx
git commit -m "feat(mail): add All accounts group to the mail sidebar"
```

---

### Task 7: Unified search

**Files:**
- Modify: `packages/schema/src/types/search.ts`
- Modify: `apps/web/lib/actions/mailbox.ts` (extract the shared `searchMessages` helper out of `initSearch`)
- Modify: `apps/web/lib/actions/unified-mailbox.ts` (add the unified search entry points)
- Create: `apps/web/app/[locale]/w/[wPublicId]/dashboard/(unified)/(mail)/mail/all/[mailboxKind]/search/page.tsx`

**Interfaces:**
- Consumes: `fetchUnifiedMailboxContext` from Task 2, `isUnifiedMailboxKind` from Task 1, `WebmailListLabelSearch` as modified in Task 3.
- Produces:
  - `ThreadHit` gains `mailboxId: string` and `identityPublicId: string`.
  - `searchMessages(filters: string[], q: string, page: number): Promise<SearchThreadsResponse>` — exported from `mailbox.ts`, shared by both searches.
  - `initUnifiedSearch(query, workspacePublicId, kind, hasAttachment, onlyUnread, starred, page): Promise<SearchThreadsResponse>`
  - `fetchThreadsByMailboxPairs(pairs: Array<{ threadId: string; mailboxId: string }>): Promise<MailboxThreadEntity[]>`

- [ ] **Step 1: Surface the two fields that are already indexed**

In `packages/schema/src/types/search.ts`, add to the `ThreadHit` interface:

```ts
	mailboxId: string;
	identityPublicId: string;
```

Both are already written into the document by `rowToDoc` and declared in the collection schema (`mailboxId` is `facet: true`, so it is filterable), which is why no reindex is needed.

The mapping that populates these two fields is added in Step 2, where the hit-mapping code becomes a shared helper. Making the interface change here first means Step 2's helper is type-checked against it.

- [ ] **Step 2: Add the unified search action**

Append to `apps/web/lib/actions/unified-mailbox.ts`:

```ts
export const initUnifiedSearch = async (
	query: string,
	workspacePublicId: string,
	kind: UnifiedMailboxKind,
	hasAttachment: boolean,
	onlyUnread: boolean,
	starred: boolean,
	page: number,
): Promise<SearchThreadsResponse> => {
	const q = query.trim();
	if (!q) return { items: [], totalThreads: 0, totalMessages: 0 };

	// The indexed document has no "kind" field, only a provider-derived slug.
	// Resolve the concrete mailbox ids for this kind and filter on those, so
	// the search covers exactly the folders the unified list shows.
	const mailboxById = await fetchUnifiedMailboxContext(kind);
	const mailboxIds = Object.keys(mailboxById);
	if (!mailboxIds.length) return { items: [], totalThreads: 0, totalMessages: 0 };

	const filters = [
		`workspacePublicId:=${JSON.stringify(workspacePublicId)}`,
		`mailboxId:=[${mailboxIds.map((id) => JSON.stringify(id)).join(",")}]`,
	];

	if (hasAttachment) filters.push("hasAttachment:=1");
	if (onlyUnread) filters.push("unread:=1");
	if (starred) filters.push("starred:=1");

	return searchMessages(filters, q, page);
};
```

`searchMessages(filters, q, page)` is the Typesense call and hit mapping currently inlined in `initSearch` ([`mailbox.ts:500-536`](../../../apps/web/lib/actions/mailbox.ts)). Move it into an exported helper in `mailbox.ts` and have `initSearch` call it too, so the two searches cannot drift in how they map hits. Add to `apps/web/lib/actions/mailbox.ts`:

```ts
export const searchMessages = async (
	filters: string[],
	q: string,
	page: number,
): Promise<SearchThreadsResponse> => {
	const client = getTypeSenseClient();

	const result = (await client.collections("messages").documents().search({
		q,
		query_by: "subject,html,text,snippet,fromName,fromEmail,participants",
		filter_by: filters.join(" && "),
		sort_by: "createdAt:desc",
		group_by: "threadId",
		group_limit: 1,
		per_page: PAGE_SIZE,
		page,
	})) as any;

	const groups = result?.grouped_hits as
		| Array<{ group_key: string[]; hits: Array<{ document: any }> }>
		| undefined;

	const sourceHits = groups?.length
		? groups.map((g) => g.hits[0]?.document ?? {})
		: (result?.hits ?? []).map((h: any) => h.document ?? {});

	return {
		items: sourceHits.map((d: any) => ({
			id: d.id ?? "",
			threadId: d.threadId ?? "",
			mailboxId: d.mailboxId ?? "",
			identityPublicId: d.identityPublicId ?? "",
			subject: d.subject ?? null,
			snippet: (d.snippet ?? d.text ?? "").slice(0, 200),
			fromName: d.fromName ?? null,
			fromEmail: d.fromEmail ?? null,
			participants: Array.isArray(d.participants) ? d.participants : [],
			labels: Array.isArray(d.labels) ? d.labels : [],
			hasAttachment: Number(d.hasAttachment) === 1,
			unread: Number(d.unread) === 1,
			starred: Number(d.starred) === 1,
			createdAt: d.createdAt ?? 0,
			lastInThreadAt: d.lastInThreadAt ?? d.createdAt ?? 0,
		})),
		totalThreads: result?.found ?? sourceHits.length,
		totalMessages: result?.found_docs ?? sourceHits.length,
	};
};
```

Then reduce `initSearch` to building its three filters and delegating:

```ts
	const filters = [
		`workspacePublicId:=${JSON.stringify(workspacePublicId)}`,
		`identityPublicId:=${JSON.stringify(identityPublicId)}`,
		`mailboxSlug:=${JSON.stringify(mailboxSlug)}`,
	];

	if (hasAttachment) filters.push("hasAttachment:=1");
	if (onlyUnread) filters.push("unread:=1");
	if (starred) filters.push("starred:=1");

	return searchMessages(filters, q, page);
```

This makes Step 1's mapping edit redundant — the two new fields are added once, here, in the shared helper. Do Step 1's `ThreadHit` interface change, but skip its `initSearch` mapping edit.

`apps/web/lib/actions/unified-mailbox.ts` needs two imports added for this step:

```ts
import type { SearchThreadsResponse } from "@schema";
import { searchMessages } from "@/lib/actions/mailbox";
```

- [ ] **Step 3: Add pair-wise hydration**

Search returns hits from several accounts, so hydration can no longer take a single mailbox id. Append to `apps/web/lib/actions/unified-mailbox.ts`:

```ts
export const fetchThreadsByMailboxPairs = async (
	pairs: Array<{ threadId: string; mailboxId: string }>,
) => {
	if (!pairs.length) return [];

	const rls = await rlsClient();

	const rows = await rls((tx) =>
		tx
			.select()
			.from(mailboxThreads)
			.where(
				or(
					...pairs.map((p) =>
						and(
							eq(mailboxThreads.threadId, p.threadId),
							eq(mailboxThreads.mailboxId, p.mailboxId),
						),
					),
				),
			),
	);

	// Preserve the relevance order the search engine returned.
	const rank = new Map(pairs.map((p, i) => [`${p.threadId}:${p.mailboxId}`, i]));
	rows.sort(
		(a, b) =>
			(rank.get(`${a.threadId}:${a.mailboxId}`) ?? Number.MAX_SAFE_INTEGER) -
			(rank.get(`${b.threadId}:${b.mailboxId}`) ?? Number.MAX_SAFE_INTEGER),
	);

	return rows;
};
```

- [ ] **Step 4: Create the unified search route**

Create `apps/web/app/[locale]/w/[wPublicId]/dashboard/(unified)/(mail)/mail/all/[mailboxKind]/search/page.tsx`:

```tsx
import { notFound } from "next/navigation";
import { getPublicEnv, type ThreadHit } from "@schema";
import { getWorkspacePublicId } from "@/lib/actions/clients";
import { fetchIdentityMailboxList } from "@/lib/actions/mailbox";
import {
	fetchThreadsByMailboxPairs,
	fetchUnifiedMailboxContext,
	initUnifiedSearch,
} from "@/lib/actions/unified-mailbox";
import { fetchLabels, fetchMailboxThreadLabels } from "@/lib/actions/labels";
import { isUnifiedMailboxKind } from "@/lib/unified-mailbox";
import WebmailListLabelSearch from "@/components/mailbox/default/webmail-list-label-search";

export default async function Page({
	params,
	searchParams,
}: {
	params: Promise<{ mailboxKind: string }>;
	searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
	const { mailboxKind } = await params;
	if (!isUnifiedMailboxKind(mailboxKind)) notFound();

	const sp = await searchParams;
	const q = (sp.q as string) ?? "";
	const has = (sp.has as string) === "1";
	const unread = (sp.unread as string) === "1";
	const starred = (sp.starred as string) === "1";
	const page = Math.max(1, Number((sp.page as string) ?? 1));

	const workspacePublicId = await getWorkspacePublicId();
	if (!workspacePublicId) {
		return (
			<div className="p-4 text-sm text-muted-foreground">
				Missing workspace context.
			</div>
		);
	}

	const publicConfig = await getPublicEnv();
	const mailboxById = await fetchUnifiedMailboxContext(mailboxKind);

	let items: ThreadHit[] = [];
	let totalThreads = 0;
	let totalMessages = 0;

	if (q.trim()) {
		const res = await initUnifiedSearch(
			q,
			workspacePublicId,
			mailboxKind,
			has,
			unread,
			starred,
			page,
		);
		items = res.items ?? [];
		totalThreads = res.totalThreads ?? items.length;
		totalMessages = res.totalMessages ?? items.length;
	}

	const threads = await fetchThreadsByMailboxPairs(
		items.map((i) => ({ threadId: i.threadId, mailboxId: i.mailboxId })),
	);

	const labelsByThreadId =
		threads.length > 0 ? await fetchMailboxThreadLabels(threads) : {};

	return (
		<div className="p-4 space-y-4">
			<header className="flex items-center justify-between">
				<h1 className="text-lg font-semibold">Search · All accounts</h1>
				<div className="text-sm text-muted-foreground">
					{q.trim()
						? `Threads: ${totalThreads} • Messages: ${totalMessages}`
						: "Type a query to search"}
				</div>
			</header>

			{!q.trim() ? (
				<div className="text-sm text-muted-foreground">
					Use the search box above to run a query.
				</div>
			) : threads.length === 0 ? (
				<div className="text-sm text-muted-foreground">No results found.</div>
			) : (
				<WebmailListLabelSearch
					mailboxThreads={threads}
					publicConfig={publicConfig}
					workspacePublicId={workspacePublicId}
					mailboxById={mailboxById}
					identityMailboxes={await fetchIdentityMailboxList()}
					globalLabels={await fetchLabels("thread")}
					labelsByThreadId={labelsByThreadId}
					isUnified
				/>
			)}
		</div>
	);
}
```

This requires `WebmailListLabelSearch` to accept the same optional shape `WebmailList` got in Task 5: make its `activeMailbox` prop optional, add `isUnified?: boolean` and `emptyLabel?: string`, and forward `isUnified` to both `MailListHeader` and each `WebmailListItem`'s `showAccount`.

- [ ] **Step 5: Verify**

Run: `npx tsc --noEmit -p apps/web/tsconfig.json`
Expected: no errors.

In the running app, visit `/w/{ws}/dashboard/mail/all/inbox/search?q=<term>` with a term you know exists in two different accounts. Confirm: hits from both accounts appear, each row shows its account chip, and opening a hit lands on the right account's thread. Then search a term that exists only in an account's Spam and confirm it does **not** appear under `all/inbox/search` — that is the check that the `mailboxId` filter is doing its job rather than searching every folder.

- [ ] **Step 6: Commit**

```bash
git add packages/schema/src/types/search.ts \
        apps/web/lib/actions/mailbox.ts \
        apps/web/lib/actions/unified-mailbox.ts \
        apps/web/components/mailbox/default/webmail-list-label-search.tsx \
        "apps/web/app/[locale]/w/[wPublicId]/dashboard/(unified)/(mail)/mail/all"
git commit -m "feat(mail): search across all connected accounts for one mailbox kind"
```

---

## Known gaps after this plan

State these plainly rather than letting them be discovered:

- **Unified pagination.** The unified list shows the first 50 threads. `MailPagination` and `SearchPagination` are built around a single mailbox and are not wired up. `fetchUnifiedThreadCount` exists for whoever adds it.
- **Empty Trash and Move to folder** are hidden in unified views by design (see "Scope decisions locked here").
- **The snoozed-page `activeMailbox` bug** is preserved, not fixed — fixing it belongs with the unified Snoozed view, which is out of scope.
