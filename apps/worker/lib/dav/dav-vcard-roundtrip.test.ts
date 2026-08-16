import test from "node:test";
import assert from "node:assert/strict";
import { buildVCard, foldLine } from "./dav-build-card";
import { mergeRemoteIntoLocal, parseVCardToContact } from "./sync/dav-vcard";
import type { ContactEntity } from "@db";

// Contato com tudo que a §1 do contrato exige, incluindo `,` e `;` para exercitar escape.
const contact = {
	id: "11111111-2222-3333-4444-555555555555",
	firstName: "Ada",
	lastName: "Love;lace",
	company: "Acme, Inc.",
	department: "R&D;Core",
	jobTitle: "Chief, Engineer",
	emails: [{ address: "ada@example.com" }, { address: "ada2@example.com" }],
	phones: [
		{ code: "BR", number: "11999998888" },
		{ code: null, number: "+442071234567" },
	],
	addresses: [
		{
			streetAddress: "R. das Flores, 10",
			streetAddressLine2: "apto 4; fundos",
			city: "São Paulo",
			state: "SP",
			code: "01000-000",
			country: "BR",
		},
	],
	dob: "1990-05-12",
	notes: "linha 1\nlinha 2, com vírgula; e ponto e vírgula\\barra",
	profilePicture: null,
} as unknown as ContactEntity;

const labelItems = ["Work, VIP", "Família"];

test("foldLine respeita 75/74 octetos e não parte UTF-8", () => {
	const long = `NOTE:${"á".repeat(200)}`;
	const folded = foldLine(long);
	const parts = folded.split("\r\n");

	assert.ok(parts.length > 1, "linha longa tem que ser dobrada");
	assert.ok(Buffer.byteLength(parts[0], "utf8") <= 75);
	for (const cont of parts.slice(1)) {
		assert.equal(cont[0], " ", "continuação tem que começar com espaço");
		assert.ok(Buffer.byteLength(cont, "utf8") <= 75); // 1 espaço + 74
	}
	// unfold devolve exatamente a linha original: nenhum caractere partido
	assert.equal(folded.replace(/\r\n /g, ""), long);
});

test("foldLine deixa linha curta intacta", () => {
	assert.equal(foldLine("UID:abc"), "UID:abc");
});

test("round-trip preserva todos os campos da §1", async () => {
	const raw = await buildVCard(contact, labelItems);

	for (const line of raw.split("\r\n")) {
		assert.ok(
			Buffer.byteLength(line, "utf8") <= 75,
			`linha acima de 75 octetos: ${line.slice(0, 40)}…`,
		);
	}
	assert.ok(raw.startsWith("BEGIN:VCARD\r\nVERSION:3.0\r\n"));
	assert.ok(raw.includes(`UID:${contact.id}`));
	assert.ok(raw.includes("BDAY:19900512"), "BDAY tem que ser compacto");

	const parsed = parseVCardToContact(raw);

	assert.equal(parsed.firstName, "Ada");
	assert.equal(parsed.lastName, "Love;lace");
	assert.equal(parsed.company, "Acme, Inc.");
	assert.equal(parsed.department, "R&D;Core");
	assert.equal(parsed.jobTitle, "Chief, Engineer");
	assert.equal(parsed.dob, "1990-05-12");
	assert.equal(parsed.notes, contact.notes);

	assert.deepEqual(
		parsed.emails?.map((e: any) => e.address),
		["ada@example.com", "ada2@example.com"],
	);
	assert.deepEqual(
		parsed.phones?.map((p: any) => p.number),
		["+5511999998888", "+442071234567"],
	);
	assert.deepEqual(parsed.addresses?.[0], {
		streetAddressLine2: "apto 4; fundos",
		streetAddress: "R. das Flores, 10",
		city: "São Paulo",
		state: "SP",
		code: "01000-000",
		country: "BR",
	});
	assert.deepEqual(parsed.categories, labelItems);
});

test("leitura aceita BDAY com hífen, linhas dobradas e propriedade desconhecida", () => {
	const raw = [
		"BEGIN:VCARD",
		"VERSION:3.0",
		"N:Turing;Alan;;;",
		"BDAY:1912-06-23",
		"X-COISA-QUE-NAO-EXISTE;FOO=bar:qualquer",
		"NOTE:come" + "\r\n co",
		"UID:x",
		"END:VCARD",
	].join("\r\n");

	const parsed = parseVCardToContact(raw);
	assert.equal(parsed.dob, "1912-06-23");
	assert.equal(parsed.firstName, "Alan");
	assert.equal(parsed.lastName, "Turing");
	assert.equal(parsed.notes, "comeco");
});

test("PHOTO base64 dobrada volta inteira", async () => {
	const base64 = Buffer.from("x".repeat(400)).toString("base64");
	const raw = foldLine(`PHOTO;ENCODING=b;TYPE=image/png:${base64}`);
	const parsed = parseVCardToContact(
		["BEGIN:VCARD", "VERSION:3.0", "N:A;B;;;", raw, "UID:y", "END:VCARD"].join(
			"\r\n",
		),
	);

	assert.equal(parsed.photo?.base64, base64);
	assert.equal(parsed.photo?.mime, "image/png");
});

test("merge do 412 não duplica endereço com ordem de chave do jsonb", () => {
	// jsonb reordena chaves: o endereço lido do banco não tem a mesma ordem do
	// objeto recém-parseado do vCard. Mesmo endereço, um só na saída.
	const doBanco = {
		city: "Sao Paulo",
		code: "01000-000",
		state: "SP",
		country: "BR",
		streetAddress: "R. das Flores, 10",
		streetAddressLine2: "apto 4",
	};
	const doVCard = {
		streetAddressLine2: "apto 4",
		streetAddress: "R. das Flores, 10",
		city: "Sao Paulo",
		state: "SP",
		code: "01000-000",
		country: "BR",
	};

	const merged = mergeRemoteIntoLocal(
		{ addresses: [doBanco], emails: [], phones: [] } as any,
		{ addresses: [doVCard] } as any,
	);

	assert.equal(merged.addresses.length, 1);
});
