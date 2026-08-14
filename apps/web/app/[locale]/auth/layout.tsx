import { isSignedIn } from "@/lib/actions/auth";
import { resolveLandingPath } from "@/lib/actions/clients";
import { withLocale } from "@/lib/utils";
import { redirect } from "next/navigation";

export default async function DashboardLayout({
	children,
	params,
}: {
	children: React.ReactNode;
	params: Promise<{ locale: string }>;
}) {
	const user = await isSignedIn();

	if (user) {
		const { locale } = await params;
		redirect(withLocale(locale, await resolveLandingPath()));
	}

	return <>{children}</>;
}
