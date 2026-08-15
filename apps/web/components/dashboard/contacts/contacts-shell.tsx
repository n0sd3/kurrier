"use client";

import React, {useState} from "react";
import ContactsList, {
	ContactWithFavorite,
} from "@/components/dashboard/contacts/contacts-list";
import NewContactButton from "@/components/dashboard/contacts/new-contact-button";
import { useParams, usePathname } from "next/navigation";
import { useMediaQuery } from "@mantine/hooks";
import { Search } from "lucide-react";
import {AddressBookEntity} from "@db";
export type ProfileImage = {
	path: string;
	signedUrl: string;
};


export default function ContactsShell({
	children,
	userContacts,
	profileImages,
	workspacePublicId,
	userBook
}: {
	children: React.ReactNode;
	userContacts: ContactWithFavorite[];
	profileImages: (ProfileImage | null)[];
	workspacePublicId: string;
	userBook: AddressBookEntity
}) {
	const pathname = usePathname();
	const params = useParams<{
		contactsPublicId?: string;
		labelSlug?: string;
	}>();

	const isMobile = useMediaQuery("(max-width: 768px)");

	const hasContactId = typeof params.contactsPublicId === "string";
	const isNewRoute = pathname.endsWith("/new");
	const isEditRoute = pathname.endsWith("/edit");

	const isDetailRoute = hasContactId || isNewRoute || isEditRoute;

	const showList = !isMobile || !isDetailRoute;
	const showDetail = !isMobile || isDetailRoute;
	const [selectedAddressBook, setSelectedAddressBook] = useState(userBook.id);
	const [searchQuery, setSearchQuery] = useState("");

	return (
		<main className="flex flex-1 flex-col h-[calc(100vh-4rem)] overflow-hidden p-3 sm:p-4">
			<div className="flex flex-1 min-h-0 overflow-hidden rounded-xl border bg-background/70">
				{showList && (
					<section
						className={
							isMobile
								? "flex-1 max-w-full flex-col bg-muted/40"
								: "flex max-w-full flex-col border-r bg-muted/40 md:w-80 lg:w-96"
						}
					>
						<div className="flex flex-col gap-2 border-b px-3 py-3">
							<div className="flex items-center justify-between">
								<span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
									All contacts
								</span>
								<div className={"flex gap-2"}>
									<NewContactButton workspacePublicId={workspacePublicId} />
								</div>
							</div>
							<div className="relative">
								<Search
									size={14}
									className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground"
								/>
								<input
									type="search"
									value={searchQuery}
									onChange={(e) => setSearchQuery(e.target.value)}
									placeholder="Search contacts"
									aria-label="Search contacts"
									className="w-full rounded-md border bg-background py-1.5 pl-7 pr-2 text-sm outline-none placeholder:text-muted-foreground focus-visible:ring-1 focus-visible:ring-ring"
								/>
							</div>
						</div>
						<ContactsList
							userContacts={userContacts}
							selectedAddressBook={selectedAddressBook}
							onAddressBookChange={setSelectedAddressBook}
							profileImages={profileImages}
							workspacePublicId={workspacePublicId}
							searchQuery={searchQuery}
						/>
					</section>
				)}

				{showDetail && (
					<section className="flex-1 flex-col bg-background/60">
						{children}
					</section>
				)}
			</div>
		</main>
	);
}
