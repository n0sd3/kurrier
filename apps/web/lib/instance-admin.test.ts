import assert from "node:assert/strict";
import test from "node:test";

import {
	isInstanceAdminEmail,
	parseAdminEmails,
	validateNewPassword,
} from "./instance-admin";

test("parses a comma separated list into normalized entries", () => {
	assert.deepEqual(parseAdminEmails(" A@x.com , b@y.com "), [
		"a@x.com",
		"b@y.com",
	]);
});

test("drops empty entries from a trailing comma", () => {
	assert.deepEqual(parseAdminEmails("a@x.com,"), ["a@x.com"]);
});

test("treats a missing or blank list as empty", () => {
	assert.deepEqual(parseAdminEmails(undefined), []);
	assert.deepEqual(parseAdminEmails(null), []);
	assert.deepEqual(parseAdminEmails(""), []);
	assert.deepEqual(parseAdminEmails("   "), []);
	assert.deepEqual(parseAdminEmails(" , "), []);
});

test("admits an email listed in the env var", () => {
	assert.equal(isInstanceAdminEmail("a@x.com", "a@x.com,b@y.com"), true);
});

test("ignores case and surrounding whitespace on both sides", () => {
	assert.equal(isInstanceAdminEmail(" A@X.com ", "a@x.com"), true);
	assert.equal(isInstanceAdminEmail("a@x.com", " A@X.COM "), true);
});

test("refuses an email that is absent from the list", () => {
	assert.equal(isInstanceAdminEmail("c@z.com", "a@x.com,b@y.com"), false);
});

test("refuses a substring of a listed address", () => {
	assert.equal(isInstanceAdminEmail("x.com", "a@x.com"), false);
	assert.equal(isInstanceAdminEmail("@x.com", "a@x.com"), false);
});

test("refuses everyone when the list is unset or empty", () => {
	assert.equal(isInstanceAdminEmail("a@x.com", undefined), false);
	assert.equal(isInstanceAdminEmail("a@x.com", ""), false);
	assert.equal(isInstanceAdminEmail("a@x.com", "  "), false);
});

test("refuses a missing candidate email even with a populated list", () => {
	assert.equal(isInstanceAdminEmail(undefined, "a@x.com"), false);
	assert.equal(isInstanceAdminEmail(null, "a@x.com"), false);
	assert.equal(isInstanceAdminEmail("", "a@x.com"), false);
});

test("requires a password of at least eight characters", () => {
	assert.equal(validateNewPassword("abcdefgh"), null);
	assert.match(String(validateNewPassword("abcdefg")), /at least 8/);
});

test("requires a password at all", () => {
	assert.match(String(validateNewPassword("")), /required/);
	assert.match(String(validateNewPassword(undefined)), /required/);
	assert.match(String(validateNewPassword(null)), /required/);
});

test("does not trim the password before measuring it", () => {
	// A password is opaque; spaces are legitimate characters, and trimming would
	// silently accept something shorter than the stated minimum.
	assert.equal(validateNewPassword("  abcdef  "), null);
	assert.match(String(validateNewPassword("   a   ")), /at least 8/);
});
