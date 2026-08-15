import React from "react";
import { redirect } from "next/navigation";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { Separator } from "@/components/ui/separator";
import { getWorkspacePublicId } from "@/lib/actions/clients";
import { fetchIdentityMailboxList } from "@/lib/actions/mailbox";

async function Page() {
	// This route has no mailbox of its own. On desktop the sidebar is always
	// visible so the user just picks one, but on mobile it is an off-canvas
	// drawer — landing here without a mailbox would trap the user. Send them to
	// a real mailbox instead, preferring the inbox.
	const identityMailboxes = await fetchIdentityMailboxList();

	const firstWithMailbox = identityMailboxes.find(
		(entry) => entry.mailboxes.length > 0,
	);

	if (firstWithMailbox) {
		const target =
			firstWithMailbox.mailboxes.find((mbx) => mbx.kind === "inbox") ??
			firstWithMailbox.mailboxes[0];

		const workspacePublicId = await getWorkspacePublicId();
		redirect(
			`/w/${workspacePublicId}/dashboard/mail/${firstWithMailbox.identity.publicId}/${target.slug}`,
		);
	}

	// No identity has a mailbox yet (e.g. a freshly created workspace). Keep the
	// placeholder, but with a header so the drawer stays reachable on mobile.
	return (
		<>
			<header className="flex items-center gap-2 border-b bg-background/60 backdrop-blur py-3 px-4">
				<SidebarTrigger className="-ml-1" />
				<Separator
					orientation="vertical"
					className="data-[orientation=vertical]:h-4"
				/>
				<h1 className="text-sm font-semibold text-foreground/80">Mail</h1>
			</header>

			<div
				className={
					"flex flex-1 flex-col items-center justify-center p-4 text-center"
				}
			>
				Select a mailbox to view the emails.
			</div>
		</>
	);
}

export default Page;
