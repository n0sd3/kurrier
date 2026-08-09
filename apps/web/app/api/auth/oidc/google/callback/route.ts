import * as client from "openid-client";
import argon2 from "argon2";
import crypto from "node:crypto";
import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import { and, eq, getTableColumns } from "drizzle-orm";
import {
    authAccounts,
    authProviders,
    db,
    users,
    workspaceMembers,
    workspaces,
} from "@db";
import {
    createSessionForUser,
    createUserWithWorkspace,
    getWorkspaceRedirectUrl,
} from "@/lib/actions/auth";

export async function GET(request: NextRequest) {
    const cookieStore = await cookies();

    const codeVerifier = cookieStore.get("google_code_verifier")?.value;
    const state = cookieStore.get("google_state")?.value;

    if (!codeVerifier || !state) {
        return NextResponse.redirect(new URL("/auth/login", process.env.WEB_URL!));
    }

    const config = await client.discovery(
        new URL("https://accounts.google.com"),
        process.env.OIDC_GOOGLE_CLIENT_ID!,
        process.env.OIDC_GOOGLE_CLIENT_SECRET!
    );

    const callbackUrl = new URL(
        request.nextUrl.pathname + request.nextUrl.search,
        process.env.WEB_URL!,
    );

    let tokens: client.TokenEndpointResponse & client.TokenEndpointResponseHelpers;

    try {
        tokens = await client.authorizationCodeGrant(config, callbackUrl, {
            pkceCodeVerifier: codeVerifier,
            expectedState: state,
        });
    } catch (err: any) {
        console.error("[GOOGLE OIDC CALLBACK FAILED]", {
            rawUrl: request.url,
            callbackUrl: callbackUrl.toString(),
            message: err?.message,
            code: err?.code,
            error: err?.error,
        });
        return NextResponse.redirect(new URL("/auth/login", process.env.WEB_URL!));
    }

    const claims = tokens.claims();

    const email = claims?.email as string | undefined;
    const providerUserId = claims?.sub as string | undefined;

    if (!email || !providerUserId) {
        return NextResponse.redirect(new URL("/auth/login", process.env.WEB_URL!));
    }

    let [user] = await db.select().from(users).where(eq(users.email, email));

    if (!user) {
        const passwordHash = await argon2.hash(crypto.randomUUID());

        const createdUser = await createUserWithWorkspace({
            email,
            passwordHash,
            workspaceName: "Default Workspace",
        });

        if (!createdUser || "error" in createdUser) {
            return NextResponse.redirect(new URL("/auth/login", process.env.WEB_URL!));
        }

        user = createdUser;
    }

    // Same rule as getWorkspaceRedirectUrl: fall back to a joined workspace so
    // a member-only user is not bounced back to the login screen.
    let [workspace] = await db
        .select()
        .from(workspaces)
        .where(eq(workspaces.ownerId, user.id))
        .limit(1);

    if (!workspace) {
        [workspace] = await db
            .select({ ...getTableColumns(workspaces) })
            .from(workspaces)
            .innerJoin(
                workspaceMembers,
                eq(workspaceMembers.workspaceId, workspaces.id),
            )
            .where(eq(workspaceMembers.userId, user.id))
            .limit(1);
    }

    if (!workspace) {
        return NextResponse.redirect(new URL("/auth/login", process.env.WEB_URL!));
    }

    let [googleProvider] = await db
        .select()
        .from(authProviders)
        .where(
            and(
                eq(authProviders.workspaceId, workspace.id),
                eq(authProviders.name, "google"),
            ),
        );

    if (!googleProvider) {
        [googleProvider] = await db
            .insert(authProviders)
            .values({
                ownerId: user.id,
                workspaceId: workspace.id,
                name: "google",
                type: "oidc",
                issuerUrl: "https://accounts.google.com",
                clientId: process.env.OIDC_GOOGLE_CLIENT_ID!,
                enabled: true,
                metaData: {
                    scopes: "openid email profile",
                },
            })
            .returning();
    }

    await db
        .insert(authAccounts)
        .values({
            userId: user.id,
            providerId: googleProvider.id,
            providerUserId,
            email,
            emailVerified: claims?.email_verified === true,
            rawProfile: claims ?? null,
            workspaceId: workspace.id,
        })
        .onConflictDoNothing();

    cookieStore.delete("google_code_verifier");
    cookieStore.delete("google_state");

    await createSessionForUser(user.id);

    const redirectUrl = await getWorkspaceRedirectUrl(user);

    // request.url resolves to the container's internal host behind a reverse
    // proxy, which would send the browser to an unreachable address.
    return NextResponse.redirect(new URL(redirectUrl, process.env.WEB_URL!));
}
