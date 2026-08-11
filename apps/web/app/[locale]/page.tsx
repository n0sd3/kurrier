import { redirect } from "next/navigation";
import { resolveLandingPath } from "@/lib/actions/clients";
import { withLocale } from "@/lib/utils";

// proxy.ts rewrites every locale-less path to /<locale>/..., so "/" lands here
// rather than on app/page.tsx. Without this route the app's own entry URL 404s.
export default async function LocaleHome({
	params,
}: {
	params: Promise<{ locale: string }>;
}) {
	const { locale } = await params;

	redirect(withLocale(locale, await resolveLandingPath()));
}
