# Instance admin: user list and password reset

**Date:** 2026-08-17
**Status:** Approved for planning

## Problem

The instance operator has no way to see who has an account, and no way to change
anyone's password — including their own. Verified against the code at `8cfb607`:

| Capability | State |
| --- | --- |
| List or count users in the UI | Does not exist. Every page under `(platform)/platform/*` is workspace-scoped |
| "Forgot your password?" on login | Commented out — [login-form.tsx:105](../../../apps/web/components/auth/login-form.tsx) |
| Change your own password in settings | No password UI anywhere in `apps/web` |
| Management API | Only `POST /api/kurrier/users` (create). No list endpoint, no password endpoint |

`auth.users.password_hash` is written in exactly one place: signup, via
`argon2.hash` ([auth.ts:194](../../../apps/web/lib/actions/auth.ts)). Login reads it
back with `argon2.verify` ([auth.ts:160](../../../apps/web/lib/actions/auth.ts)).
Accounts provisioned through the management API get a random UUID as their hash on
purpose, so they are reachable only through SSO/OIDC
([users/index.post.ts:64](../../../apps/worker/server/routes/api/kurrier/users/index.post.ts)).

Consequence today: resetting a password means shelling into the containers, hashing
by hand with the `argon2` module inside the web image, and running an `UPDATE`
against `auth.users`.

There is also no concept of an **instance** administrator. The only instance-level
authority that exists is the `API_ADMIN_KEY` env var used by the management API
([api-helpers.ts:152](../../../apps/worker/lib/api-helpers.ts)) — an opt-in
env var that returns `false` when unset. This design follows that precedent.

## Goals

1. An admin-only page listing every user: total count, email, creation date, and the
   workspace they own.
2. Setting a new password for any account from that page.

## Non-goals

Explicitly out of scope for this change:

- Creating or deleting users through the UI.
- Invalidating active sessions on password change (see Limitations).
- A global password policy for signup and login.
- i18n of the new strings — the existing nav titles are hard-coded English
  ([nav-main.tsx:56](../../../apps/web/components/nav-main.tsx)) and this follows suit.

## Who counts as an admin

A new server-only env var, `ADMIN_EMAILS`, holding a comma-separated list:

```
ADMIN_EMAILS=ed.cleubert@gmail.com
```

Added to `ZServerConfig` as `z.string().optional()`
([config.ts:8](../../../packages/schema/src/types/config.ts)), following the
`VAPID_PUBLIC_KEY` precedent. It must stay in `ZServerConfig` and never move to
`ZPublicConfig` — the admin list must not ship to the browser.

Rationale for env over a database column: it needs no migration, it matches the
opt-in shape of `API_ADMIN_KEY`, and it lives in `db/.env`, which is untracked and
survives `git pull` on this instance. Cost: adding an admin means editing `.env` and
restarting the web container.

When `ADMIN_EMAILS` is unset or empty, nobody is an admin and the page 404s for
everyone. The feature is off until deliberately switched on.

## Architecture

### 1. Authorization predicate — `apps/web/lib/instance-admin.ts`

```ts
export function parseAdminEmails(raw?: string | null): string[]
export function isInstanceAdminEmail(email?: string | null, raw?: string | null): boolean
```

Splits on commas, trims, lowercases, drops empty entries. Compares the candidate
email lowercased. Returns `false` for a missing candidate email and for an empty or
missing list.

This is the security-critical unit and the only pure one, so it carries the tests.
It mirrors an existing pattern in the repo: `storage-object-access.ts` is a pure
access predicate with a sibling `.test.ts`.

### 2. Guard and data access — `apps/web/lib/actions/admin-users.ts` (new, `"use server"`)

**`getInstanceAdmin()`** — calls `isSignedIn()`
([auth.ts:238](../../../apps/web/lib/actions/auth.ts)), which already resolves
`{ id, email }` from the session cookie, then applies `isInstanceAdminEmail`. It
returns `null` on failure rather than throwing, because the two callers need
different failures: the page calls `notFound()` — a 404 rather than a 403 keeps the
page's existence unadvertised — while the action returns a form error. The action
must not call `notFound()`: server actions here are wrapped in `handleAction`, which
catches everything and would swallow Next's control-flow throw, turning a 404 into a
misleading "Not authorized" string in the form. A thin
`isCurrentUserInstanceAdmin(): Promise<boolean>` wraps it for the nav.

**`fetchInstanceUsers()`** — guard first, then query with the admin `db` client
rather than `rlsClient()`. This bypass is deliberate and is the one place it is
correct: listing every account is inherently cross-workspace, and RLS is scoped to
a single workspace by construction ([clients.ts:112](../../../apps/web/lib/actions/clients.ts)).
Left joins `users` to `workspaces` on `workspaces.ownerId`. Returns
`{ id, email, createdAt, workspaceName, workspacePublicId }` per row. It must never
select `passwordHash`.

The join is a left join so that a user who owns no workspace — someone who only ever
joined another user's workspace — still appears in the list, with a null workspace
rendered as an em dash. The count at the top is the number of rows in `auth.users`,
not the number of workspaces.

**`setUserPassword(userId, password)`** — guard, then:

1. Reject a password shorter than 8 characters, returning a form error with no write.
   The project has no password policy today (`z.string().min(1)` in
   [api.ts:36](../../../packages/schema/src/types/api.ts)); this minimum is local to
   this action and does not change signup or login.
2. `argon2.hash(password)` with the same defaults signup uses, so `argon2.verify` in
   login keeps matching. Verified in the running image: the defaults produce
   `$argon2id$v=19$m=65536,t=3,p=4$...` and round-trip through `verify`.
3. `update(users).set({ passwordHash }).where(eq(users.id, userId))`.
4. Reject an unknown `userId` with a form error rather than a silent no-op.
5. `revalidatePath` for the page.

Returns the same `FormState` shape the other actions in `lib/actions` use.

An admin may reset their own password through this page; the admin's own row is not
special-cased. Since `ADMIN_EMAILS` lives in the environment rather than the database,
no password reset can remove or grant admin rights, so there is no lockout path to
guard against.

### 3. UI

- `(platform)/platform/users/page.tsx` and `loading.tsx`, following the shape of the
  api-keys page: header with `SidebarTrigger` and `Separator`, then one component.
- `components/dashboard/admin/manage-instance-users.tsx`: the total count, a table of
  Email / Created / Workspace, and a per-row dialog taking a new password. Built with
  Mantine (`Container`, `Card`, `Table`, `Modal`, `Alert`, `Button`) and the repo's
  `ReusableForm`, matching `manage-api-keys.tsx`. The `components/ui` shadcn
  primitives are used only for the page chrome (`SidebarTrigger`, `Separator`), which
  is what the other platform pages do — the tables and forms there are Mantine.
- The password form is row-scoped rather than a dropdown of accounts: a reset names
  the account it will affect, so the wrong row cannot be picked by accident.
- The session limitation below is stated on the page itself, next to the reset
  control, so it is visible at the moment it matters.

### 4. Navigation

`nav-main-wrapper.tsx` is a server component that already reads cookies and passes
`workspacePublicId` and `workspaceRole` into `NavMain`
([nav-main-wrapper.tsx:11](../../../apps/web/components/nav-main-wrapper.tsx)). It
resolves an `isInstanceAdmin` boolean the same way and passes it down; `NavMain`
renders the item alongside the entries gated on `workspaceRole === "owner"`
([nav-main.tsx:72](../../../apps/web/components/nav-main.tsx)).

Hiding the link is presentation, not protection. The guard in `requireInstanceAdmin`
is the security boundary, and it runs in both the page and the action.

## Limitations

**A password change does not end the user's active sessions.** Sessions are stateless
JWTs in a 30-day cookie ([auth.ts:87](../../../apps/web/lib/actions/auth.ts)); there
is no session table. Enforcing invalidation would mean a new column checked inside
`isSignedIn` *and* a change to what Postgres accepts for RLS, since `rlsClient` hands
the raw cookie token to the database — a larger change than this page, deliberately
deferred. Rotating `JWT_SECRET` remains the blunt instrument that logs everyone out.

This is documented in the UI, not just here.

## Error handling

| Case | Behavior |
| --- | --- |
| Not signed in, or not in `ADMIN_EMAILS` | `notFound()` — 404 on the page, and the action refuses independently |
| `ADMIN_EMAILS` unset or empty | Nobody is an admin; 404 for all |
| Password under 8 characters | Form error, no write |
| Unknown `userId` | Form error, no write |
| Hash or update failure | Generic error to the UI; no hash or SQL detail is surfaced |

## Testing

`apps/web/lib/instance-admin.test.ts`, using `node:test` and `node:assert/strict` like
the existing suites, run with:

```bash
npx tsx --test apps/web/lib/instance-admin.test.ts
```

Cases: empty list, undefined list, whitespace-only list, case mismatch on both sides,
surrounding whitespace, trailing comma, an email absent from the list, a null
candidate email, and a candidate that is a substring of a listed address (must not
match).

Manual verification, since the guard, the RLS bypass, and the argon2 round-trip only
exist together at runtime:

1. Build the local image and set `ADMIN_EMAILS` in `db/.env`.
2. Open the page as the admin account — the count matches
   `select count(*) from auth.users`.
3. Confirm the page 404s for a non-admin account and that the nav item is absent.
4. Reset a test account's password from the page, then log in with the new password.
