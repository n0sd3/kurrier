import { DISTRIBUTION_CONFIG } from "@distribution/config";
import { LOCALE_HEADER } from "@/lib/locale-header";

export { LOCALE_HEADER };

export const LOCALES = DISTRIBUTION_CONFIG.locales;

export type Locale = (typeof LOCALES)[number];

export const hasLocale = (locale: string): locale is Locale =>
	(LOCALES as readonly string[]).includes(locale);

// dayjs (and @mantine/dates, which resolves month/weekday names through it)
// uses lowercase, hyphenated locale ids that don't always match our BCP-47
// locale codes.
export const DAYJS_LOCALES: Record<Locale, string> = {
	en: "en",
	"pt-BR": "pt-br",
	ko: "en",
	pl: "pl",
	ru: "ru",
};

const DEFAULT_LOCALE: Locale = "en";

// proxy.ts resolves the locale for every request (from the URL, the "locale"
// cookie, or Accept-Language) and stamps it on this header. Reading it here
// gives any Server Component ambient access to the current locale without
// receiving params.locale explicitly.
//
// LOCALES/hasLocale/DAYJS_LOCALES above are also imported by Client
// Components (language-switcher.tsx, dictionary-provider.tsx, ...), so
// next/headers stays a dynamic import scoped to this function instead of a
// static top-of-file import — a static one (next/headers pulls in
// "server-only" itself) would break bundling of those client components.
export async function getLocale(): Promise<Locale> {
	const { headers } = await import("next/headers");
	const locale = (await headers()).get(LOCALE_HEADER);
	return locale && hasLocale(locale) ? locale : DEFAULT_LOCALE;
}
