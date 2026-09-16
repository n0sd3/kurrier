import React from "react";
import { kurrierWeb } from "@distribution/kurrier-web";
import { NavMain } from "@/components/nav-main";
import {
    getWorkspacePublicId,
    getWorkspaceRole,
} from "@/lib/actions/clients";
import { isCurrentUserInstanceAdmin } from "@/lib/actions/admin-users";

async function NavMainWrapper() {
    const [workspacePublicId, workspaceRole, isInstanceAdmin] = await Promise.all([
        getWorkspacePublicId(),
        getWorkspaceRole(),
        isCurrentUserInstanceAdmin(),
    ]);

    // A LucideIcon is a component (a function), and functions can't cross the
    // server/client boundary as props. Rendering it into an element here,
    // before it reaches the client NavMain, is what makes it serializable.
    const extensionNavItems = kurrierWeb.navigation.dashboard().map((item) => {
        const Icon = item.icon;
        return {
            id: item.id,
            title: item.title,
            path: item.path,
            ownerOnly: item.ownerOnly,
            icon: Icon ? <Icon className="mt-0.5" /> : null,
        };
    });

    return (
        <NavMain
            workspacePublicId={workspacePublicId}
            workspaceRole={workspaceRole || "member"}
            isInstanceAdmin={isInstanceAdmin}
            extensionNavItems={extensionNavItems}
        />
    );
}

export default NavMainWrapper;
