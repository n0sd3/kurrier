"use client"
import React from 'react';
import {ChevronRight, Cog} from "lucide-react";
import { Button } from "@mantine/core";
import Link from "next/link";
import {useParams} from "next/navigation";

function IdentitySettingsLink({identityLabel, workspacePublicId}: {identityLabel: string, workspacePublicId: string}) {
    const params = useParams()
    return <Link href={`/w/${workspacePublicId}/dashboard/mail/${params.identityPublicId}/settings`} className={"shrink-0"} aria-label={identityLabel}>
        <Button size={"sm"} className={"!rounded-full"} leftSection={<Cog size={20} />} variant={"light"} rightSection={<ChevronRight size={16} className={"hidden sm:block"} />}>
            <span className={"hidden max-w-[14rem] truncate font-medium sm:inline-block"}>{identityLabel}</span>
        </Button>
    </Link>
}

export default IdentitySettingsLink;
