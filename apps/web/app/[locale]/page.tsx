import { DISTRIBUTION_PAGES } from "@distribution/pages";

// proxy.ts rewrites every locale-less path to /<locale>/..., so "/" lands here
// rather than on app/page.tsx. Without this route the app's own entry URL 404s.
export default async function LocaleRootPage({ params }: {
	params: Promise<{ locale: string }>;
}) {
	const { locale } = await params;

	return (
		<DISTRIBUTION_PAGES.RootPage locale={locale}/>
	);
}
