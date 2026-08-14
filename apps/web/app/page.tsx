import { redirect } from "next/navigation";
import { resolveLandingPath } from "@/lib/actions/clients";
import { withLocale } from "@/lib/utils";

// proxy.ts redirects every locale-less path before Next routing runs, so this
// should be unreachable in practice; kept as a safe fallback matching
// app/[locale]/page.tsx's landing logic.
export default async function Home() {
	redirect(withLocale("en", await resolveLandingPath()));
}
