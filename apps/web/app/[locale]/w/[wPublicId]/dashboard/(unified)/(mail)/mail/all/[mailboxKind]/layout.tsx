import React, { ReactNode } from "react";
import { notFound } from "next/navigation";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { Separator } from "@/components/ui/separator";
import { isUnifiedMailboxKind } from "@/lib/unified-mailbox";

const TITLE: Record<string, string> = {
	inbox: "Inbox",
	sent: "Sent",
	spam: "Spam",
	trash: "Trash",
};

type LayoutProps = {
	children: ReactNode;
	params: Promise<{ mailboxKind: string }>;
};

export default async function UnifiedMailLayout({
	children,
	params,
}: LayoutProps) {
	const { mailboxKind } = await params;

	if (!isUnifiedMailboxKind(mailboxKind)) notFound();

	return (
		<>
			<header className="bg-background sticky top-0 flex shrink-0 items-center gap-2 border-b p-3 sm:p-4 z-50">
				<SidebarTrigger className="-ml-1 size-11 shrink-0 md:size-7 [&_svg]:size-5 md:[&_svg]:size-4" />
				<Separator
					orientation="vertical"
					className="mr-2 hidden shrink-0 sm:block data-[orientation=vertical]:h-4"
				/>
				<h1 className="text-sm font-semibold text-foreground/80">
					{TITLE[mailboxKind]} · All accounts
				</h1>
			</header>

			{children}
		</>
	);
}
