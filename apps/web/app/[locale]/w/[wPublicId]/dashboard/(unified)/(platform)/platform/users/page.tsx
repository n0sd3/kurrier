import React from "react";
import ManageInstanceUsers from "@/components/dashboard/admin/manage-instance-users";
import { Separator } from "@/components/ui/separator";
import { SidebarTrigger } from "@/components/ui/sidebar";
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
