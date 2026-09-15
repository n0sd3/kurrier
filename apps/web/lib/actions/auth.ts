"use server";

import * as crypto from "node:crypto";
import { APP_VERSION } from "@common";
import { db, users, workspaces, workspaceMembers } from "@db";
import { type FormState, getPublicEnv, getServerEnv, handleAction } from "@schema";
import argon2 from "argon2";
import { Queue, QueueEvents } from "bullmq";
import { decode } from "decode-formdata";
import { eq } from "drizzle-orm";
import { type JWTPayload, jwtVerify, SignJWT } from "jose";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getRedis } from "@/lib/actions/get-redis";
import { updateWorkSpaceContext } from "@/lib/actions/workspace";
import { DISTRIBUTION_CONFIG } from "@distribution/config";
import { withLocale } from "@/lib/utils";
import { kurrierServer } from "@distribution/kurrier-server";

const initProviders = async (userId: string, workspaceId: string) => {
	const { REDIS_PASSWORD, REDIS_HOST, REDIS_PORT } = getServerEnv();

	const redisConnection = {
		connection: {
			host: REDIS_HOST || "redis",
			port: Number(REDIS_PORT || 6379),
			password: REDIS_PASSWORD,
		},
	};

	const commonWorkerQueue = new Queue("common-worker", redisConnection);
	const commonWorkerEvents = new QueueEvents("common-worker", redisConnection);

	await commonWorkerEvents.waitUntilReady();
	await commonWorkerQueue.add("sync-providers", { userId, workspaceId });
};

const createUserWorkspace = async (userId: string, name?: string) => {
	await kurrierServer.hooks.run("workspace.beforeCreate", {
		userId,
	});
	const [workspace] = await db
		.insert(workspaces)
		.values({
			name: name ?? "Default Workspace",
			ownerId: userId,
			storageBytesUsed: 0,
		})
		.returning();

	return workspace;
};

const applyPendingMigrations = async (
	userId: string,
	workspaceId: string,
	email: string,
) => {
	const { migrationWorkerQueue } = await getRedis();

	await migrationWorkerQueue.add(
		"migration:run-for-user-after-signup",
		{ userId, workspaceId, email },
		{
			attempts: 3,
			backoff: {
				type: "exponential",
				delay: 3000,
			},
			removeOnComplete: { age: 60 },
			removeOnFail: false,
			jobId: `migration:${userId}:${APP_VERSION}`,
		},
	);
};

async function signToken(userId: string) {
	const { JWT_SECRET } = getServerEnv();

	return new SignJWT({})
		.setProtectedHeader({ alg: "HS256" })
		.setSubject(userId)
		.setIssuedAt()
		.setExpirationTime("30d")
		.sign(new TextEncoder().encode(JWT_SECRET));
}

async function setAuthToken(token: string) {
	const cookieStore = await cookies();

	cookieStore.set("session", token, {
		httpOnly: true,
		secure: process.env.NODE_ENV === "production",
		sameSite: "lax",
		path: "/",
		maxAge: 60 * 60 * 24 * 30,
	});
}

export async function createUserWithWorkspace(opts: {
	email: string;
	passwordHash: string;
	workspaceName?: string;
}) {
	const [existing] = await db
		.select()
		.from(users)
		.where(eq(users.email, opts.email));

	if (existing) {
		return { error: "auth.accountAlreadyExists" };
	}

	const [user] = await db
		.insert(users)
		.values({
			email: opts.email,
			passwordHash: opts.passwordHash,
		})
		.returning();

	const workspace = await createUserWorkspace(user.id, opts.workspaceName);

	await db
		.insert(workspaceMembers)
		.values({
			workspaceId: workspace.id,
			userId: user.id,
			role: "owner",
		})
		.onConflictDoNothing();

	await initProviders(user.id, workspace.id);
	await applyPendingMigrations(user.id, workspace.id, opts.email);

	return user;
}

export async function signInUserAndRedirect(
	user: typeof users.$inferSelect,
	locale?: string,
) {
	await createSessionForUser(user.id);
	const target = await getWorkspaceRedirectUrl(user);
	redirect(locale ? withLocale(locale, target) : target);
}

export async function login(
	_prev: FormState,
	formData: FormData,
): Promise<FormState> {
	if (!DISTRIBUTION_CONFIG.features.localLogin) {
		return {
			success: false,
			error: "auth.localLoginDisabled",
		};
	}

	const { email, password, locale } = decode(formData) as {
		email: string;
		password: string;
		locale?: string;
	};

	if (!email || !password) {
		return { error: "auth.missingCredentials" };
	}

	const [user] = await db.select().from(users).where(eq(users.email, email));

	if (!user || !user.passwordHash) {
		return { error: "auth.invalidCredentials" };
	}

	const valid = await argon2.verify(user.passwordHash, password);

	if (!valid) {
		return { error: "auth.invalidCredentials" };
	}

	await signInUserAndRedirect(user, locale);

	return { success: true, message: "auth.loggedIn" };
}

export async function signup(
	_prev: FormState,
	formData: FormData,
): Promise<FormState> {
	return handleAction(async () => {
		const { DISABLE_SIGNUP } = getPublicEnv();

		if (DISABLE_SIGNUP) {
			return {
				success: false,
				error: "auth.signupDisabled",
			};
		}

		const { workspaceName, email, password, locale } = decode(formData) as {
			email: string;
			password: string;
			workspaceName: string;
			locale?: string;
		};

		if (!email || !password) {
			return { error: "auth.missingCredentials" };
		}

		const passwordHash = await argon2.hash(password);

		const user = await createUserWithWorkspace({
			email,
			passwordHash,
			workspaceName,
		});

		if ("error" in user) {
			return { error: user.error };
		}

		await signInUserAndRedirect(user, locale);

		return { success: true, message: "auth.welcome" };

	})

}

export type TokenClaims = JWTPayload & {
	sub: string;
	workspace_id?: string;
};

export async function verifyAndDecode(
	token?: string,
): Promise<TokenClaims | null> {
	if (!token) return null;

	try {
		const { JWT_SECRET } = getServerEnv();
		const { payload } = await jwtVerify<TokenClaims>(
			token,
			new TextEncoder().encode(JWT_SECRET),
		);

		if (!payload.sub) {
			return null;
		}

		return payload;
	} catch {
		return null;
	}
}

export async function isSignedIn() {
	const cookieStore = await cookies();
	const token = cookieStore.get("session")?.value;

	if (!token) {
		return null;
	}

	const claims = await verifyAndDecode(token);

	if (!claims?.sub) {
		return null;
	}

	const [user] = await db
		.select({ id: users.id, email: users.email })
		.from(users)
		.where(eq(users.id, claims.sub));

	if (!user) {
		return null;
	}

	return user;
}

export type FetchIsSignedInResult = Awaited<ReturnType<typeof isSignedIn>>;

export const currentSession = async () => {
	const cookieStore = await cookies();
	return String(cookieStore.get("session")?.value);
};

export const signOut = async (redirectUrl?: string) => {
	const cookieStore = await cookies();
	cookieStore.delete("session");
	cookieStore.delete("workspaceId");
	cookieStore.delete("workspacePublicId");
	cookieStore.delete("workspaceRole");
	redirect(redirectUrl ? redirectUrl : "/auth/login");
};

export const getGravatarUrl = async (email: string, size = 80) => {
	const trimmedEmail = email.trim().toLowerCase();
	const hash = crypto.createHash("sha256").update(trimmedEmail).digest("hex");
	return `https://www.gravatar.com/avatar/${hash}?s=${size}&d=identicon`;
};

export async function createSessionForUser(userId: string) {
	const token = await signToken(userId);
	await setAuthToken(token);
}

// Owned workspaces win, but a user who only ever joined someone else's
// workspace still needs somewhere to land instead of bouncing to login.
// Not exported: this file is "use server", so an export would become a
// publicly callable action taking an arbitrary user id.
async function resolvePrimaryWorkspace(userId: string) {
	const columns = {
		id: workspaces.id,
		publicId: workspaces.publicId,
		defaultIdentityId: workspaces.defaultIdentityId,
	};

	const [owned] = await db
		.select(columns)
		.from(workspaces)
		.where(eq(workspaces.ownerId, userId))
		.limit(1);

	if (owned) return owned;

	const [joined] = await db
		.select(columns)
		.from(workspaces)
		.innerJoin(
			workspaceMembers,
			eq(workspaceMembers.workspaceId, workspaces.id),
		)
		.where(eq(workspaceMembers.userId, userId))
		.limit(1);

	return joined ?? null;
}

type PrimaryWorkspace = NonNullable<
	Awaited<ReturnType<typeof resolvePrimaryWorkspace>>
>;

function resolveWorkspacePath(target: PrimaryWorkspace) {
	// defaultIdentityId doubles as the "this workspace is set up" signal. With no
	// identity connected the unified mailbox would be empty, so the overview —
	// where an account gets connected — stays the useful landing.
	if (!target.defaultIdentityId) {
		return `/w/${target.publicId}/dashboard/platform/overview`;
	}

	// The unified mailbox spans every connected account, so its URL needs no
	// identity. That removes the lookup this function used to do purely to
	// turn defaultIdentityId into a publicId.
	return `/w/${target.publicId}/dashboard/mail/all/inbox`;
}

// Only the id is read, so callers holding a narrowed user (isSignedIn) can use
// this without refetching the full row.
export async function getWorkspaceRedirectUrl(user: Pick<typeof users.$inferSelect, "id">) {
	const target = await resolvePrimaryWorkspace(user.id);

	if (!target) {
		return "/auth/login";
	}

	await updateWorkSpaceContext(target.publicId, target.id, user);

	return resolveWorkspacePath(target);
}

/**
 * Read-only counterpart to getWorkspaceRedirectUrl: same target resolution,
 * but never writes the workspace-context cookies (that's only legal from a
 * Server Action or Route Handler). Safe to call from a plain page/layout
 * render to figure out where to redirect an already-signed-in user.
 */
export async function getDefaultWorkspacePath(user: { id: string }) {
	const target = await resolvePrimaryWorkspace(user.id);

	if (!target) {
		return "/auth/login";
	}

	return resolveWorkspacePath(target);
}
