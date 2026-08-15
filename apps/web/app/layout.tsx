import type { Metadata, Viewport } from "next";
import { cookies } from "next/headers";
import { getLocale } from "@/lib/locale";
import { JetBrains_Mono, Plus_Jakarta_Sans } from "next/font/google";
import "./globals.css";
import { ConfigProvider } from "@/components/providers/config-provider";
import { AppearanceProvider } from "@/components/providers/appearance-provider";
import { PwaRegister } from "@/components/common/pwa-register";
import { APPLE_SPLASH_SCREENS } from "@/lib/apple-splash-screens";
import {
	MODE_COOKIE,
	RESOLVED_COOKIE,
	THEME_COOKIE,
	ThemeMode,
	ThemeModeSchema,
	ThemeName,
	ThemeNameSchema,
} from "@schema/types/themes";
import { getPublicEnv } from "@schema";
import "@mantine/core/styles.css";
import "@mantine/dates/styles.css";
import {
	ColorSchemeScript,
	MantineProvider,
	mantineHtmlProps,
} from "@mantine/core";
import { createMantineTheme } from "@/lib/mantine-theme";
import { ModalsProvider } from "@mantine/modals";

const jakartaSans = Plus_Jakarta_Sans({
	variable: "--font-sans",
	subsets: ["latin"],
});
const jetbrains = JetBrains_Mono({
	variable: "--font-mono",
	subsets: ["latin"],
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
}: {
	children: React.ReactNode;
}) {
	const jar = await cookies();
	const locale = await getLocale();
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

	return (
		<html
			lang={locale}
			data-theme={theme}
			className={`${initialDark ? "dark" : ""}`}
			{...mantineHtmlProps}
		>
			<head>
				<ColorSchemeScript
					defaultColorScheme={colorScheme}
					nonce="8IBTHwOdqNKAWeKl7plt8g=="
				/>
			</head>
			<body
				className={`${jakartaSans.variable} ${jetbrains.variable} font-sans bg-background text-foreground antialiased`}
			>
				<AppearanceProvider initialTheme={theme} initialMode={mode}>
					<ConfigProvider value={publicConfig}>
						<MantineProvider
							theme={mantineTheme}
							defaultColorScheme={colorScheme}
						>
							<ModalsProvider>{children}</ModalsProvider>
						</MantineProvider>
					</ConfigProvider>
				</AppearanceProvider>
				<PwaRegister />
			</body>
		</html>
	);
}
