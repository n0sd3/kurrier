import { redirect } from "next/navigation";
import { DistributionLandingPage } from "@distribution/pages";
import { DEFAULT_DISTRIBUTION, DISTRIBUTION_CONFIG } from "@distribution/config";
import { getDefaultWorkspacePath, isSignedIn } from "@/lib/actions/auth";
import { resolveLandingPath } from "@/lib/actions/clients";
import { withLocale } from "@/lib/utils";

// proxy.ts rewrites every locale-less path to /<locale>/..., so "/" lands here
// rather than on app/page.tsx. Without this route the app's own entry URL 404s.
export default async function LocaleRootPage({
	params,
}: {
	params: Promise<{ locale: string }>;
}) {
	const { locale } = await params;

	// Only the default (oss) distribution uses this fork's own workspace/mailbox
	// aware redirect; other distributions get their own landing experience.
	if (DISTRIBUTION_CONFIG.id !== DEFAULT_DISTRIBUTION) {
		const user = await isSignedIn();
		const workspacePath = user
			? await getDefaultWorkspacePath(user)
			: null;

		return (
			<DistributionLandingPage locale={locale} workspacePath={workspacePath} />
		);
	}

	redirect(withLocale(locale, await resolveLandingPath()));
}
