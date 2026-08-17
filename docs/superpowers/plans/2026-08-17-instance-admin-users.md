# Instance Admin Users Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the instance operator a page listing every account on the instance and letting them set any account's password.

**Architecture:** Instance admins are named by a new server-only `ADMIN_EMAILS` env var, checked by a pure predicate that carries the tests. A new server-action module guards on that predicate and queries with the admin `db` client (deliberately outside RLS, since listing every account is cross-workspace). The page follows the existing `(platform)/platform/*` shape and the nav item is resolved server-side.

**Tech Stack:** Next.js App Router server actions, Drizzle ORM, argon2, Mantine (`Table`, `Card`, `Modal`, `Alert`, `Button`), the repo's `ReusableForm`, `node:test` run through `tsx`.

**Spec:** `docs/superpowers/specs/2026-08-17-instance-admin-users-design.md`

## Global Constraints

- `ADMIN_EMAILS` goes in `ZServerConfig` only, never `ZPublicConfig` — the admin list must not reach the browser.
- When `ADMIN_EMAILS` is unset or empty, nobody is an admin. The feature is off until switched on.
- Minimum password length set through this page: **8** characters. Do not change signup or login validation (`z.string().min(1)` in `packages/schema/src/types/api.ts:36`).
- `fetchInstanceUsers` must never select `passwordHash`.
- New passwords must be hashed with `argon2.hash(password)` using library defaults — the same call signup makes at `apps/web/lib/actions/auth.ts:194` — so `argon2.verify` in login keeps matching.
- The UI on this page is Mantine plus the repo's `ReusableForm`, matching `apps/web/components/dashboard/api-keys/manage-api-keys.tsx`. Do not introduce a different table or form library.
- Nav visibility is presentation only. Every server entry point re-checks admin status itself.
- Do not invalidate sessions and do not add a session table — explicitly out of scope.
- **Formatting:** `npx biome check` already reports pre-existing errors on untouched files in this repo (line-width wrapping). Run it only against the files you create, and fix only your own findings. Never reformat an existing file you did not otherwise need to change.
- Write new files with **tabs** and **double quotes**, matching `apps/web/lib/storage-object-access.ts`.
- Commit with explicit paths (`git add <path>`), never `git add -A`: `db/docker-compose.yml` carries an intentional uncommitted local image-tag edit and `db/NOTES-INSTALL.md` is untracked on purpose. Neither may be committed.

---

### Task 1: Admin predicate and password rule

The pure, security-critical core. It takes the env value as an argument rather than reading `process.env`, which is what makes it testable and keeps the caller responsible for the boundary.

**Files:**
- Create: `apps/web/lib/instance-admin.ts`
- Test: `apps/web/lib/instance-admin.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `MIN_ADMIN_SET_PASSWORD_LENGTH: number` (value `8`)
  - `parseAdminEmails(raw?: string | null): string[]`
  - `isInstanceAdminEmail(email?: string | null, raw?: string | null): boolean`
  - `validateNewPassword(password?: string | null): string | null` — returns an error message, or `null` when acceptable

- [ ] **Step 1: Write the failing test**

Create `apps/web/lib/instance-admin.test.ts`:

```ts
import test from "node:test";
import assert from "node:assert/strict";

import {
	isInstanceAdminEmail,
	parseAdminEmails,
	validateNewPassword,
} from "./instance-admin";

test("parses a comma separated list into normalized entries", () => {
	assert.deepEqual(parseAdminEmails(" A@x.com , b@y.com "), [
		"a@x.com",
		"b@y.com",
	]);
});

test("drops empty entries from a trailing comma", () => {
	assert.deepEqual(parseAdminEmails("a@x.com,"), ["a@x.com"]);
});

test("treats a missing or blank list as empty", () => {
	assert.deepEqual(parseAdminEmails(undefined), []);
	assert.deepEqual(parseAdminEmails(null), []);
	assert.deepEqual(parseAdminEmails(""), []);
	assert.deepEqual(parseAdminEmails("   "), []);
	assert.deepEqual(parseAdminEmails(" , "), []);
});

test("admits an email listed in the env var", () => {
	assert.equal(isInstanceAdminEmail("a@x.com", "a@x.com,b@y.com"), true);
});

test("ignores case and surrounding whitespace on both sides", () => {
	assert.equal(isInstanceAdminEmail(" A@X.com ", "a@x.com"), true);
	assert.equal(isInstanceAdminEmail("a@x.com", " A@X.COM "), true);
});

test("refuses an email that is absent from the list", () => {
	assert.equal(isInstanceAdminEmail("c@z.com", "a@x.com,b@y.com"), false);
});

test("refuses a substring of a listed address", () => {
	assert.equal(isInstanceAdminEmail("x.com", "a@x.com"), false);
	assert.equal(isInstanceAdminEmail("@x.com", "a@x.com"), false);
});

test("refuses everyone when the list is unset or empty", () => {
	assert.equal(isInstanceAdminEmail("a@x.com", undefined), false);
	assert.equal(isInstanceAdminEmail("a@x.com", ""), false);
	assert.equal(isInstanceAdminEmail("a@x.com", "  "), false);
});

test("refuses a missing candidate email even with a populated list", () => {
	assert.equal(isInstanceAdminEmail(undefined, "a@x.com"), false);
	assert.equal(isInstanceAdminEmail(null, "a@x.com"), false);
	assert.equal(isInstanceAdminEmail("", "a@x.com"), false);
});

test("requires a password of at least eight characters", () => {
	assert.equal(validateNewPassword("abcdefgh"), null);
	assert.match(String(validateNewPassword("abcdefg")), /at least 8/);
});

test("requires a password at all", () => {
	assert.match(String(validateNewPassword("")), /required/);
	assert.match(String(validateNewPassword(undefined)), /required/);
	assert.match(String(validateNewPassword(null)), /required/);
});

test("does not trim the password before measuring it", () => {
	// A password is opaque; spaces are legitimate characters, and trimming would
	// silently accept something shorter than the stated minimum.
	assert.equal(validateNewPassword("  abcdef  "), null);
	assert.match(String(validateNewPassword("   a   ")), /at least 8/);
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npx tsx --test apps/web/lib/instance-admin.test.ts
```

Expected: FAIL — the module `./instance-admin` does not exist yet (`ERR_MODULE_NOT_FOUND`).

- [ ] **Step 3: Write the minimal implementation**

Create `apps/web/lib/instance-admin.ts`:

```ts
/**
 * Instance administration is opt-in through the ADMIN_EMAILS env var, the same
 * shape as the management API's API_ADMIN_KEY: unset means nobody is an admin.
 * The env value is passed in rather than read here, which keeps these checks
 * pure and testable and leaves the caller responsible for never handing the
 * list to the browser.
 */

/** Minimum length required of a password set through the admin page. */
export const MIN_ADMIN_SET_PASSWORD_LENGTH = 8;

export function parseAdminEmails(raw?: string | null): string[] {
	if (!raw) return [];

	return raw
		.split(",")
		.map((entry) => entry.trim().toLowerCase())
		.filter((entry) => entry !== "");
}

export function isInstanceAdminEmail(
	email?: string | null,
	raw?: string | null,
): boolean {
	if (!email) return false;

	return parseAdminEmails(raw).includes(email.trim().toLowerCase());
}

/** Returns an error message, or null when the password is acceptable. */
export function validateNewPassword(password?: string | null): string | null {
	if (!password) return "Password is required";

	if (password.length < MIN_ADMIN_SET_PASSWORD_LENGTH) {
		return `Password must be at least ${MIN_ADMIN_SET_PASSWORD_LENGTH} characters`;
	}

	return null;
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
npx tsx --test apps/web/lib/instance-admin.test.ts
```

Expected: PASS — 13 tests, 0 fail.

- [ ] **Step 5: Check formatting of the new files only**

```bash
npx biome check apps/web/lib/instance-admin.ts apps/web/lib/instance-admin.test.ts
```

Expected: no errors for these two files. If it reports formatting, run `npx biome format --write` against these two paths only and re-run the test.

- [ ] **Step 6: Commit**

```bash
git add apps/web/lib/instance-admin.ts apps/web/lib/instance-admin.test.ts
git commit -m "feat(admin): add instance admin predicate and password rule"
```

---

### Task 2: Env var and server actions

**Files:**
- Modify: `packages/schema/src/types/config.ts:8-33` (add one field to `ZServerConfig`)
- Create: `apps/web/lib/actions/admin-users.ts`

**Interfaces:**
- Consumes: `isInstanceAdminEmail`, `validateNewPassword` from `@/lib/instance-admin` (Task 1); `isSignedIn` from `@/lib/actions/auth`, which resolves `{ id, email }` from the session cookie.
- Produces:
  - `isCurrentUserInstanceAdmin(): Promise<boolean>` — used by the nav in Task 4
  - `fetchInstanceUsers(): Promise<Array<{ id: string; email: string; createdAt: Date; workspaceName: string | null; workspacePublicId: string | null }>>` — 404s for non-admins
  - `FetchInstanceUsersResult` — the awaited return type, imported by the component in Task 3
  - `setUserPassword(prev: FormState, formData: FormData): Promise<FormState>` — expects form fields `userId` and `password`

- [ ] **Step 1: Add `ADMIN_EMAILS` to the server config schema**

In `packages/schema/src/types/config.ts`, add the field as the last entry of `ZServerConfig`, after `S3_FORCE_PATH_STYLE`:

```ts
	S3_FORCE_PATH_STYLE: z.string("S3_FORCE_PATH_STYLE must be present"),
	/** Comma-separated instance admins. Optional: unset means nobody is an admin. */
	ADMIN_EMAILS: z.string().optional(),
});
```

It must be `.optional()` — a required field here would break every existing install at boot. Do not touch `ZPublicConfig`.

- [ ] **Step 2: Write the server action module**

Create `apps/web/lib/actions/admin-users.ts`:

```ts
"use server";

import { db, users, workspaces } from "@db";
import { type FormState, handleAction } from "@schema";
import argon2 from "argon2";
import { decode } from "decode-formdata";
import { desc, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { notFound } from "next/navigation";
import { isSignedIn } from "@/lib/actions/auth";
import { isInstanceAdminEmail, validateNewPassword } from "@/lib/instance-admin";

const ADMIN_USERS_PATH = "/[locale]/w/[wPublicId]/dashboard/platform/users";

/**
 * Instance admins are named by ADMIN_EMAILS, not by workspace role: this page is
 * about the whole instance, so owning a workspace says nothing about it.
 * Returns null rather than throwing, because the two callers need different
 * failures — a 404 for the page, a form error for the action.
 */
async function getInstanceAdmin() {
	const user = await isSignedIn();

	if (!isInstanceAdminEmail(user?.email, process.env.ADMIN_EMAILS)) {
		return null;
	}

	return user;
}

export async function isCurrentUserInstanceAdmin(): Promise<boolean> {
	return (await getInstanceAdmin()) !== null;
}

export async function fetchInstanceUsers() {
	// 404 rather than 403, so the page's existence is not advertised.
	if (!(await getInstanceAdmin())) notFound();

	// The admin client, not rlsClient: listing every account is inherently
	// cross-workspace, while RLS is scoped to a single workspace by
	// construction. passwordHash is deliberately not selected.
	return db
		.select({
			id: users.id,
			email: users.email,
			createdAt: users.createdAt,
			workspaceName: workspaces.name,
			workspacePublicId: workspaces.publicId,
		})
		.from(users)
		// Left join: a user who owns no workspace — someone who only joined
		// another user's — must still appear in the list.
		.leftJoin(workspaces, eq(workspaces.ownerId, users.id))
		.orderBy(desc(users.createdAt));
}

export type FetchInstanceUsersResult = Awaited<
	ReturnType<typeof fetchInstanceUsers>
>;

export async function setUserPassword(
	_prev: FormState,
	formData: FormData,
): Promise<FormState> {
	return handleAction(async () => {
		// Checked here too: hiding the nav item is not the security boundary.
		// Note this returns an error instead of calling notFound() — handleAction
		// catches everything, and would swallow Next's control-flow throw.
		if (!(await getInstanceAdmin())) {
			return { success: false, error: "Not authorized" };
		}

		const { userId, password } = decode(formData) as {
			userId?: string;
			password?: string;
		};

		if (!userId) {
			return { success: false, error: "Missing user" };
		}

		const invalid = validateNewPassword(password);
		if (invalid) {
			return { success: false, error: invalid };
		}

		// Library defaults, exactly as signup hashes, so login's verify matches.
		const passwordHash = await argon2.hash(String(password));

		const [updated] = await db
			.update(users)
			.set({ passwordHash })
			.where(eq(users.id, userId))
			.returning({ id: users.id, email: users.email });

		if (!updated) {
			return { success: false, error: "User not found" };
		}

		revalidatePath(ADMIN_USERS_PATH, "page");

		return {
			success: true,
			message: `Password updated for ${updated.email}`,
		};
	});
}
```

- [ ] **Step 3: Confirm Task 1's tests still pass**

```bash
npx tsx --test apps/web/lib/instance-admin.test.ts
```

Expected: PASS, 13 tests. This module has no unit test of its own: every path needs a database, a session cookie, and Next's request context. It is verified end-to-end in Task 5, which is why Task 5 is not optional.

- [ ] **Step 4: Check formatting of the new file**

```bash
npx biome check apps/web/lib/actions/admin-users.ts packages/schema/src/types/config.ts
```

Expected: no new errors. `config.ts` may already report pre-existing findings — leave those alone; only your added lines must be clean.

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/actions/admin-users.ts packages/schema/src/types/config.ts
git commit -m "feat(admin): add instance user list and password reset actions"
```

---

### Task 3: The page and its component

**Files:**
- Create: `apps/web/app/[locale]/w/[wPublicId]/dashboard/(unified)/(platform)/platform/users/page.tsx`
- Create: `apps/web/app/[locale]/w/[wPublicId]/dashboard/(unified)/(platform)/platform/users/loading.tsx`
- Create: `apps/web/components/dashboard/admin/manage-instance-users.tsx`

**Interfaces:**
- Consumes: `fetchInstanceUsers`, `setUserPassword`, `FetchInstanceUsersResult` from `@/lib/actions/admin-users` (Task 2).
- Produces: the route `/w/<publicId>/dashboard/platform/users`, linked by Task 4.

- [ ] **Step 1: Create the loading state**

`loading.tsx` — one line, identical to every other platform page:

```tsx
import Loading from "@/app/loading";
export default Loading;
```

- [ ] **Step 2: Create the page**

`page.tsx`, following the api-keys page shape exactly:

```tsx
import { SidebarTrigger } from "@/components/ui/sidebar";
import { Separator } from "@/components/ui/separator";
import React from "react";
import ManageInstanceUsers from "@/components/dashboard/admin/manage-instance-users";
import { fetchInstanceUsers } from "@/lib/actions/admin-users";

export default async function Page() {
	const usersList = await fetchInstanceUsers();
	return (
		<>
			<header className="flex h-16 shrink-0 items-center gap-2">
				<div className="flex items-center gap-2 px-4">
					<SidebarTrigger className="-ml-1" />
					<Separator
						orientation="vertical"
						className="mr-2 data-[orientation=vertical]:h-4"
					/>
				</div>
			</header>
			<div className="flex flex-1 flex-col gap-4 p-4 pt-0">
				<ManageInstanceUsers usersList={usersList} />
			</div>
		</>
	);
}
```

- [ ] **Step 3: Create the component**

`apps/web/components/dashboard/admin/manage-instance-users.tsx`. The `fmtTemporal` helper and the `Container`/`Card`/`Table` structure mirror `manage-api-keys.tsx`; the modal is what differs, because a password reset must name the account it will affect rather than let you pick from a dropdown and hit the wrong row.

```tsx
"use client";

import { Container } from "@/components/common/containers";
import { ReusableForm } from "@/components/common/reusable-form";
import {
	type FetchInstanceUsersResult,
	setUserPassword,
} from "@/lib/actions/admin-users";
import { Temporal } from "@js-temporal/polyfill";
import { Alert, Button, Card, Modal, Table } from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import * as React from "react";

type InstanceUser = FetchInstanceUsersResult[number];

export default function ManageInstanceUsers({
	usersList,
}: {
	usersList: FetchInstanceUsersResult;
}) {
	const [opened, { open, close }] = useDisclosure(false);
	const [target, setTarget] = React.useState<InstanceUser | null>(null);

	function fmtTemporal(input?: Date | string | null) {
		if (!input) return "-";

		const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
		const instant =
			input instanceof Date
				? Temporal.Instant.fromEpochMilliseconds(input.getTime())
				: Temporal.Instant.from(input);

		return instant
			.toZonedDateTimeISO(tz)
			.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
	}

	const fields = [
		{
			name: "userId",
			wrapperClasses: "hidden",
			props: { hidden: true, defaultValue: target?.id ?? "" },
		},
		{
			name: "password",
			label: "New password",
			wrapperClasses: "col-span-12",
			props: {
				type: "password",
				required: true,
				autoComplete: "new-password",
				placeholder: "At least 8 characters",
			},
		},
	];

	return (
		<Container variant="wide">
			<div className="flex items-center justify-between my-4">
				<h1 className="text-xl font-bold text-foreground">Instance Users</h1>
				<span className="text-sm text-muted-foreground">
					{usersList.length} {usersList.length === 1 ? "account" : "accounts"}
				</span>
			</div>

			<p className="max-w-prose text-sm text-muted-foreground my-6">
				Every account on this instance. Setting a password here replaces it
				immediately.
			</p>

			<Alert color="yellow" variant="light" className="mb-6">
				<span className="text-sm">
					Changing a password does not sign the user out. Sessions are 30-day
					cookies with no server-side record, so an existing session stays
					valid until it expires.
				</span>
			</Alert>

			<Card className="shadow-none mt-4 !rounded-2xl border">
				<div className="p-4">
					<Table verticalSpacing="sm" highlightOnHover>
						<Table.Thead>
							<Table.Tr>
								<Table.Th>Email</Table.Th>
								<Table.Th>Created</Table.Th>
								<Table.Th>Workspace</Table.Th>
								<Table.Th className="w-40 text-right">Password</Table.Th>
							</Table.Tr>
						</Table.Thead>
						<Table.Tbody>
							{usersList.map((u) => (
								<Table.Tr key={u.id}>
									<Table.Td>{u.email}</Table.Td>
									<Table.Td>{fmtTemporal(u.createdAt)}</Table.Td>
									<Table.Td>{u.workspaceName ?? "—"}</Table.Td>
									<Table.Td className="text-right">
										<Button
											variant="subtle"
											size="xs"
											onClick={() => {
												setTarget(u);
												open();
											}}
										>
											Set password
										</Button>
									</Table.Td>
								</Table.Tr>
							))}
						</Table.Tbody>
					</Table>
				</div>
			</Card>

			<Modal
				opened={opened}
				onClose={close}
				title={`Set password for ${target?.email ?? ""}`}
				centered
			>
				<ReusableForm
					// Remount per target so the hidden userId and the typed password
					// never carry over from the previously opened row.
					key={target?.id}
					formKey={target?.id}
					action={setUserPassword}
					fields={fields}
					notify={{ kind: "toast" }}
					onSuccess={close}
					submitButtonProps={{
						submitLabel: "Set password",
						wrapperClasses: "mt-6 flex justify-center",
						fullWidth: true,
					}}
				/>
			</Modal>
		</Container>
	);
}
```

- [ ] **Step 4: Check formatting of the new files**

```bash
npx biome check "apps/web/app/[locale]/w/[wPublicId]/dashboard/(unified)/(platform)/platform/users" apps/web/components/dashboard/admin/manage-instance-users.tsx
```

Expected: no errors for these files.

- [ ] **Step 5: Commit**

```bash
git add "apps/web/app/[locale]/w/[wPublicId]/dashboard/(unified)/(platform)/platform/users" apps/web/components/dashboard/admin/manage-instance-users.tsx
git commit -m "feat(admin): add instance users page"
```

---

### Task 4: Navigation entry

**Files:**
- Modify: `apps/web/components/nav-main-wrapper.tsx:1-14`
- Modify: `apps/web/components/nav-main.tsx:3-14` (icon import) and `:35` (props), plus a new block after the `workspaceRole === "owner"` group that ends around `:105`

**Interfaces:**
- Consumes: `isCurrentUserInstanceAdmin` from `@/lib/actions/admin-users` (Task 2); the route from Task 3.
- Produces: nothing other tasks depend on.

- [ ] **Step 1: Resolve the flag in the wrapper**

`nav-main-wrapper.tsx` is already a server component resolving cookie-derived values in a `Promise.all`. Add the admin check to it. Keep the file's existing 4-space indentation and single quotes — do not reformat it:

```tsx
import React from 'react';
import {NavMain} from "@/components/nav-main";
import {getWorkspacePublicId, getWorkspaceRole} from "@/lib/actions/clients";
import {isCurrentUserInstanceAdmin} from "@/lib/actions/admin-users";

async function NavMainWrapper() {
    const [workspacePublicId, workspaceRole, isInstanceAdmin] = await Promise.all([
        getWorkspacePublicId(),
        getWorkspaceRole(),
        isCurrentUserInstanceAdmin()
    ]);

    return <NavMain workspacePublicId={workspacePublicId} workspaceRole={workspaceRole || "member"} isInstanceAdmin={isInstanceAdmin} />
}

export default NavMainWrapper;
```

- [ ] **Step 2: Add the `Users` icon to the lucide import**

In `apps/web/components/nav-main.tsx`, add `Users` to the existing `lucide-react` import block, keeping it alphabetical:

```tsx
	Send, Users, Webhook,
} from "lucide-react";
```

- [ ] **Step 3: Accept the new prop**

Change the signature at `nav-main.tsx:35`:

```tsx
export function NavMain({workspacePublicId, workspaceRole, isInstanceAdmin}: {workspacePublicId?: string, workspaceRole?: string, isInstanceAdmin?: boolean}) {
```

- [ ] **Step 4: Add the nav item**

Immediately after the closing `: []),` of the `workspaceRole === "owner"` block that contains "Sync Services", and before the closing `];` of `navPlatformItems`, add:

```tsx
		...(isInstanceAdmin
			? [
				{
					title: "Instance Users",
					url: `/w/${workspacePublicId}/dashboard/platform/users`,
					icon: Users,
					items: [],
				},
			]
			: []),
```

This is a separate condition from the `owner` blocks on purpose: instance admin and workspace owner are different authorities, and an admin who owns no workspace must still see the link.

- [ ] **Step 5: Confirm nothing else regressed**

```bash
npx tsx --test apps/web/lib/instance-admin.test.ts
```

Expected: PASS, 13 tests. The nav itself has no unit test — it is verified visually in Task 5.

- [ ] **Step 6: Commit**

```bash
git add apps/web/components/nav-main.tsx apps/web/components/nav-main-wrapper.tsx
git commit -m "feat(admin): link instance users page for instance admins"
```

---

### Task 5: Build, deploy locally, verify end to end

The guard, the RLS bypass, and the argon2 round-trip only exist together at runtime, so this task is where the feature is actually proven. Note the two silent traps in this stack: a rebuilt image does not replace a running container without `--force-recreate`, and neither command errors when the running code is stale — so verify the artifact, not the command output.

**Files:**
- Modify: `db/.env` (untracked, never committed) — add `ADMIN_EMAILS`

**Interfaces:**
- Consumes: everything from Tasks 1-4.
- Produces: a verified deployment.

- [ ] **Step 1: Set the admin list**

Append to `db/.env`:

```
ADMIN_EMAILS=ed.cleubert@gmail.com
```

The `web` service reads `env_file: - .env`, so nothing else is needed to deliver the value. `db/.env` is covered by `.gitignore` — it must not be staged.

- [ ] **Step 2: Rebuild the web image**

Docker needs `sudo` here, and `sudo` makes HOME `/root`, which is read-only — so pass a writable `DOCKER_CONFIG` or the build fails with `mkdir /root/.docker: read-only file system`:

```bash
sudo env DOCKER_CONFIG=/tmp/dockercfg docker build -f apps/web/Dockerfile --build-arg APP_DIR=apps/web -t kurrier-web:local .
```

Run from the repo root. This is also the real typecheck: `next build` type-checks the whole app, so a signature mismatch between tasks fails here.

- [ ] **Step 3: Recreate the container**

```bash
cd db && sudo docker compose up -d --force-recreate web
```

`--force-recreate` is required. Without it Compose reports `Container db-web-1 Running` and leaves the container on the old image.

- [ ] **Step 4: Verify the running container actually has the new code**

```bash
sudo docker inspect db-web-1 --format '{{.Image}}'
sudo docker images --no-trunc --format '{{.ID}}' kurrier-web:local
```

The two must be equal. Then confirm the new code is inside:

```bash
sudo docker exec db-web-1 grep -rl "Instance Users" /app/apps/web/.next
```

Expected: at least one match. No match means the container is serving a stale bundle — go back to Step 2.

- [ ] **Step 5: Verify the list as an admin**

Open `https://mail.edson-net.uk` signed in as the address in `ADMIN_EMAILS`. Confirm: "Instance Users" appears in the platform nav; the page lists every account with email, created date and workspace; the count in the header equals

```bash
sudo docker exec -i app-postgres psql -U postgres -d postgres -c "select count(*) from auth.users;"
```

- [ ] **Step 6: Verify the guard as a non-admin**

Sign in as an account *not* in `ADMIN_EMAILS`. Confirm the nav item is absent, and that navigating directly to `/w/<their-workspace-publicId>/dashboard/platform/users` renders 404 rather than the list.

- [ ] **Step 7: Verify the password reset**

As the admin, use "Set password" on a test account and confirm in order:

1. A password under 8 characters is rejected with an error toast and no change.
2. A valid password reports success.
3. The hash actually changed:

   ```bash
   sudo docker exec -i app-postgres psql -U postgres -d postgres -c "select email, left(password_hash, 30) from auth.users;"
   ```

   The hash for that account must start with `$argon2id$v=19$m=65536,t=3,p=4$`.
4. Logging in as that account with the new password succeeds, and with the old password fails.

- [ ] **Step 8: Confirm the working tree is clean of local-only files**

```bash
git status --short
```

Expected: only ` M db/docker-compose.yml` and `?? db/NOTES-INSTALL.md` remain, both intentionally uncommitted. `db/.env` must not appear. If anything else is unstaged, it belongs to a previous task's commit.

- [ ] **Step 9: Record the new env var in the install notes**

`db/NOTES-INSTALL.md` is the untracked local record of how this instance deviates from the docs. Add `ADMIN_EMAILS` to it under a short heading, noting that it gates the Instance Users page and that adding an admin means editing `db/.env` and running `sudo docker compose up -d --force-recreate web`. Do not commit this file.
