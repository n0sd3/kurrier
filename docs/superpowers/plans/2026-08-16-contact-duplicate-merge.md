# Contact Duplicate Detection and Merge Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the user find groups of duplicate contacts and merge each group into one surviving contact, with the merge written back to CardDAV so duplicates do not reappear on the next sync.

**Architecture:** Two pure, unit-tested modules (detection, then merge planning) run over the contacts already loaded client-side — no new queries. A server action applies an approved plan in one RLS transaction and then enqueues the existing `dav:update-contact` / `dav:delete-contact` BullMQ jobs, letting the worker be the single component that deletes from both CardDAV and Postgres.

**Tech Stack:** Next.js 16 (App Router, server actions), Drizzle ORM over Postgres with RLS, BullMQ on Redis (`dav-worker` queue), `node:test` run under `tsx`.

**Spec:** `docs/superpowers/specs/2026-08-15-contact-duplicate-merge-design.md`

## Global Constraints

- All contacts must remain synced with DAV. Never delete a contact from Postgres without the CardDAV card also being deleted.
- Losers are never deleted directly by the web app. Only the worker's `deleteContact` deletes a contact, because it removes the CardDAV card and the Postgres row together.
- Normalization for names, emails and phones reuses `normalizeForSearch` from `apps/web/lib/contact-search.ts`. Do not write a second normalizer.
- Placeholder names (currently exactly `unknown`, compared after normalization) never create a name edge.
- Phone comparison is digits-only and requires at least 8 digits.
- Detection and merge planning are pure functions with no I/O, no database access and no React imports, so they can be tested under plain `node:test`.
- Run tests from the repository root with `node_modules/.bin/tsx --test <path>`.
- Typecheck with `cd apps/web && ./node_modules/.bin/tsc --noEmit -p tsconfig.json`.

## Deliberate refinement from the spec

The spec's `MergePlan` included a `labelIds` field. This plan drops it: label union is done in SQL inside the server action (`INSERT ... SELECT ... ON CONFLICT DO NOTHING` against the `pk_contact_labels` primary key), which is simpler and more robust than round-tripping label ids through the client. The spec's requirement — a favorited duplicate keeps its star — is still met, by Task 3.

## Pre-existing bug found while planning (do not fix in this plan)

`apps/web/app/[locale]/w/[wPublicId]/dashboard/(unified)/(contacts)/contacts/[contactsPublicId]/page.tsx:51-63` enqueues `dav:delete-contact` and *then* deletes the contact locally via RLS. The worker's `deleteContact` starts with a `SELECT` on that contact id and returns early if it is gone, so when the local delete wins the race the CardDAV card survives and `davSyncDb` recreates the contact. This plan deliberately does not repeat that pattern. Fixing the existing delete flow is out of scope — raise it separately.

## File Structure

| File | Responsibility |
| --- | --- |
| `apps/web/lib/contact-duplicates.ts` | Pure detection + merge planning. No I/O. |
| `apps/web/lib/contact-duplicates.test.ts` | Unit tests for the above. |
| `apps/web/lib/actions/contacts-merge.ts` | Server action applying an approved merge plan. |
| `apps/web/components/dashboard/contacts/duplicate-group-card.tsx` | Renders one group and its editable merge plan. |
| `apps/web/app/[locale]/w/[wPublicId]/dashboard/(unified)/(contacts)/contacts/duplicates/page.tsx` | Duplicates view. |
| `apps/web/components/dashboard/contacts/contacts-shell.tsx` | Add link to the Duplicates view. |

---

### Task 1: Duplicate detection

**Files:**
- Create: `apps/web/lib/contact-duplicates.ts`
- Create: `apps/web/lib/contact-duplicates.test.ts`

**Interfaces:**
- Consumes: `normalizeForSearch(value: string): string` from `apps/web/lib/contact-search.ts` (already exported).
- Produces:
  - `type ContactAddress = { country: string | null; streetAddress: string | null; streetAddressLine2: string | null; city: string | null; state: string | null; code: string | null }`
  - `type DuplicateCandidate` (fields listed in Step 3)
  - `type DuplicateReason = "name" | "email" | "phone"`
  - `type DuplicateGroup = { contacts: DuplicateCandidate[]; reasons: DuplicateReason[] }`
  - `findDuplicateGroups(contacts: DuplicateCandidate[]): DuplicateGroup[]`

- [ ] **Step 1: Write the failing test**

Create `apps/web/lib/contact-duplicates.test.ts`:

```ts
import test from "node:test";
import assert from "node:assert/strict";

import {
	findDuplicateGroups,
	type DuplicateCandidate,
} from "./contact-duplicates";

function contact(
	id: string,
	overrides: Partial<DuplicateCandidate> = {},
): DuplicateCandidate {
	return {
		id,
		firstName: id,
		lastName: null,
		company: null,
		jobTitle: null,
		department: null,
		notes: null,
		profilePicture: null,
		profilePictureXs: null,
		createdAt: "2026-01-01T00:00:00.000Z",
		emails: [],
		phones: [],
		addresses: [],
		...overrides,
	};
}

const ids = (group: { contacts: DuplicateCandidate[] }) =>
	group.contacts.map((c) => c.id).sort();

test("groups contacts sharing an identical full name", () => {
	const groups = findDuplicateGroups([
		contact("a", { firstName: "José", lastName: "Silva" }),
		contact("b", { firstName: "jose", lastName: "silva" }),
		contact("c", { firstName: "Ana" }),
	]);

	assert.equal(groups.length, 1);
	assert.deepEqual(ids(groups[0]), ["a", "b"]);
	assert.deepEqual(groups[0].reasons, ["name"]);
});

test("groups contacts sharing an email even when names differ", () => {
	const groups = findDuplicateGroups([
		contact("a", { firstName: "Ana", emails: [{ address: "X@Example.com" }] }),
		contact("b", { firstName: "Bruno", emails: [{ address: "x@example.com" }] }),
	]);

	assert.equal(groups.length, 1);
	assert.deepEqual(ids(groups[0]), ["a", "b"]);
	assert.deepEqual(groups[0].reasons, ["email"]);
});

test("groups contacts sharing a phone regardless of formatting", () => {
	const groups = findDuplicateGroups([
		contact("a", { firstName: "Ana", phones: [{ code: "+55", number: "(11) 99988-7766" }] }),
		contact("b", { firstName: "Bruno", phones: [{ code: null, number: "5511999887766" }] }),
	]);

	assert.equal(groups.length, 1);
	assert.deepEqual(ids(groups[0]), ["a", "b"]);
	assert.deepEqual(groups[0].reasons, ["phone"]);
});

test("ignores phone numbers shorter than 8 digits", () => {
	const groups = findDuplicateGroups([
		contact("a", { firstName: "Ana", phones: [{ code: null, number: "1234" }] }),
		contact("b", { firstName: "Bruno", phones: [{ code: null, number: "1234" }] }),
	]);

	assert.deepEqual(groups, []);
});

test("groups transitively across different rules", () => {
	const groups = findDuplicateGroups([
		contact("a", { firstName: "Ana", lastName: "Lima" }),
		contact("b", { firstName: "Ana", lastName: "Lima", emails: [{ address: "shared@x.com" }] }),
		contact("c", { firstName: "Carlos", emails: [{ address: "shared@x.com" }] }),
	]);

	assert.equal(groups.length, 1);
	assert.deepEqual(ids(groups[0]), ["a", "b", "c"]);
	assert.deepEqual([...groups[0].reasons].sort(), ["email", "name"]);
});

test("does not group placeholder Unknown names", () => {
	const groups = findDuplicateGroups([
		contact("a", { firstName: "Unknown", emails: [{ address: "one@x.com" }] }),
		contact("b", { firstName: "unknown", emails: [{ address: "two@x.com" }] }),
		contact("c", { firstName: "Unknown", emails: [{ address: "three@x.com" }] }),
	]);

	assert.deepEqual(groups, []);
});

test("still groups Unknown contacts that share an email", () => {
	const groups = findDuplicateGroups([
		contact("a", { firstName: "Unknown", emails: [{ address: "same@x.com" }] }),
		contact("b", { firstName: "Unknown", emails: [{ address: "same@x.com" }] }),
	]);

	assert.equal(groups.length, 1);
	assert.deepEqual(ids(groups[0]), ["a", "b"]);
	assert.deepEqual(groups[0].reasons, ["email"]);
});

test("excludes singletons and empty names", () => {
	const groups = findDuplicateGroups([
		contact("a", { firstName: "Ana" }),
		contact("b", { firstName: "Bruno" }),
	]);

	assert.deepEqual(groups, []);
});

test("sorts the largest group first", () => {
	const groups = findDuplicateGroups([
		contact("a", { firstName: "Dup" }),
		contact("b", { firstName: "Dup" }),
		contact("c", { firstName: "Dup" }),
		contact("d", { firstName: "Pair" }),
		contact("e", { firstName: "Pair" }),
	]);

	assert.equal(groups.length, 2);
	assert.equal(groups[0].contacts.length, 3);
	assert.equal(groups[1].contacts.length, 2);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node_modules/.bin/tsx --test apps/web/lib/contact-duplicates.test.ts`
Expected: FAIL with `Cannot find module './contact-duplicates'`

- [ ] **Step 3: Write the implementation**

Create `apps/web/lib/contact-duplicates.ts`:

```ts
import { normalizeForSearch } from "./contact-search";

export type ContactAddress = {
	country: string | null;
	streetAddress: string | null;
	streetAddressLine2: string | null;
	city: string | null;
	state: string | null;
	code: string | null;
};

export type DuplicateCandidate = {
	id: string;
	firstName: string;
	lastName?: string | null;
	company?: string | null;
	jobTitle?: string | null;
	department?: string | null;
	notes?: string | null;
	profilePicture?: string | null;
	profilePictureXs?: string | null;
	createdAt?: string | Date | null;
	emails?: { address: string }[] | null;
	phones?: { code?: string | null; number: string }[] | null;
	addresses?: ContactAddress[] | null;
};

export type DuplicateReason = "name" | "email" | "phone";

export type DuplicateGroup = {
	contacts: DuplicateCandidate[];
	reasons: DuplicateReason[];
};

/** Names that carry no identity, so they must not group contacts together. */
const PLACEHOLDER_NAMES = new Set(["unknown"]);

const MIN_PHONE_DIGITS = 8;

export function nameKey(contact: DuplicateCandidate): string | null {
	const full = normalizeForSearch(
		`${contact.firstName ?? ""} ${contact.lastName ?? ""}`,
	);
	if (!full) return null;
	if (PLACEHOLDER_NAMES.has(full)) return null;
	return full;
}

export function emailKeys(contact: DuplicateCandidate): string[] {
	return (contact.emails ?? [])
		.map((e) => normalizeForSearch(e?.address ?? ""))
		.filter(Boolean);
}

export function phoneKeys(contact: DuplicateCandidate): string[] {
	return (contact.phones ?? [])
		.map((p) => `${p?.code ?? ""}${p?.number ?? ""}`.replace(/\D/g, ""))
		.filter((digits) => digits.length >= MIN_PHONE_DIGITS);
}

const KEY_BUILDERS: Record<
	DuplicateReason,
	(contact: DuplicateCandidate) => string[]
> = {
	name: (c) => {
		const key = nameKey(c);
		return key ? [key] : [];
	},
	email: emailKeys,
	phone: phoneKeys,
};

const REASON_ORDER: DuplicateReason[] = ["name", "email", "phone"];

class UnionFind {
	private parent = new Map<string, string>();

	find(id: string): string {
		const seen = this.parent.get(id);
		if (seen === undefined) {
			this.parent.set(id, id);
			return id;
		}
		if (seen === id) return id;
		const root = this.find(seen);
		this.parent.set(id, root);
		return root;
	}

	union(a: string, b: string): void {
		const rootA = this.find(a);
		const rootB = this.find(b);
		if (rootA !== rootB) this.parent.set(rootA, rootB);
	}
}

/** Buckets contact ids by every key a rule produces for them. */
function keyBuckets(
	contacts: DuplicateCandidate[],
	reason: DuplicateReason,
): Map<string, string[]> {
	const buckets = new Map<string, string[]>();

	for (const contact of contacts) {
		for (const key of KEY_BUILDERS[reason](contact)) {
			const bucket = buckets.get(key);
			if (bucket) bucket.push(contact.id);
			else buckets.set(key, [contact.id]);
		}
	}

	return buckets;
}

export function findDuplicateGroups(
	contacts: DuplicateCandidate[],
): DuplicateGroup[] {
	const unionFind = new UnionFind();
	for (const contact of contacts) unionFind.find(contact.id);

	const bucketsByReason = new Map<DuplicateReason, Map<string, string[]>>();

	for (const reason of REASON_ORDER) {
		const buckets = keyBuckets(contacts, reason);
		bucketsByReason.set(reason, buckets);

		for (const members of buckets.values()) {
			for (let i = 1; i < members.length; i++) {
				unionFind.union(members[0], members[i]);
			}
		}
	}

	const components = new Map<string, DuplicateCandidate[]>();
	for (const contact of contacts) {
		const root = unionFind.find(contact.id);
		const component = components.get(root);
		if (component) component.push(contact);
		else components.set(root, [contact]);
	}

	const groups: DuplicateGroup[] = [];

	for (const members of components.values()) {
		if (members.length < 2) continue;

		const memberIds = new Set(members.map((m) => m.id));
		const reasons = REASON_ORDER.filter((reason) => {
			const buckets = bucketsByReason.get(reason);
			if (!buckets) return false;
			for (const bucketMembers of buckets.values()) {
				const inGroup = bucketMembers.filter((id) => memberIds.has(id));
				if (new Set(inGroup).size > 1) return true;
			}
			return false;
		});

		groups.push({ contacts: members, reasons });
	}

	return groups.sort((a, b) => b.contacts.length - a.contacts.length);
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node_modules/.bin/tsx --test apps/web/lib/contact-duplicates.test.ts`
Expected: PASS, 9 tests

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/contact-duplicates.ts apps/web/lib/contact-duplicates.test.ts
git commit -m "feat: detect duplicate contact groups by name, email and phone"
```

---

### Task 2: Merge planning

**Files:**
- Modify: `apps/web/lib/contact-duplicates.ts` (append)
- Modify: `apps/web/lib/contact-duplicates.test.ts` (append)

**Interfaces:**
- Consumes: `DuplicateCandidate`, `DuplicateGroup`, `ContactAddress` from Task 1.
- Produces:
  - `type ScalarField = "firstName" | "lastName" | "company" | "jobTitle" | "department" | "notes" | "profilePicture" | "profilePictureXs"`
  - `type FieldChoice = { selected: string | null; alternatives: string[] }`
  - `type MergePlan = { survivorId: string; mergedIds: string[]; fields: Record<ScalarField, FieldChoice>; emails: { address: string }[]; phones: { code: string | null; number: string }[]; addresses: ContactAddress[] }`
  - `scoreContact(contact: DuplicateCandidate): number`
  - `buildMergePlan(group: DuplicateGroup): MergePlan`

- [ ] **Step 1: Write the failing test**

Append to `apps/web/lib/contact-duplicates.test.ts`:

```ts
import { buildMergePlan, scoreContact } from "./contact-duplicates";

test("scores a richer contact above a sparser one", () => {
	const rich = contact("rich", {
		firstName: "Ana",
		lastName: "Lima",
		company: "Acme",
		profilePictureXs: "private/u/x_xs.jpg",
		emails: [{ address: "ana@acme.com" }],
	});
	const sparse = contact("sparse", { firstName: "Ana" });

	assert.ok(scoreContact(rich) > scoreContact(sparse));
});

test("picks the richest contact as survivor and unions contact points", () => {
	const plan = buildMergePlan({
		reasons: ["name"],
		contacts: [
			contact("sparse", {
				firstName: "Ana",
				emails: [{ address: "ana.alt@x.com" }],
				phones: [{ code: "+55", number: "11 99988-7766" }],
			}),
			contact("rich", {
				firstName: "Ana",
				lastName: "Lima",
				company: "Acme",
				profilePictureXs: "private/u/x_xs.jpg",
				emails: [{ address: "ana@acme.com" }],
			}),
		],
	});

	assert.equal(plan.survivorId, "rich");
	assert.deepEqual(plan.mergedIds, ["sparse"]);
	assert.deepEqual(
		plan.emails.map((e) => e.address).sort(),
		["ana.alt@x.com", "ana@acme.com"],
	);
	assert.equal(plan.phones.length, 1);
});

test("deduplicates emails case-insensitively and phones by digits", () => {
	const plan = buildMergePlan({
		reasons: ["name"],
		contacts: [
			contact("a", {
				firstName: "Ana",
				emails: [{ address: "Ana@X.com" }],
				phones: [{ code: "+55", number: "(11) 99988-7766" }],
			}),
			contact("b", {
				firstName: "Ana",
				emails: [{ address: "ana@x.com" }],
				phones: [{ code: null, number: "5511999887766" }],
			}),
		],
	});

	assert.equal(plan.emails.length, 1);
	assert.equal(plan.phones.length, 1);
});

test("prefers the survivor's value and lists alternatives", () => {
	const plan = buildMergePlan({
		reasons: ["name"],
		contacts: [
			contact("rich", {
				firstName: "Ana",
				lastName: "Lima",
				company: "Acme",
				emails: [{ address: "a@x.com" }],
			}),
			contact("other", { firstName: "Ana", lastName: "Lima", company: "Globex" }),
		],
	});

	assert.equal(plan.survivorId, "rich");
	assert.equal(plan.fields.company.selected, "Acme");
	assert.deepEqual([...plan.fields.company.alternatives].sort(), ["Acme", "Globex"]);
});

test("falls back to another contact's value when the survivor's is empty", () => {
	const plan = buildMergePlan({
		reasons: ["name"],
		contacts: [
			contact("rich", {
				firstName: "Ana",
				lastName: "Lima",
				emails: [{ address: "a@x.com" }, { address: "b@x.com" }],
			}),
			contact("other", { firstName: "Ana", lastName: "Lima", notes: "met at the fair" }),
		],
	});

	assert.equal(plan.survivorId, "rich");
	assert.equal(plan.fields.notes.selected, "met at the fair");
});

test("breaks score ties toward the oldest contact", () => {
	const plan = buildMergePlan({
		reasons: ["name"],
		contacts: [
			contact("newer", { firstName: "Ana", createdAt: "2026-05-01T00:00:00.000Z" }),
			contact("older", { firstName: "Ana", createdAt: "2024-01-01T00:00:00.000Z" }),
		],
	});

	assert.equal(plan.survivorId, "older");
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node_modules/.bin/tsx --test apps/web/lib/contact-duplicates.test.ts`
Expected: FAIL — `buildMergePlan` and `scoreContact` are not exported

- [ ] **Step 3: Write the implementation**

Append to `apps/web/lib/contact-duplicates.ts`:

```ts
export type ScalarField =
	| "firstName"
	| "lastName"
	| "company"
	| "jobTitle"
	| "department"
	| "notes"
	| "profilePicture"
	| "profilePictureXs";

export type FieldChoice = {
	selected: string | null;
	alternatives: string[];
};

export type MergePlan = {
	survivorId: string;
	mergedIds: string[];
	fields: Record<ScalarField, FieldChoice>;
	emails: { address: string }[];
	phones: { code: string | null; number: string }[];
	addresses: ContactAddress[];
};

const SCALAR_FIELDS: ScalarField[] = [
	"firstName",
	"lastName",
	"company",
	"jobTitle",
	"department",
	"notes",
	"profilePicture",
	"profilePictureXs",
];

function fieldValue(
	contact: DuplicateCandidate,
	field: ScalarField,
): string | null {
	const raw = contact[field];
	if (typeof raw !== "string") return null;
	const trimmed = raw.trim();
	return trimmed === "" ? null : trimmed;
}

export function scoreContact(contact: DuplicateCandidate): number {
	let score = 0;

	for (const field of SCALAR_FIELDS) {
		if (field === "profilePicture" || field === "profilePictureXs") continue;
		if (fieldValue(contact, field)) score += 1;
	}

	if (fieldValue(contact, "profilePicture") || fieldValue(contact, "profilePictureXs")) {
		score += 2;
	}

	score += (contact.emails ?? []).length;
	score += (contact.phones ?? []).length;
	score += (contact.addresses ?? []).length;

	return score;
}

function createdAtTime(contact: DuplicateCandidate): number {
	if (!contact.createdAt) return Number.MAX_SAFE_INTEGER;
	const time = new Date(contact.createdAt).getTime();
	return Number.isNaN(time) ? Number.MAX_SAFE_INTEGER : time;
}

/** Richest first; ties break to the oldest, then by id so it is deterministic. */
function byMergePriority(
	a: DuplicateCandidate,
	b: DuplicateCandidate,
): number {
	const scoreDiff = scoreContact(b) - scoreContact(a);
	if (scoreDiff !== 0) return scoreDiff;

	const timeDiff = createdAtTime(a) - createdAtTime(b);
	if (timeDiff !== 0) return timeDiff;

	return a.id.localeCompare(b.id);
}

export function buildMergePlan(group: DuplicateGroup): MergePlan {
	const ordered = [...group.contacts].sort(byMergePriority);
	const survivor = ordered[0];
	const others = ordered.slice(1);

	const fields = {} as Record<ScalarField, FieldChoice>;

	for (const field of SCALAR_FIELDS) {
		const alternatives: string[] = [];
		for (const contact of ordered) {
			const value = fieldValue(contact, field);
			if (value && !alternatives.includes(value)) alternatives.push(value);
		}

		fields[field] = {
			selected: fieldValue(survivor, field) ?? alternatives[0] ?? null,
			alternatives,
		};
	}

	const emails: { address: string }[] = [];
	const seenEmails = new Set<string>();
	for (const contact of ordered) {
		for (const email of contact.emails ?? []) {
			const key = normalizeForSearch(email?.address ?? "");
			if (!key || seenEmails.has(key)) continue;
			seenEmails.add(key);
			emails.push({ address: email.address });
		}
	}

	const phones: { code: string | null; number: string }[] = [];
	const seenPhones = new Set<string>();
	for (const contact of ordered) {
		for (const phone of contact.phones ?? []) {
			const key = `${phone?.code ?? ""}${phone?.number ?? ""}`.replace(/\D/g, "");
			if (!key || seenPhones.has(key)) continue;
			seenPhones.add(key);
			phones.push({ code: phone.code ?? null, number: phone.number });
		}
	}

	const addresses: ContactAddress[] = [];
	const seenAddresses = new Set<string>();
	for (const contact of ordered) {
		for (const address of contact.addresses ?? []) {
			const key = normalizeForSearch(
				[
					address.streetAddress,
					address.streetAddressLine2,
					address.city,
					address.state,
					address.code,
					address.country,
				]
					.filter(Boolean)
					.join(" "),
			);
			if (!key || seenAddresses.has(key)) continue;
			seenAddresses.add(key);
			addresses.push(address);
		}
	}

	return {
		survivorId: survivor.id,
		mergedIds: others.map((c) => c.id),
		fields,
		emails,
		phones,
		addresses,
	};
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node_modules/.bin/tsx --test apps/web/lib/contact-duplicates.test.ts`
Expected: PASS, 15 tests

- [ ] **Step 5: Typecheck**

Run: `cd apps/web && ./node_modules/.bin/tsc --noEmit -p tsconfig.json`
Expected: no output

- [ ] **Step 6: Commit**

```bash
git add apps/web/lib/contact-duplicates.ts apps/web/lib/contact-duplicates.test.ts
git commit -m "feat: build merge plans for duplicate contact groups"
```

---

### Task 3: Merge server action

**Files:**
- Create: `apps/web/lib/actions/contacts-merge.ts`

**Interfaces:**
- Consumes: `MergePlan`, `ScalarField`, `ContactAddress` from Task 2.
- Produces: `mergeContacts(input: MergeContactsInput): Promise<{ success: boolean; error?: string }>` where
  `type MergeContactsInput = { survivorId: string; mergedIds: string[]; fields: Record<ScalarField, string | null>; emails: { address: string }[]; phones: { code: string | null; number: string }[]; addresses: ContactAddress[] }`

Note the shape difference from `MergePlan`: the action receives only the *chosen* value per field (`string | null`), not the choice object, because the UI resolves alternatives before submitting.

- [ ] **Step 1: Write the implementation**

This task has no unit test — it is I/O against Postgres and Redis, and is verified end-to-end in Task 5. Create `apps/web/lib/actions/contacts-merge.ts`:

```ts
"use server";

import { and, eq, inArray, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { contacts } from "@db";

import { isSignedIn } from "@/lib/actions/auth";
import { rlsClient } from "@/lib/actions/clients";
import { getRedis } from "@/lib/actions/get-redis";
import type { ContactAddress, ScalarField } from "@/lib/contact-duplicates";

export type MergeContactsInput = {
	survivorId: string;
	mergedIds: string[];
	fields: Record<ScalarField, string | null>;
	emails: { address: string }[];
	phones: { code: string | null; number: string }[];
	addresses: ContactAddress[];
};

export async function mergeContacts(input: MergeContactsInput) {
	const user = await isSignedIn();
	if (!user) return { success: false, error: "Unauthorized" };

	const mergedIds = [...new Set(input.mergedIds)].filter(
		(id) => id !== input.survivorId,
	);
	if (mergedIds.length === 0) {
		return { success: false, error: "Nothing to merge" };
	}
	if (!input.fields.firstName) {
		return { success: false, error: "The surviving contact needs a first name" };
	}

	const allIds = [input.survivorId, ...mergedIds];
	const rls = await rlsClient();

	// RLS restricts contacts to address books this user owns, so anything the
	// caller may not touch simply will not come back here.
	const visible = await rls((tx) =>
		tx
			.select({ id: contacts.id })
			.from(contacts)
			.where(inArray(contacts.id, allIds)),
	);

	if (visible.length !== allIds.length) {
		return { success: false, error: "Some contacts are no longer available" };
	}

	await rls(async (tx) => {
		await tx
			.update(contacts)
			.set({
				firstName: input.fields.firstName as string,
				lastName: input.fields.lastName,
				company: input.fields.company,
				jobTitle: input.fields.jobTitle,
				department: input.fields.department,
				notes: input.fields.notes,
				profilePicture: input.fields.profilePicture,
				profilePictureXs: input.fields.profilePictureXs,
				emails: input.emails,
				phones: input.phones,
				addresses: input.addresses,
				updatedAt: new Date(),
			})
			.where(eq(contacts.id, input.survivorId));

		// Carry every label off the losers, so a favourited duplicate keeps its
		// star. pk_contact_labels(contact_id, label_id) absorbs the duplicates.
		await tx.execute(sql`
			INSERT INTO contact_labels (contact_id, label_id, owner_id, workspace_id)
			SELECT
				${input.survivorId}::uuid,
				cl.label_id,
				cl.owner_id,
				cl.workspace_id
			FROM contact_labels cl
			WHERE cl.contact_id IN (${sql.join(
				mergedIds.map((id) => sql`${id}::uuid`),
				sql`, `,
			)})
			ON CONFLICT (contact_id, label_id) DO NOTHING
		`);
	});

	// Losers are deleted by the worker, never here: its deleteContact removes the
	// CardDAV card and the Postgres row together. Deleting locally first would
	// orphan the card and davSyncDb would recreate the contact.
	const { davQueue } = await getRedis();

	await davQueue.add("dav:update-contact", {
		contactId: input.survivorId,
		ownerId: user.id,
	});

	for (const id of mergedIds) {
		await davQueue.add("dav:delete-contact", {
			contactId: id,
			ownerId: user.id,
		});
	}

	revalidatePath("/dashboard/contacts");
	return { success: true };
}
```

- [ ] **Step 2: Typecheck**

Run: `cd apps/web && ./node_modules/.bin/tsc --noEmit -p tsconfig.json`
Expected: no output. If the `and` import is reported as unused, delete it from the import list and re-run.

- [ ] **Step 3: Commit**

```bash
git add apps/web/lib/actions/contacts-merge.ts
git commit -m "feat: add server action merging a duplicate contact group"
```

---

### Task 4: Duplicates view

**Files:**
- Create: `apps/web/components/dashboard/contacts/duplicate-group-card.tsx`
- Create: `apps/web/app/[locale]/w/[wPublicId]/dashboard/(unified)/(contacts)/contacts/duplicates/page.tsx`
- Modify: `apps/web/components/dashboard/contacts/contacts-shell.tsx`

**Interfaces:**
- Consumes: `findDuplicateGroups`, `buildMergePlan`, `DuplicateGroup`, `MergePlan`, `ScalarField` (Tasks 1-2); `mergeContacts` (Task 3); `storageObjectUrl` from `@/lib/storage-object-access`.
- Produces: no exports other tasks depend on.

- [ ] **Step 1: Create the group card component**

Create `apps/web/components/dashboard/contacts/duplicate-group-card.tsx`:

```tsx
"use client";

import React, { useState } from "react";

import {
	buildMergePlan,
	type DuplicateGroup,
	type ScalarField,
} from "@/lib/contact-duplicates";
import { mergeContacts } from "@/lib/actions/contacts-merge";
import { storageObjectUrl } from "@/lib/storage-object-access";
import ContactListAvatar from "@/components/dashboard/contacts/contact-list-avatar";

const FIELD_LABELS: Record<ScalarField, string> = {
	firstName: "First name",
	lastName: "Last name",
	company: "Company",
	jobTitle: "Job title",
	department: "Department",
	notes: "Notes",
	profilePicture: "Photo",
	profilePictureXs: "Photo thumbnail",
};

const REASON_LABELS: Record<string, string> = {
	name: "same name",
	email: "shared email",
	phone: "shared phone",
};

export default function DuplicateGroupCard({ group }: { group: DuplicateGroup }) {
	const plan = buildMergePlan(group);

	const [chosen, setChosen] = useState<Record<ScalarField, string | null>>(() => {
		const initial = {} as Record<ScalarField, string | null>;
		for (const field of Object.keys(plan.fields) as ScalarField[]) {
			initial[field] = plan.fields[field].selected;
		}
		return initial;
	});

	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [merged, setMerged] = useState(false);

	if (merged) return null;

	const onMerge = async () => {
		setBusy(true);
		setError(null);

		const result = await mergeContacts({
			survivorId: plan.survivorId,
			mergedIds: plan.mergedIds,
			fields: chosen,
			emails: plan.emails,
			phones: plan.phones,
			addresses: plan.addresses,
		});

		setBusy(false);
		if (result.success) setMerged(true);
		else setError(result.error ?? "Merge failed");
	};

	return (
		<div className="rounded-lg border bg-background/70 p-4">
			<div className="mb-3 flex items-center justify-between">
				<div>
					<p className="text-sm font-medium">
						{group.contacts.length} contacts
					</p>
					<p className="text-xs text-muted-foreground">
						Grouped by {group.reasons.map((r) => REASON_LABELS[r]).join(", ")}
					</p>
				</div>
				<button
					type="button"
					onClick={onMerge}
					disabled={busy}
					className="rounded-md bg-brand px-3 py-1.5 text-sm text-white disabled:opacity-50"
				>
					{busy ? "Merging…" : "Merge group"}
				</button>
			</div>

			<div className="mb-3 flex flex-wrap gap-3">
				{group.contacts.map((c) => (
					<div key={c.id} className="flex items-center gap-2 text-sm">
						<ContactListAvatar
							signedUrl={storageObjectUrl(c.profilePictureXs)}
							alt={c.firstName}
						/>
						<div>
							<p className={c.id === plan.survivorId ? "font-semibold" : ""}>
								{c.firstName} {c.lastName ?? ""}
								{c.id === plan.survivorId ? " (kept)" : ""}
							</p>
							<p className="text-xs text-muted-foreground">
								{(c.emails ?? []).map((e) => e.address).join(", ")}
							</p>
						</div>
					</div>
				))}
			</div>

			<div className="flex flex-col gap-2">
				{(Object.keys(plan.fields) as ScalarField[])
					.filter((field) => plan.fields[field].alternatives.length > 1)
					.map((field) => (
						<div key={field} className="flex flex-wrap items-center gap-2">
							<span className="w-28 text-xs text-muted-foreground">
								{FIELD_LABELS[field]}
							</span>
							{plan.fields[field].alternatives.map((value) => (
								<button
									key={value}
									type="button"
									onClick={() => setChosen((prev) => ({ ...prev, [field]: value }))}
									className={[
										"rounded-md border px-2 py-1 text-xs",
										chosen[field] === value ? "border-brand bg-brand-100" : "",
									].join(" ")}
								>
									{value}
								</button>
							))}
						</div>
					))}
			</div>

			{error && <p className="mt-2 text-xs text-red-600">{error}</p>}
		</div>
	);
}
```

- [ ] **Step 2: Create the duplicates page**

Create `apps/web/app/[locale]/w/[wPublicId]/dashboard/(unified)/(contacts)/contacts/duplicates/page.tsx`:

```tsx
import React from "react";
import { contacts } from "@db";

import { rlsClient } from "@/lib/actions/clients";
import { findDuplicateGroups } from "@/lib/contact-duplicates";
import DuplicateGroupCard from "@/components/dashboard/contacts/duplicate-group-card";

export default async function DuplicatesPage() {
	const rls = await rlsClient();
	const rows = await rls((tx) => tx.select().from(contacts));

	const groups = findDuplicateGroups(rows);

	return (
		<div className="flex h-full flex-col gap-3 overflow-y-auto p-4">
			<div>
				<h2 className="text-sm font-semibold">Duplicates</h2>
				<p className="text-xs text-muted-foreground">
					{groups.length === 0
						? "No duplicate contacts found."
						: `${groups.length} suspected duplicate groups.`}
				</p>
			</div>

			{groups.map((group) => (
				<DuplicateGroupCard key={group.contacts[0].id} group={group} />
			))}
		</div>
	);
}
```

- [ ] **Step 3: Link the view from the contacts header**

In `apps/web/components/dashboard/contacts/contacts-shell.tsx`, inside the `div` with `className={"flex gap-2"}` that currently holds only `<NewContactButton .../>`, add the link before the button:

```tsx
<Link
	href={`/w/${workspacePublicId}/dashboard/contacts/duplicates`}
	className="rounded-md border px-2 py-1 text-xs text-muted-foreground hover:text-foreground"
>
	Duplicates
</Link>
```

Add `import Link from "next/link";` to the top of the file.

- [ ] **Step 4: Typecheck**

Run: `cd apps/web && ./node_modules/.bin/tsc --noEmit -p tsconfig.json`
Expected: no output

- [ ] **Step 5: Commit**

```bash
git add apps/web/components/dashboard/contacts/duplicate-group-card.tsx \
  "apps/web/app/[locale]/w/[wPublicId]/dashboard/(unified)/(contacts)/contacts/duplicates/page.tsx" \
  apps/web/components/dashboard/contacts/contacts-shell.tsx
git commit -m "feat: add duplicates review view for contacts"
```

---

### Task 5: End-to-end verification against live data

**Files:** none created; this task validates Tasks 1-4 in the running stack.

**Interfaces:**
- Consumes: everything from Tasks 1-4.
- Produces: nothing.

- [ ] **Step 1: Run the full unit suite**

```bash
node_modules/.bin/tsx --test apps/web/lib/contact-duplicates.test.ts apps/web/lib/contact-search.test.ts apps/web/lib/storage-object-access.test.ts
```

Expected: all tests pass, 0 failures.

- [ ] **Step 2: Build and restart the web container**

```bash
cd /DATA/AppData/kurrier-test/db && sudo DOCKER_CONFIG=/DATA/AppData/kurrier-test/db/.docker docker compose build web && sudo docker compose up -d web
```

Expected: `web  Built`, then `db-web-1  Started`.

- [ ] **Step 3: Record the pre-merge state of one small group**

Pick a group of exactly 2 contacts so the first live merge is small. Record their ids, names and `dav_uri` values:

```bash
sudo docker exec app-postgres psql -AU postgres -d postgres -c "
select id, first_name, last_name, dav_uri
from contacts
where lower(first_name) = 'mega'
order by created_at;"
```

Expected: several rows. Note two ids for the next step.

- [ ] **Step 4: Merge that group in the browser**

Open `https://mail.edson-net.uk/en/w/<workspacePublicId>/dashboard/contacts/duplicates`, find that group, and click **Merge group**. The card should disappear without an error.

- [ ] **Step 5: Verify Postgres converged**

```bash
sudo docker exec app-postgres psql -AU postgres -d postgres -c "
select id, first_name, jsonb_array_length(emails) emails
from contacts
where lower(first_name) = 'mega'
order by created_at;"
```

Expected: one fewer row than in Step 3, and the surviving row's `emails` count equals the combined count of the merged contacts.

- [ ] **Step 6: Verify the CardDAV cards were deleted, not orphaned**

```bash
sudo docker compose -f /DATA/AppData/kurrier-test/db/docker-compose.yml logs --tail 50 worker | grep -i "delete-contact"
```

Expected: log lines showing the `dav:delete-contact` jobs completing without error. If a job failed, the loser will still be present in Postgres — re-run the merge after fixing the reported error.

- [ ] **Step 7: Verify the merge survives a sync**

Trigger a DAV sync and confirm the deleted contacts do not return:

```bash
sudo docker compose -f /DATA/AppData/kurrier-test/db/docker-compose.yml logs --tail 30 worker | grep -i "DAV WORKER"
sudo docker exec app-postgres psql -AU postgres -d postgres -c "
select count(*) from contacts where lower(first_name) = 'mega';"
```

Expected: the count matches Step 5 and does not grow back. This is the check that proves deletion went through CardDAV rather than only Postgres.

- [ ] **Step 8: Commit any fixes**

If Steps 3-7 required changes, commit them:

```bash
git add -u
git commit -m "fix: address issues found verifying contact merge end to end"
```

---

## Self-Review

**Spec coverage**

| Spec section | Task |
| --- | --- |
| Detection: name / email / phone edges, connected components, reasons, sorting | Task 1 |
| Placeholder-name exception for `Unknown` | Task 1 (`PLACEHOLDER_NAMES`, two tests) |
| Merge planning: survivor scoring, contact-point union, conflicting scalars, alternatives | Task 2 |
| Label union so a favourited duplicate keeps its star | Task 3 (SQL `INSERT ... SELECT ... ON CONFLICT`) |
| Mutation: RLS verification, single transaction, enqueue update + deletes | Task 3 |
| Losers deleted by the worker only, to prevent resurrection | Task 3 (comment + Global Constraints) and Task 5 Step 7 |
| Failure behaviour is re-runnable | Task 3 returns an error without deleting; Task 5 Step 6 |
| UI: groups largest-first, member cards, reason, clickable alternatives, explicit merge, empty state | Task 4 |
| Testing plan | Tasks 1, 2 and 5 |

No spec requirement is left without a task. The spec's `MergePlan.labelIds` is intentionally replaced by SQL-side label union; this is recorded under "Deliberate refinement from the spec".

**Placeholder scan:** No TBD/TODO entries. Every code step contains complete code. Task 3 states explicitly why it has no unit test rather than leaving the gap implicit.

**Type consistency:** `DuplicateCandidate`, `DuplicateGroup`, `ContactAddress`, `ScalarField`, `FieldChoice` and `MergePlan` are defined in Tasks 1-2 and used with the same names and shapes in Tasks 3-4. `MergeContactsInput.fields` is `Record<ScalarField, string | null>` while `MergePlan.fields` is `Record<ScalarField, FieldChoice>`; this difference is called out in Task 3's Interfaces block, and Task 4 performs the conversion in its `chosen` state.
