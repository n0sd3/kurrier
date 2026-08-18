import test from "node:test";
import assert from "node:assert/strict";
import { shouldAlert, type AlertableAccount } from "./should-alert";

const NOW = new Date("2026-08-18T12:00:00Z");
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 60 * 60 * 1000);

const account = (
	overrides: Partial<AlertableAccount> = {},
): AlertableAccount => ({
	status: "connected",
	errorCount: 0,
	alertedStatus: null,
	lastAlertedAt: null,
	...overrides,
});

test("a healthy account is never alerted", () => {
	assert.equal(shouldAlert(account(), NOW), false);
});

test("a newly revoked account alerts immediately", () => {
	assert.equal(shouldAlert(account({ status: "revoked" }), NOW), true);
});

test("an error below the threshold does not alert", () => {
	assert.equal(
		shouldAlert(account({ status: "error", errorCount: 2 }), NOW),
		false,
	);
});

test("an error reaching the threshold alerts", () => {
	assert.equal(
		shouldAlert(account({ status: "error", errorCount: 3 }), NOW),
		true,
	);
});

test("an already alerted account stays quiet inside the 24h window", () => {
	const acc = account({
		status: "revoked",
		alertedStatus: "revoked",
		lastAlertedAt: hoursAgo(23),
	});
	assert.equal(shouldAlert(acc, NOW), false);
});

test("an already alerted account reminds after 24h", () => {
	const acc = account({
		status: "revoked",
		alertedStatus: "revoked",
		lastAlertedAt: hoursAgo(25),
	});
	assert.equal(shouldAlert(acc, NOW), true);
});

test("escalating from error to revoked alerts again inside the 24h window", () => {
	const acc = account({
		status: "revoked",
		alertedStatus: "error",
		lastAlertedAt: hoursAgo(1),
	});
	assert.equal(shouldAlert(acc, NOW), true);
});

test("a recovered account is not alerted even though it was alerted before", () => {
	const acc = account({
		status: "connected",
		alertedStatus: "revoked",
		lastAlertedAt: hoursAgo(48),
	});
	assert.equal(shouldAlert(acc, NOW), false);
});
