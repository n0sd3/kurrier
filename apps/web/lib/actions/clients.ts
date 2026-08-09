import {cache} from "react";
import {currentSession, isSignedIn} from "@/lib/actions/auth";
import {createDrizzleClientInstance, workspaceMembers, workspaces} from "@db";
import {cookies} from "next/headers";
import {and, eq, or} from "drizzle-orm";


// Cookie-less recovery path: a signed-in user whose workspace cookies were lost
// (older builds wrote them without maxAge, so they died with the browser
// session) would otherwise get "No workspace selected" on every render until
// signing out and back in. Cached per request so one render resolves it once.
const workspaceContextFromDb = cache(async () => {
	const user = await isSignedIn();
	const userId = user?.id;
	if (!userId) return null;

	const session = await currentSession();
	const { admin } = await createDrizzleClientInstance(session, {});

	const [row] = await admin
		.select({
			id: workspaces.id,
			publicId: workspaces.publicId,
			ownerId: workspaces.ownerId,
			memberRole: workspaceMembers.role,
		})
		.from(workspaces)
		.leftJoin(
			workspaceMembers,
			and(
				eq(workspaceMembers.workspaceId, workspaces.id),
				eq(workspaceMembers.userId, userId),
			),
		)
		.where(
			or(
				eq(workspaces.ownerId, userId),
				eq(workspaceMembers.userId, userId),
			),
		)
		.limit(1);

	if (!row) return null;

	return {
		id: row.id,
		publicId: row.publicId,
		role: row.ownerId === userId ? "owner" : row.memberRole ?? "member",
	};
});

export const getWorkspaceId = async () => {
	const cookieStore = await cookies()
	const id = cookieStore.get('workspaceId')?.value;
	if (id) return id;

	const context = await workspaceContextFromDb();
	// Never return the string "undefined": it used to flow straight into
	// queries as a bogus workspace id instead of failing loudly here.
	if (!context) throw new Error("No workspace selected");
	return context.id;
};

export const getWorkspacePublicId = async () => {
	const cookieStore = await cookies()
	const id = cookieStore.get('workspacePublicId')?.value;
	if (id) return id;

	const context = await workspaceContextFromDb();
	if (!context) throw new Error("No workspace selected");
	return context.publicId;
};

export const getWorkspaceRole = async () => {
	const cookieStore = await cookies()
	const role = cookieStore.get('workspaceRole')?.value;
	if (role) return role;

	// Role gates permissions, so an unresolvable role degrades to the least
	// privileged one rather than throwing.
	const context = await workspaceContextFromDb();
	return context?.role ?? "member";
};

export const rlsClient = async () => {
	const cookieStore = await cookies();
	const workspaceId =
		cookieStore.get("workspaceId")?.value ??
		(await workspaceContextFromDb())?.id;
	if (!workspaceId) throw new Error("No workspace selected");

	return rlsClientForWorkspace(workspaceId);
};

export const rlsClientForWorkspace = async (workspaceId: string) => {
	const session = await currentSession();
	const user = await isSignedIn();
	const userId = user?.id;
	if (!userId) throw new Error("Not authenticated");

	const { admin } = await createDrizzleClientInstance(session, {});

	const rows = await admin
		.select({ id: workspaces.id })
		.from(workspaces)
		.leftJoin(
			workspaceMembers,
			eq(workspaceMembers.workspaceId, workspaces.id),
		)
		.where(
			and(
				eq(workspaces.id, workspaceId),
				or(
					eq(workspaces.ownerId, userId),
					eq(workspaceMembers.userId, userId),
				),
			),
		)
		.limit(1);

	if (!rows.length) throw new Error("Workspace not found or no access");

	const { rls } = await createDrizzleClientInstance(session, {
		workspaceId,
	});

	return rls;
};
