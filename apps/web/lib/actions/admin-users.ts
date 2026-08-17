"use server";

import { db, users, workspaces } from "@db";
import { type FormState, handleAction } from "@schema";
import argon2 from "argon2";
import { decode } from "decode-formdata";
import { desc, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { notFound } from "next/navigation";
import { isSignedIn } from "@/lib/actions/auth";
import {
	isInstanceAdminEmail,
	validateNewPassword,
} from "@/lib/instance-admin";

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
	return (
		db
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
			.orderBy(desc(users.createdAt))
	);
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
