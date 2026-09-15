import { type NextRequest, NextResponse } from "next/server";
import { LOCALES } from "@/lib/locale";
import { updateSession } from "@/lib/supabase/middleware";
import { LOCALE_HEADER } from "@/lib/locale-header";
import { DISTRIBUTION_CONFIG } from "@distribution/config";

const locales = LOCALES;
const defaultLocale = DISTRIBUTION_CONFIG.defaultLocale;

// Accept-Language / the "locale" cookie may carry a region subtag our
// configured locale list doesn't (e.g. "pt-BR" vs "pt"). Match exactly
// first, then fall back to matching on the primary subtag.
function normalizeLocale(tag: string): string | null {
	const lower = tag.toLowerCase();
	const exact = locales.find((l) => l.toLowerCase() === lower);

	if (exact) return exact;

	const primary = lower.split("-")[0];

	return locales.find(
		(l) => l.toLowerCase().split("-")[0] === primary,
	) ?? null;
}

function getRedirectLocale(request: NextRequest) {
	const pathname = request.nextUrl.pathname;

	const pathnameHasLocale = locales.some(
		(locale) =>
			pathname === `/${locale}` ||
			pathname.startsWith(`/${locale}/`),
	);

	if (pathnameHasLocale) return null;

	const cookieLocale = request.cookies.get("locale")?.value;

	const acceptLanguageTag = request.headers
		.get("accept-language")
		?.split(",")[0];

	return (
		(cookieLocale && normalizeLocale(cookieLocale)) ||
		(acceptLanguageTag && normalizeLocale(acceptLanguageTag)) ||
		defaultLocale
	);
}

export async function proxy(request: NextRequest) {
	const pathname = request.nextUrl.pathname;

	if (pathname.startsWith("/api")) {
		return await updateSession(request);
	}

	// Distribution extension routes (registered pages outside the localized
	// /[locale] tree, e.g. the marketing/landing routes) render their own
	// layout and don't need locale resolution here.
	if (pathname === "/distribution" || pathname.startsWith("/distribution/")) {
		return await updateSession(request);
	}

	const pathnameHasLocale = locales.some(
		(locale) =>
			pathname === `/${locale}` ||
			pathname.startsWith(`/${locale}/`),
	);

	if (pathnameHasLocale) {
		// Stamp the resolved locale on a request header so Server Components
		// can read it ambiently via lib/locale.ts's getLocale(), without
		// needing params.locale threaded down to them.
		const locale = pathname.split("/")[1];
		return await updateSession(request, { [LOCALE_HEADER]: locale });
	}

	const requiresLocale =
		pathname === "/auth" ||
		pathname.startsWith("/auth/") ||
		pathname === "/w" ||
		pathname.startsWith("/w/");

	if (requiresLocale) {
		const redirectLocale = getRedirectLocale(request);

		if (redirectLocale) {
			const url = request.nextUrl.clone();
			url.pathname = `/${redirectLocale}${pathname}`;

			return NextResponse.redirect(url);
		}

		return await updateSession(request);
	}

	// Everything else (e.g. a bare "/") is an extension/distribution route
	// rather than part of the localized app tree, so it's handed off to the
	// distribution catch-all instead of getting a locale prefix.
	const url = request.nextUrl.clone();
	url.pathname = pathname === "/" ? "/distribution" : `/distribution${pathname}`;

	return NextResponse.rewrite(url);
}

export const config = {
	matcher: [
		/*
		 * Match all request paths except for the ones starting with:
		 * - _next/static (static files)
		 * - _next/image (image optimization files)
		 * - any path with a file extension (favicon.ico, robots.txt,
		 *   sitemap.xml, manifest.json, fonts, images, etc.) — route
		 *   segments in this app are nanoid-based and never contain a dot,
		 *   so this only ever matches static files under /public.
		 */
		"/((?!_next/static|_next/image|.*\\..*).*)",
	],
};
