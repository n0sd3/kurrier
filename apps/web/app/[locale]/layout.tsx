import { getDictionary, hasLocale } from "@/lib/dictionaries";
import { LocaleProvider } from "@/lib/locale-context";

export default async function LocaleLayout({
	children,
	params,
}: {
	children: React.ReactNode;
	params: Promise<{ locale: string }>;
}) {
	const { locale: rawLocale } = await params;
	const locale = hasLocale(rawLocale) ? rawLocale : "en";
	const dictionary = await getDictionary(locale);

	return (
		<LocaleProvider locale={locale} dictionary={dictionary}>
			{children}
		</LocaleProvider>
	);
}
