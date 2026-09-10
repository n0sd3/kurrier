import { redirect } from "next/navigation";
import { isSignedIn } from "@/lib/actions/auth";
import { resolveLandingPath } from "@/lib/actions/clients";
import { withLocale } from "@/lib/utils";

export default async function DashboardLayout({
	children,
	params,
}: {
	children: React.ReactNode;
	params: Promise<{ locale: string }>;
}) {
	const { locale } = await params;
	const user = await isSignedIn();

	if (user) {
		redirect(withLocale(locale, await resolveLandingPath()));
	}

	return <>{children}</>;
}
