import test from "node:test";
import assert from "node:assert/strict";
import { buildPushPayloads } from "./build-push-payloads";

const msg = (overrides: Partial<Parameters<typeof buildPushPayloads>[0][number]> = {}) => ({
	threadId: "thread-1",
	subject: "Hello",
	from: { value: [{ name: "Ada Lovelace", address: "ada@example.com" }], html: "", text: "" },
	...overrides,
});

test("empty input produces no payloads", () => {
	assert.deepEqual(buildPushPayloads([]), []);
});

test("1-3 messages produce one payload per message", () => {
	const messages = [msg({ threadId: "t1" }), msg({ threadId: "t2" }), msg({ threadId: "t3" })];
	const payloads = buildPushPayloads(messages);

	assert.equal(payloads.length, 3);
	assert.deepEqual(payloads[0], { title: "Ada Lovelace", body: "Hello", threadId: "t1" });
});

test("falls back to the sender's address when there's no name", () => {
	const payloads = buildPushPayloads([
		msg({ from: { value: [{ name: "", address: "ada@example.com" }], html: "", text: "" } }),
	]);
	assert.equal(payloads[0].title, "ada@example.com");
});

test("falls back to a generic subject when missing", () => {
	const payloads = buildPushPayloads([msg({ subject: null })]);
	assert.equal(payloads[0].body, "(no subject)");
});

test("4+ messages collapse into a single grouped payload with no threadId", () => {
	const messages = [msg({ threadId: "t1" }), msg({ threadId: "t2" }), msg({ threadId: "t3" }), msg({ threadId: "t4" })];
	const payloads = buildPushPayloads(messages);

	assert.deepEqual(payloads, [{ title: "4 new emails", body: "Tap to open your inbox", threadId: null }]);
});
