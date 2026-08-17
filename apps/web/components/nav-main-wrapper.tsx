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
