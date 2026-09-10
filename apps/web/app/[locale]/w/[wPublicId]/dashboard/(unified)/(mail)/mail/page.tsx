import { Mail } from "lucide-react";
import { Suspense } from "react";
import { redirect } from "next/navigation";
import Loading from "@/app/loading";
import ContentPlaceholder from "@/components/common/content-placeholder";
import DashboardPageHeader from "@/components/dashboard/dashboard-page-header";
import { getWorkspacePublicId } from "@/lib/actions/clients";
import { fetchIdentityMailboxList } from "@/lib/actions/mailbox";
import { getDictionary, type Locale } from "@/lib/dictionaries";

async function MailHomeContent({
	params,
}: {
	params: Promise<{ locale: Locale }>;
}) {
	const { locale } = await params;
	const dict = await getDictionary(locale);

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
		<div className="flex min-h-0 flex-1 flex-col">
			<DashboardPageHeader title={dict.mailbox.mailTitle} />
			<ContentPlaceholder
				icon={<Mail className="size-5" aria-hidden="true" />}
				title={dict.mailbox.chooseMailbox}
				description={dict.mailbox.selectMailboxDescription}
			/>
		</div>
	);
}

export default function Page({
	params,
}: {
	params: Promise<{ locale: Locale }>;
}) {
	return (
		<Suspense fallback={<Loading />}>
			<MailHomeContent params={params} />
		</Suspense>
	);
}
