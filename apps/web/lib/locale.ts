import "server-only";
import { headers } from "next/headers";
import { hasLocale, type Locale } from "@/lib/dictionaries";
import { LOCALE_HEADER } from "@/lib/locale-header";

export { LOCALE_HEADER };
const DEFAULT_LOCALE: Locale = "en";

// proxy.ts resolves the locale for every request (from the URL, the "locale"
// cookie, or Accept-Language) and stamps it on this header. Reading it here
// gives any Server Component ambient access to the current locale without
// receiving params.locale explicitly.
export async function getLocale(): Promise<Locale> {
	const locale = (await headers()).get(LOCALE_HEADER);
	return locale && hasLocale(locale) ? locale : DEFAULT_LOCALE;
}
