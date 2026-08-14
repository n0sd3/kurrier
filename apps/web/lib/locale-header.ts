// Shared by proxy.ts (edge middleware) and lib/locale.ts (server components) —
// kept import-free so proxy.ts doesn't have to pull in next/headers/server-only.
export const LOCALE_HEADER = "x-locale";
