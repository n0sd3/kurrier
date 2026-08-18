import test from "node:test";
import assert from "node:assert/strict";
import { buildAccountAlert } from "./build-account-alert";

test("a revoked account tells the user to reconnect", () => {
	const alert = buildAccountAlert({
		status: "revoked",
		email: "ada@example.com",
		workspacePublicId: "ws-1",
	});

	assert.equal(alert.title, "Google account disconnected");
	assert.match(alert.body, /ada@example\.com/);
	assert.match(alert.body, /reconnect/i);
	assert.equal(alert.url, "/w/ws-1/dashboard/platform/providers");
});

test("an erroring account says mail has stopped syncing", () => {
	const alert = buildAccountAlert({
		status: "error",
		email: "ada@example.com",
		workspacePublicId: "ws-1",
	});

	assert.equal(alert.title, "Google account is having trouble");
	assert.match(alert.body, /ada@example\.com/);
	assert.match(alert.body, /sync/i);
});
