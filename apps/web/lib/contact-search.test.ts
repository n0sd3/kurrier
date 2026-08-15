import test from "node:test";
import assert from "node:assert/strict";

import { filterContactsByQuery, type SearchableContact } from "./contact-search";

const jose: SearchableContact = {
	firstName: "José",
	lastName: "Gonçalves",
	company: "Padaria Central",
	jobTitle: "Gerente",
	department: "Vendas",
	notes: "Conheci na feira",
	emails: [{ address: "jose@padaria.com.br" }],
	phones: [{ code: "+55", number: "(11) 99988-7766" }],
};

const ana: SearchableContact = {
	firstName: "Ana",
	lastName: "Silva",
	company: null,
	jobTitle: null,
	department: null,
	notes: null,
	emails: [{ address: "ana.silva@example.com" }],
	phones: [],
};

const sparse: SearchableContact = {
	firstName: "Bob",
	lastName: null,
	company: null,
	jobTitle: null,
	department: null,
	notes: null,
	emails: [],
	phones: [],
};

const all = [jose, ana, sparse];

const names = (rows: SearchableContact[]) => rows.map((r) => r.firstName);

test("an empty query returns every contact", () => {
	assert.deepEqual(names(filterContactsByQuery(all, "")), ["José", "Ana", "Bob"]);
	assert.deepEqual(names(filterContactsByQuery(all, "   ")), ["José", "Ana", "Bob"]);
});

test("matches a first name ignoring case", () => {
	assert.deepEqual(names(filterContactsByQuery(all, "ana")), ["Ana"]);
	assert.deepEqual(names(filterContactsByQuery(all, "ANA")), ["Ana"]);
});

test("matches names without typing the accents", () => {
	assert.deepEqual(names(filterContactsByQuery(all, "jose")), ["José"]);
	assert.deepEqual(names(filterContactsByQuery(all, "goncalves")), ["José"]);
});

test("matches an accented query against accented data", () => {
	assert.deepEqual(names(filterContactsByQuery(all, "José")), ["José"]);
});

test("matches across first and last name together", () => {
	assert.deepEqual(names(filterContactsByQuery(all, "jose goncalves")), ["José"]);
	assert.deepEqual(names(filterContactsByQuery(all, "ana silva")), ["Ana"]);
});

test("matches a partial email", () => {
	assert.deepEqual(names(filterContactsByQuery(all, "padaria.com")), ["José"]);
	assert.deepEqual(names(filterContactsByQuery(all, "ana.silva@")), ["Ana"]);
});

test("matches a phone number regardless of formatting", () => {
	assert.deepEqual(names(filterContactsByQuery(all, "11999887766")), ["José"]);
	assert.deepEqual(names(filterContactsByQuery(all, "99988-7766")), ["José"]);
	assert.deepEqual(names(filterContactsByQuery(all, "5511999887766")), ["José"]);
});

test("does not treat a short digit query as matching everything", () => {
	assert.deepEqual(names(filterContactsByQuery(all, "0000")), []);
});

test("matches company, job title, department and notes", () => {
	assert.deepEqual(names(filterContactsByQuery(all, "padaria central")), ["José"]);
	assert.deepEqual(names(filterContactsByQuery(all, "gerente")), ["José"]);
	assert.deepEqual(names(filterContactsByQuery(all, "vendas")), ["José"]);
	assert.deepEqual(names(filterContactsByQuery(all, "feira")), ["José"]);
});

test("returns nothing when nothing matches", () => {
	assert.deepEqual(names(filterContactsByQuery(all, "zzzz")), []);
});

test("handles contacts with missing fields without throwing", () => {
	assert.deepEqual(names(filterContactsByQuery(all, "bob")), ["Bob"]);
});

test("ignores surrounding whitespace in the query", () => {
	assert.deepEqual(names(filterContactsByQuery(all, "  ana  ")), ["Ana"]);
});
