import test from "node:test";
import assert from "node:assert/strict";

import { isKeyReadableBy, storageObjectUrl } from "./storage-object-access";

const USER = "11111111-1111-1111-1111-111111111111";
const OTHER = "22222222-2222-2222-2222-222222222222";

test("allows a contact photo owned by the user", () => {
	assert.equal(
		isKeyReadableBy(`private/${USER}/contacts/abc123/photo_xs.jpg`, USER),
		true,
	);
});

test("allows an attachment owned by the user", () => {
	assert.equal(
		isKeyReadableBy(`private/${USER}/msg-id/file.pdf`, USER),
		true,
	);
});

test("allows a raw eml owned by the user", () => {
	assert.equal(isKeyReadableBy(`eml/${USER}/mailbox/msg.eml`, USER), true);
	assert.equal(isKeyReadableBy(`eml/${USER}/eml-id`, USER), true);
});

test("rejects an object owned by another user", () => {
	assert.equal(
		isKeyReadableBy(`private/${OTHER}/contacts/abc/photo.jpg`, USER),
		false,
	);
});

test("rejects an unknown storage root", () => {
	assert.equal(isKeyReadableBy(`drive/${USER}/secret.txt`, USER), false);
});

test("rejects traversal attempts", () => {
	assert.equal(isKeyReadableBy(`private/${USER}/../${OTHER}/x.jpg`, USER), false);
});

test("rejects a bare prefix with no object", () => {
	assert.equal(isKeyReadableBy(`private/${USER}`, USER), false);
	assert.equal(isKeyReadableBy(`private/${USER}/`, USER), false);
});

test("rejects empty or malformed keys", () => {
	assert.equal(isKeyReadableBy("", USER), false);
	assert.equal(isKeyReadableBy("photo.jpg", USER), false);
});

test("builds a same-origin proxy url that survives a round trip", () => {
	const key = `private/${USER}/contacts/abc 123/photo_xs.jpg`;
	const url = storageObjectUrl(key);
	assert.ok(url);

	assert.equal(url.startsWith("/api/storage/"), true);

	const decoded = decodeURIComponent(url.slice("/api/storage/".length));
	assert.equal(decoded, key);
});

test("returns null for a missing key", () => {
	assert.equal(storageObjectUrl(null), null);
	assert.equal(storageObjectUrl(undefined), null);
});
