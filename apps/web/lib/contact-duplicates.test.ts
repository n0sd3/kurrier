import test from "node:test";
import assert from "node:assert/strict";

import {
	findDuplicateGroups,
	type DuplicateCandidate,
} from "./contact-duplicates";

function contact(
	id: string,
	overrides: Partial<DuplicateCandidate> = {},
): DuplicateCandidate {
	return {
		id,
		firstName: id,
		lastName: null,
		company: null,
		jobTitle: null,
		department: null,
		notes: null,
		profilePicture: null,
		profilePictureXs: null,
		createdAt: "2026-01-01T00:00:00.000Z",
		emails: [],
		phones: [],
		addresses: [],
		...overrides,
	};
}

const ids = (group: { contacts: DuplicateCandidate[] }) =>
	group.contacts.map((c) => c.id).sort();

test("groups contacts sharing an identical full name", () => {
	const groups = findDuplicateGroups([
		contact("a", { firstName: "José", lastName: "Silva" }),
		contact("b", { firstName: "jose", lastName: "silva" }),
		contact("c", { firstName: "Ana" }),
	]);

	assert.equal(groups.length, 1);
	assert.deepEqual(ids(groups[0]), ["a", "b"]);
	assert.deepEqual(groups[0].reasons, ["name"]);
});

test("groups contacts sharing an email even when names differ", () => {
	const groups = findDuplicateGroups([
		contact("a", { firstName: "Ana", emails: [{ address: "X@Example.com" }] }),
		contact("b", { firstName: "Bruno", emails: [{ address: "x@example.com" }] }),
	]);

	assert.equal(groups.length, 1);
	assert.deepEqual(ids(groups[0]), ["a", "b"]);
	assert.deepEqual(groups[0].reasons, ["email"]);
});

test("groups contacts sharing a phone regardless of formatting", () => {
	const groups = findDuplicateGroups([
		contact("a", { firstName: "Ana", phones: [{ code: "+55", number: "(11) 99988-7766" }] }),
		contact("b", { firstName: "Bruno", phones: [{ code: null, number: "5511999887766" }] }),
	]);

	assert.equal(groups.length, 1);
	assert.deepEqual(ids(groups[0]), ["a", "b"]);
	assert.deepEqual(groups[0].reasons, ["phone"]);
});

test("ignores phone numbers shorter than 8 digits", () => {
	const groups = findDuplicateGroups([
		contact("a", { firstName: "Ana", phones: [{ code: null, number: "1234" }] }),
		contact("b", { firstName: "Bruno", phones: [{ code: null, number: "1234" }] }),
	]);

	assert.deepEqual(groups, []);
});

test("groups transitively across different rules", () => {
	const groups = findDuplicateGroups([
		contact("a", { firstName: "Ana", lastName: "Lima" }),
		contact("b", { firstName: "Ana", lastName: "Lima", emails: [{ address: "shared@x.com" }] }),
		contact("c", { firstName: "Carlos", emails: [{ address: "shared@x.com" }] }),
	]);

	assert.equal(groups.length, 1);
	assert.deepEqual(ids(groups[0]), ["a", "b", "c"]);
	assert.deepEqual([...groups[0].reasons].sort(), ["email", "name"]);
});

test("does not group placeholder Unknown names", () => {
	const groups = findDuplicateGroups([
		contact("a", { firstName: "Unknown", emails: [{ address: "one@x.com" }] }),
		contact("b", { firstName: "unknown", emails: [{ address: "two@x.com" }] }),
		contact("c", { firstName: "Unknown", emails: [{ address: "three@x.com" }] }),
	]);

	assert.deepEqual(groups, []);
});

test("still groups Unknown contacts that share an email", () => {
	const groups = findDuplicateGroups([
		contact("a", { firstName: "Unknown", emails: [{ address: "same@x.com" }] }),
		contact("b", { firstName: "Unknown", emails: [{ address: "same@x.com" }] }),
	]);

	assert.equal(groups.length, 1);
	assert.deepEqual(ids(groups[0]), ["a", "b"]);
	assert.deepEqual(groups[0].reasons, ["email"]);
});

test("excludes singletons and empty names", () => {
	const groups = findDuplicateGroups([
		contact("a", { firstName: "Ana" }),
		contact("b", { firstName: "Bruno" }),
	]);

	assert.deepEqual(groups, []);
});

test("sorts the largest group first", () => {
	const groups = findDuplicateGroups([
		contact("a", { firstName: "Dup" }),
		contact("b", { firstName: "Dup" }),
		contact("c", { firstName: "Dup" }),
		contact("d", { firstName: "Pair" }),
		contact("e", { firstName: "Pair" }),
	]);

	assert.equal(groups.length, 2);
	assert.equal(groups[0].contacts.length, 3);
	assert.equal(groups[1].contacts.length, 2);
});
