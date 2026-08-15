# Contact duplicate detection and merge

**Date:** 2026-08-15
**Status:** Approved for planning

## Problem

The contacts list holds 480 contacts with many apparent duplicates, and there is no
way to find or reconcile them. There is no merge, dedupe, or duplicate-detection
code anywhere in the contacts feature.

### What the data actually looks like

Measured against the live database on 2026-08-15:

| Segment | Count |
| --- | --- |
| Total contacts | 480 |
| Have a phone number (real address-book people) | 165 |
| No phone, no photo, exactly one email | 315 |
| Named `Unknown` | 23 |
| Carry a `dav_uri` (present in CardDAV) | 480 |

Grouping signal strength:

| Rule | Groups found |
| --- | --- |
| Share an email address | 1 |
| Share an identical full name | 38 |
| Share a phone number | 1 |

The largest same-name groups are not duplicated people:

| Name | Copies | Distinct emails |
| --- | --- | --- |
| Anthropic | 25 | 25 |
| Unknown | 23 | 23 |
| Mercado Pago | 13 | 11 |
| Instagram | 6 | 6 |
| Mega | 6 | 6 |
| Apple / Facebook / Google / PagBank | 5 each | 5 each |

### Root cause of the volume

`upsertWorkspaceSharedContactFromMessage` in
`apps/worker/lib/message-parser-contacts.ts` creates a contact for every sender of
every incoming message. When the sender has no display name, `splitName` assigns
the first name `Unknown`. These auto-collected contacts are pushed to CardDAV like
any other, which is why they also appear on the user's phone.

"Anthropic x25" is therefore one brand sending from 25 addresses, and "Unknown x23"
is 23 unrelated senders — neither is a duplicated person.

### Accepted trade-off

The owner decided to keep sender auto-collection running and keep all contacts in a
single DAV-synced address book, on the constraint that everything contacts-related
must stay synced with DAV. The consequence is explicitly accepted: new sender
contacts will keep appearing, so this tool is periodic cleanup rather than a
one-time fix. Turning off collection, or splitting collected senders into a second
CardDAV address book, were both considered and declined.

## Scope

In scope: detecting suspected duplicate groups, presenting them for review, and
merging a group into one surviving contact with write-back to CardDAV.

Out of scope: changing sender auto-collection, adding a second address book,
bulk-deleting existing contacts, and fuzzy/similarity name matching.

## Design

### 1. Detection — `apps/web/lib/contact-duplicates.ts`

Pure functions over contacts already loaded client-side. No new queries.

Contacts are nodes in an undirected graph. An edge joins two contacts when they
share any of:

- **Name** — identical normalized full name
- **Email** — a normalized email address in common
- **Phone** — a phone in common, compared digits-only, requiring at least 8 digits

Normalization reuses `normalizeForSearch` from `apps/web/lib/contact-search.ts`, so
case and accent handling is identical to contact search (`jose` = `José`).

Connected components of size >= 2 become suspected groups. Each group records which
rules produced it, so the UI can label a group "same name" or "shared email".
Groups sort largest-first.

**Placeholder-name exception.** Names on a placeholder list — currently `Unknown`,
matched after normalization — never create a name edge. Without this the 23
unrelated `Unknown` senders collapse into a single meaningless group of 23. Such
contacts can still group via a shared email or phone.

```
findDuplicateGroups(contacts: DuplicateCandidate[]): DuplicateGroup[]

DuplicateGroup = {
  contacts: DuplicateCandidate[];
  reasons: ("name" | "email" | "phone")[];
}
```

### 2. Merge planning — same module

`buildMergePlan(group)` produces a proposed result without mutating anything.

**Survivor selection.** Each contact is scored by completeness: filled scalar
fields, plus a bonus for having a photo, plus one point per email, phone, and
address. Highest score wins; ties break toward the oldest `createdAt` so the result
is deterministic.

**Contact points.** Emails, phones, and addresses from every group member are
unioned onto the survivor and deduplicated by normalized value (emails
case-insensitively, phones digits-only).

**Conflicting scalar fields.** For `firstName`, `lastName`, `company`, `jobTitle`,
`department`, `notes`, and `profilePicture`/`profilePictureXs`, the survivor's
non-empty value is pre-selected; if the survivor's value is empty, the highest-scored
non-empty value from the group is used. Every distinct alternative is returned
alongside so the UI can offer it.

**Labels.** The union of all group members' labels, so a favorited duplicate keeps
its star.

```
buildMergePlan(group: DuplicateGroup): MergePlan

MergePlan = {
  survivorId: string;
  mergedIds: string[];
  fields: Record<ScalarField, { selected: string | null; alternatives: string[] }>;
  emails: { address: string }[];
  phones: { code: string | null; number: string }[];
  addresses: ContactAddress[];
  labelIds: string[];
}
```

### 3. Mutation — `apps/web/lib/actions/contacts-merge.ts`

A server action, `mergeContacts({ survivorId, mergedIds, fields, emails, phones, addresses })`.

1. Resolve the RLS client and verify every id in the group is visible to the caller.
   RLS already restricts contacts to address books the caller owns
   (`contacts_select` requires `ab.owner_id = current user`), so an unauthorized id
   simply will not resolve — the action rejects rather than partially merging.
2. In one transaction: write merged fields and contact points onto the survivor, and
   re-point `contact_labels` rows from losers to the survivor, deduplicating against
   labels the survivor already has.
3. After the transaction commits, enqueue on `davQueue`:
   - `dav:update-contact` for the survivor
   - `dav:delete-contact` for each loser

`contact_labels` is the only table with a foreign key to `contacts`
(`onDelete: "cascade"`), so re-pointing labels before deletion is sufficient to
avoid data loss.

**Why losers are not deleted in the transaction.** The worker's `deleteContact`
(`apps/worker/lib/dav/dav-delete-contact.ts`) removes a contact from CardDAV *and*
Postgres. Deleting locally first would leave the CardDAV card orphaned, and the next
`davSyncDb` run would recreate the contact. Enqueueing after commit keeps CardDAV as
the authority for deletion and prevents resurrection.

**Failure behavior.** If a `dav:delete-contact` job fails, the loser remains in both
Postgres and CardDAV and stays visible as a duplicate; the merge is re-runnable. The
survivor's merged data is already committed, so a retry converges rather than
corrupting.

### 4. UI

A "Duplicates" view reachable from the contacts page, listing groups largest-first.
Each group shows its member cards, the grouping reason, and the pre-filled merge
plan with clickable alternatives for every conflicting field. Merging is per-group
and requires an explicit click — nothing merges automatically.

An empty state covers the case where no duplicates are detected.

### 5. Testing

Test-first, using `node:test` run under `tsx`, matching
`apps/web/lib/contact-search.test.ts`.

Detection:
- grouping by name, by email, by phone, each in isolation
- transitive grouping (A–B by name, B–C by email produces one group of three)
- the `Unknown` placeholder exception, including `Unknown` contacts that still group
  via a shared email
- phone comparison ignoring formatting, and rejecting short digit strings
- singletons excluded; accent- and case-insensitivity

Merge planning:
- survivor scoring, including the photo bonus and deterministic tie-break
- email/phone/address union and dedup
- conflicting scalar fields: pre-selection, fallback when the survivor's value is
  empty, and exposure of alternatives
- label union

The server action is verified manually against a real group in the live database
before the work is considered done.

## Files

| File | Change |
| --- | --- |
| `apps/web/lib/contact-duplicates.ts` | new — detection and merge planning |
| `apps/web/lib/contact-duplicates.test.ts` | new — unit tests |
| `apps/web/lib/actions/contacts-merge.ts` | new — merge server action |
| `apps/web/lib/contact-search.ts` | unchanged — `normalizeForSearch` is already exported and reused as-is |
| contacts page / shell | new — entry point and Duplicates view |
