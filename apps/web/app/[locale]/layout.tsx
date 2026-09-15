import type { Metadata, Viewport } from "next";
import { getDictionary, hasLocale } from "@/lib/dictionaries";
import { JetBrains_Mono, Plus_Jakarta_Sans } from "next/font/google";
import { cookies } from "next/headers";
import "../globals.css";
import { PwaRegister } from "@/components/common/pwa-register";
import { APPLE_SPLASH_SCREENS } from "@/lib/apple-splash-screens";
import { getPublicEnv } from "@schema";
import {
	MODE_COOKIE,
	RESOLVED_COOKIE,
	THEME_COOKIE,
	type ThemeMode,
	ThemeModeSchema,
	type ThemeName,
	ThemeNameSchema,
} from "@schema/types/themes";
import { AppearanceProvider } from "@/components/providers/appearance-provider";
import { ConfigProvider } from "@/components/providers/config-provider";
import { SiteFeaturesProvider } from "@/components/providers/site-features-provider";
import "@mantine/core/styles.css";
import "@mantine/dates/styles.css";
import {
	MantineProvider,
	mantineHtmlProps,
} from "@mantine/core";
import { DatesProvider } from "@mantine/dates";
import { ModalsProvider } from "@mantine/modals";
import { DictionaryProvider } from "@/components/providers/dictionary-provider";
import { DAYJS_LOCALES } from "@/lib/locale";
import { createMantineTheme } from "@/lib/mantine-theme";
import { DISTRIBUTION_CONFIG } from "@distribution/config";

const jakartaSans = Plus_Jakarta_Sans({
	variable: "--font-sans",
	subsets: ["cyrillic-ext", "latin"],
});
const jetbrains = JetBrains_Mono({
	variable: "--font-mono",
	subsets: ["cyrillic", "latin"],
});

export const metadata: Metadata = {
	title: "Kurrier",
	description: "Mailbox, but nice.",
	manifest: "/manifest.json",
	icons: {
		icon: [
			{ url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
			{ url: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
		],
		apple: "/icons/apple-touch-icon.png",
	},
	appleWebApp: {
		capable: true,
		statusBarStyle: "default",
		title: "Kurrier",
		startupImage: APPLE_SPLASH_SCREENS,
	},
	other: {
		// Next only emits the modern unprefixed "mobile-web-app-capable" tag;
		// older iOS releases still key standalone mode off the apple-prefixed one.
		"apple-mobile-web-app-capable": "yes",
	},
};

export const viewport: Viewport = {
	themeColor: "#2563EB",
	viewportFit: "cover",
	// Pinch zoom is disabled by request, to keep the app feeling native rather
	// than like a zoomable web page. Note this costs users who rely on zooming
	// to read; the 16px rule in globals.css still keeps focus from zooming.
	maximumScale: 1,
	userScalable: false,
};

export default async function RootLayout({
	children,
	params,
}: {
	children: React.ReactNode;
	params: Promise<{ locale: string }>;
}) {
	const { locale: urlLocale } = await params;
	// The [locale] URL segment is the canonical source of truth. proxy.ts
	// already validates/redirects to a known locale before any route here
	// ever matches, so this fallback is just defensive.
	const lang = hasLocale(urlLocale) ? urlLocale : "en";
	const jar = await cookies();
	const theme: ThemeName = ThemeNameSchema.catch("indigo").parse(
		jar.get(THEME_COOKIE)?.value,
	);
	const mode: ThemeMode = ThemeModeSchema.catch("system").parse(
		jar.get(MODE_COOKIE)?.value,
	);

	const resolved = jar.get(RESOLVED_COOKIE)?.value as
		| Partial<ThemeMode>
		| undefined;
	const initialDark =
		mode === "dark" ? true : mode === "light" ? false : resolved === "dark";

	const publicConfig = getPublicEnv();
	const { theme: mantineTheme, colorScheme } = createMantineTheme({
		theme,
		mode,
	});
	const dict = await getDictionary(lang);

	return (
		<html
			lang={lang}
			data-theme={theme}
			className={`${initialDark ? "dark" : ""}`}
			{...mantineHtmlProps}
		>
			<body
				className={`${jakartaSans.variable} ${jetbrains.variable} font-sans bg-background text-foreground antialiased`}
			>
				<AppearanceProvider initialTheme={theme} initialMode={mode}>
					<ConfigProvider value={publicConfig}>
						<SiteFeaturesProvider value={DISTRIBUTION_CONFIG.features}>
							<MantineProvider
								theme={mantineTheme}
								defaultColorScheme={colorScheme}
							>
								<DatesProvider settings={{ locale: DAYJS_LOCALES[lang] }}>
									<DictionaryProvider dict={dict}>
										<ModalsProvider>{children}</ModalsProvider>
									</DictionaryProvider>
								</DatesProvider>
							</MantineProvider>
						</SiteFeaturesProvider>
					</ConfigProvider>
				</AppearanceProvider>
				<PwaRegister />
			</body>
		</html>
	);
}

export function generateStaticParams() {
	return DISTRIBUTION_CONFIG.locales.map((locale) => ({
		locale,
	}));
}
