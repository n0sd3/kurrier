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

    const extensionNavItems = kurrierWeb.navigation.dashboard();

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
