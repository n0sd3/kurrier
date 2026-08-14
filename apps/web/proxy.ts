import {type NextRequest, NextResponse} from "next/server";
import { updateSession } from "@/lib/supabase/middleware";
import { LOCALE_HEADER } from "@/lib/locale-header";

const locales = ["en", "ko", "pt"];
const defaultLocale = "en";

function detectLocale(request: NextRequest) {
	const locale =
		request.cookies.get("locale")?.value ||
		request.headers.get("accept-language")?.split(",")[0]?.split("-")[0] ||
		defaultLocale;
	return locales.includes(locale) ? locale : defaultLocale;
}

export async function proxy(request: NextRequest) {

	if (request.nextUrl.pathname.startsWith("/api")) {
		return await updateSession(request);
	}

	const pathname = request.nextUrl.pathname;
	const pathnameHasLocale = locales.some(
		(locale) =>
			pathname === `/${locale}` ||
			pathname.startsWith(`/${locale}/`),
	);

	// A bare "/" or "/<locale>" resolves its destination in app/[locale]/page.tsx,
	// but that redirect only runs on hydration, so the 404 shell flashes first.
	// Signed-out visitors need no lookup, so send them straight to login. This
	// has to be checked before the locale rewrite below: a rewrite resolves
	// internally without re-entering this middleware, so a bare "/" would
	// otherwise skip this shortcut entirely.
	const isLocaleRoot =
		pathname === "/" || locales.some((locale) => pathname === `/${locale}`);

	if (isLocaleRoot && !request.cookies.get("session")) {
		const locale = pathnameHasLocale ? pathname.slice(1) : detectLocale(request);
		const url = request.nextUrl.clone();
		url.pathname = `/${locale}/auth/login`;
		return NextResponse.redirect(url);
	}

	if (!pathnameHasLocale) {
		// Internal links/redirects across the app are built without a locale
		// prefix (e.g. "/w/{id}/dashboard/..."). Rewriting instead of
		// redirecting resolves those in a single request instead of bouncing
		// the browser through an extra 3xx round trip on every navigation.
		const locale = detectLocale(request);
		const url = request.nextUrl.clone();
		url.pathname = `/${locale}${pathname}`;
		const headers = new Headers(request.headers);
		headers.set(LOCALE_HEADER, locale);
		return NextResponse.rewrite(url, { request: { headers } });
	}

	// Stamp the resolved locale on a request header so Server Components can
	// read it ambiently via lib/locale.ts's getLocale(), without needing
	// params.locale threaded down to them.
	const locale = pathname.split("/")[1];
	return await updateSession(request, { [LOCALE_HEADER]: locale });
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
