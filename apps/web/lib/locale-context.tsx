"use client";

import { createContext, useContext } from "react";
import type { Dictionary, Locale } from "@/lib/dictionaries";

const LocaleContext = createContext<{
	locale: Locale;
	dictionary: Dictionary;
} | null>(null);

export function LocaleProvider({
	locale,
	dictionary,
	children,
}: {
	locale: Locale;
	dictionary: Dictionary;
	children: React.ReactNode;
}) {
	return (
		<LocaleContext.Provider value={{ locale, dictionary }}>
			{children}
		</LocaleContext.Provider>
	);
}

function useLocaleContext() {
	const ctx = useContext(LocaleContext);
	if (!ctx) {
		throw new Error("useLocale/useDictionary must be used within LocaleProvider");
	}
	return ctx;
}

export function useLocale(): Locale {
	return useLocaleContext().locale;
}

export function useDictionary(): Dictionary {
	return useLocaleContext().dictionary;
}
