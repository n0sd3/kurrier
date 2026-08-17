import { Temporal } from "@js-temporal/polyfill";

/**
 * Renders a timestamp in the viewer's own timezone and locale. Extracted so the
 * dashboard tables that show a "Created" column agree on the format instead of
 * each carrying its own copy.
 */
export function formatDateTime(input?: Date | string | null): string {
	if (!input) return "-";

	const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
	const instant =
		input instanceof Date
			? Temporal.Instant.fromEpochMilliseconds(input.getTime())
			: Temporal.Instant.from(input);

	return instant
		.toZonedDateTimeISO(tz)
		.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}
