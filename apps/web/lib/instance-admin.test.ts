import assert from "node:assert/strict";
import test from "node:test";

import {
	isInstanceAdminEmail,
	isUserIdShape,
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

test("accepts a well-formed uuid as a user id", () => {
	assert.equal(isUserIdShape("1a8a9390-6370-4f75-b69c-97e74d8a4804"), true);
	assert.equal(isUserIdShape("1A8A9390-6370-4F75-B69C-97E74D8A4804"), true);
});

test("rejects anything that is not a uuid", () => {
	// Postgres raises "invalid input syntax for type uuid" on these, and the
	// action's error wrapper would surface that raw message to the client.
	assert.equal(isUserIdShape("not-a-uuid"), false);
	assert.equal(isUserIdShape("1a8a9390637 04f75b69c97e74d8a4804"), false);
	assert.equal(isUserIdShape("1a8a9390-6370-4f75-b69c"), false);
	assert.equal(isUserIdShape("1a8a9390-6370-4f75-b69c-97e74d8a4804x"), false);
	assert.equal(isUserIdShape(" 1a8a9390-6370-4f75-b69c-97e74d8a4804"), false);
});

test("rejects a missing user id", () => {
	assert.equal(isUserIdShape(undefined), false);
	assert.equal(isUserIdShape(null), false);
	assert.equal(isUserIdShape(""), false);
});
