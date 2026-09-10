import { addressBooks, contactLabels, contacts, labels } from "@db";
import { eq } from "drizzle-orm";
import type React from "react";
import type { ContactWithFavorite } from "@/components/dashboard/contacts/contacts-list";
import ContactsShell from "@/components/dashboard/contacts/contacts-shell";
import DashboardPageHeader from "@/components/dashboard/dashboard-page-header";
import { getWorkspacePublicId, rlsClient } from "@/lib/actions/clients";
import { storageObjectUrl } from "@/lib/storage-object-access";
import { getDictionary } from "@/lib/dictionaries";

export default async function ContactsLayout({
	children,
	params,
}: {
	children: React.ReactNode;
	params: Promise<{ locale: string }>;
}) {
	const { locale } = await params;
	const dict = await getDictionary(locale);
	const rls = await rlsClient();
	const rows = await rls((tx) =>
		tx
			.select({
				contact: contacts,
				labelSlug: labels.slug,
			})
			.from(contacts)
			.leftJoin(contactLabels, eq(contactLabels.contactId, contacts.id))
			.leftJoin(labels, eq(labels.id, contactLabels.labelId)),
	);

	const grouped = new Map<string, ContactWithFavorite & { labels: string[] }>();

	for (const row of rows) {
		const existing =
			grouped.get(row.contact.id) ??
			({
				...row.contact,
				isFavorite: false,
				labels: [],
			} as ContactWithFavorite & { labels: string[] });

		if (row.labelSlug && !existing.labels.includes(row.labelSlug)) {
			existing.labels.push(row.labelSlug);
		}

		if (row.labelSlug === "favorite") {
			existing.isFavorite = true;
		}

		grouped.set(row.contact.id, existing);
	}

	const allContacts = Array.from(grouped.values());

	const uniqueKeys = Array.from(
		new Set(
			allContacts.map((c) => c.profilePictureXs).filter(Boolean) as string[],
		),
	);

	const profileImages = uniqueKeys.map((key) => ({
		path: key,
		signedUrl: storageObjectUrl(key) as string,
	}));

	const workspacePublicId = await getWorkspacePublicId();
	const [userBook] = await rls((tx) => tx.select().from(addressBooks));

	return (
		<>
			<DashboardPageHeader title={dict.contacts.contacts} />

			<ContactsShell
				userContacts={allContacts}
				profileImages={profileImages}
				workspacePublicId={workspacePublicId}
				userBook={userBook}
			>
				{children}
			</ContactsShell>
		</>
	);
}
