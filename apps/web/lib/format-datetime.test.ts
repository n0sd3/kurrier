import assert from "node:assert/strict";
import test from "node:test";

import { formatDateTime } from "./format-datetime";

// Output is locale- and timezone-dependent by design, so these assert the
// properties that hold everywhere rather than a fixed string.

test("renders a dash for a missing value", () => {
	assert.equal(formatDateTime(null), "-");
	assert.equal(formatDateTime(undefined), "-");
	assert.equal(formatDateTime(""), "-");
});

test("formats a Date into a non-empty string", () => {
	const out = formatDateTime(new Date("2026-08-17T14:30:00Z"));
	assert.notEqual(out, "-");
	assert.ok(out.length > 0);
});

test("treats a Date and its ISO string identically", () => {
	const date = new Date("2026-08-17T14:30:00Z");
	assert.equal(formatDateTime(date), formatDateTime(date.toISOString()));
});

test("distinguishes two different instants", () => {
	const earlier = formatDateTime(new Date("2026-08-17T09:00:00Z"));
	const later = formatDateTime(new Date("2026-08-17T21:00:00Z"));
	assert.notEqual(earlier, later);
});
