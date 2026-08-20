import test from "node:test";
import assert from "node:assert/strict";

import {
	UNIFIED_MAILBOX_KINDS,
	isUnifiedMailboxKind,
	resolveRowMailbox,
	groupSelectionByMailbox,
	sumUnreadByKind,
	type MailboxContextMap,
} from "./unified-mailbox";

function ctx(mailboxId: string, identityId: string, withSync: boolean) {
	return {
		mailbox: { id: mailboxId, identityId, kind: "inbox", slug: "inbox" },
		identity: { id: identityId, publicId: `pub-${identityId}` },
		sync: withSync ? { mailboxId } : null,
	} as unknown as MailboxContextMap[string];
}

test("isUnifiedMailboxKind accepts exactly the four supported kinds", () => {
	for (const kind of UNIFIED_MAILBOX_KINDS) {
		assert.equal(isUnifiedMailboxKind(kind), true);
	}
	assert.equal(isUnifiedMailboxKind("archive"), false);
	assert.equal(isUnifiedMailboxKind("drafts"), false);
	assert.equal(isUnifiedMailboxKind(""), false);
});

test("resolveRowMailbox returns the context belonging to the row's own mailbox", () => {
	const map: MailboxContextMap = {
		"mbx-a": ctx("mbx-a", "id-a", true),
		"mbx-b": ctx("mbx-b", "id-b", false),
	};

	assert.equal(resolveRowMailbox(map, { mailboxId: "mbx-b" })?.mailbox.id, "mbx-b");
	assert.equal(resolveRowMailbox(map, { mailboxId: "mbx-b" })?.identity.id, "id-b");
});

test("resolveRowMailbox carries each account's own sync row, not a shared one", () => {
	const map: MailboxContextMap = {
		"mbx-a": ctx("mbx-a", "id-a", true),
		"mbx-b": ctx("mbx-b", "id-b", false),
	};

	assert.notEqual(resolveRowMailbox(map, { mailboxId: "mbx-a" })?.sync, null);
	assert.equal(resolveRowMailbox(map, { mailboxId: "mbx-b" })?.sync, null);
});

test("resolveRowMailbox returns null for a row whose mailbox is absent", () => {
	assert.equal(resolveRowMailbox({}, { mailboxId: "missing" }), null);
});

test("groupSelectionByMailbox splits a mixed-account selection by mailbox", () => {
	const rows = [
		{ threadId: "t1", mailboxId: "mbx-a" },
		{ threadId: "t2", mailboxId: "mbx-b" },
		{ threadId: "t3", mailboxId: "mbx-a" },
	];

	const groups = groupSelectionByMailbox(rows, new Set(["t1", "t2", "t3"]));
	const byId = new Map(groups.map((g) => [g.mailboxId, g.threadIds]));

	assert.equal(groups.length, 2);
	assert.deepEqual(byId.get("mbx-a"), ["t1", "t3"]);
	assert.deepEqual(byId.get("mbx-b"), ["t2"]);
});

test("groupSelectionByMailbox ignores rows that are not selected", () => {
	const rows = [
		{ threadId: "t1", mailboxId: "mbx-a" },
		{ threadId: "t2", mailboxId: "mbx-b" },
	];

	const groups = groupSelectionByMailbox(rows, new Set(["t2"]));

	assert.deepEqual(groups, [{ mailboxId: "mbx-b", threadIds: ["t2"] }]);
});

test("groupSelectionByMailbox ignores selected ids with no visible row", () => {
	const rows = [{ threadId: "t1", mailboxId: "mbx-a" }];

	const groups = groupSelectionByMailbox(rows, new Set(["t1", "gone"]));

	assert.deepEqual(groups, [{ mailboxId: "mbx-a", threadIds: ["t1"] }]);
});

test("groupSelectionByMailbox returns an empty list for an empty selection", () => {
	assert.deepEqual(groupSelectionByMailbox([{ threadId: "t1", mailboxId: "m" }], new Set()), []);
});

test("sumUnreadByKind adds up unread totals across accounts per kind", () => {
	const mailboxes = [
		{ id: "mbx-a", kind: "inbox" },
		{ id: "mbx-b", kind: "inbox" },
		{ id: "mbx-c", kind: "spam" },
	];
	const counts = new Map([
		["mbx-a", { unreadThreads: 2, unreadTotal: 5 }],
		["mbx-b", { unreadThreads: 1, unreadTotal: 3 }],
		["mbx-c", { unreadThreads: 1, unreadTotal: 1 }],
	]);

	assert.deepEqual(sumUnreadByKind(mailboxes, counts), { inbox: 8, spam: 1 });
});

test("sumUnreadByKind omits kinds with no counted mailbox", () => {
	const mailboxes = [{ id: "mbx-a", kind: "inbox" }];

	assert.deepEqual(sumUnreadByKind(mailboxes, new Map()), {});
});
