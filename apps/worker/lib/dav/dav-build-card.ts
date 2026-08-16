import { Buffer } from "node:buffer";
import { lookup } from "mime-types";
import type { ContactEntity } from "@db";
import { getCountryDataList } from "countries-list";
import {GetObjectCommand} from "@aws-sdk/client-s3";
import {s3} from "../../lib/create-s3-client";

function escapeVCardValue(value: string) {
	return value
		.replace(/\\/g, "\\\\")
		.replace(/\r\n?/g, "\n")
		.replace(/\n/g, "\\n")
		.replace(/,/g, "\\,")
		.replace(/;/g, "\\;");
}

/**
 * Line folding do RFC 6350 §3.2: primeira linha com no máximo 75 octetos,
 * continuações com no máximo 74 octetos e prefixadas por um espaço.
 * O corte é feito em octetos (não em caracteres) sem partir sequência UTF-8.
 */
export function foldLine(line: string) {
	const buf = Buffer.from(line, "utf8");
	if (buf.length <= 75) return line;

	const chunks: string[] = [];
	let start = 0;
	let limit = 75;

	while (start < buf.length) {
		let end = Math.min(start + limit, buf.length);
		// recua enquanto o byte de corte for continuação UTF-8 (10xxxxxx)
		while (end > start + 1 && end < buf.length && (buf[end] & 0xc0) === 0x80) {
			end--;
		}
		chunks.push(buf.subarray(start, end).toString("utf8"));
		start = end;
		limit = 74;
	}

	return chunks.join("\r\n ");
}

const countryData = getCountryDataList();
const phoneByCountry = new Map<string, string>(
	countryData.map((c) => [c.iso2, String(c.phone).split(",")[0].trim()]),
);


async function addPhotoToVCard(lines: string[], contact: ContactEntity) {
	if (!contact.profilePicture) return;

	const command = new GetObjectCommand({
		Bucket: process.env.S3_BUCKET!,
		Key: contact.profilePicture,
	});

	const response = await s3.send(command);
	if (!response.Body) return;

	const chunks: Buffer[] = [];
	for await (const chunk of response.Body as any) {
		chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
	}

	const buffer = Buffer.concat(chunks);
	const base64 = buffer.toString("base64");
	const mime = lookup(contact.profilePicture) || "image/jpeg";

	lines.push(`PHOTO;ENCODING=b;TYPE=${mime}:${base64}`);
}

export async function buildVCard(
	contact: ContactEntity,
	labelItems?: (string | null)[],
) {
	const lines: string[] = [];

	const fn = [contact.firstName, contact.lastName].filter(Boolean).join(" ");
	const nParts = [contact.lastName ?? "", contact.firstName ?? "", "", "", ""];
	lines.push("BEGIN:VCARD");
	lines.push("VERSION:3.0");
	lines.push(`FN:${escapeVCardValue(fn)}`);
	lines.push(`N:${nParts.map(escapeVCardValue).join(";")}`);
	if (contact.company || contact.department) {
		const orgParts = [contact.company ?? "", contact.department ?? ""];
		lines.push(`ORG:${orgParts.map(escapeVCardValue).join(";")}`);
	}

	if (contact.jobTitle) {
		lines.push(`TITLE:${escapeVCardValue(contact.jobTitle)}`);
	}
	if (contact.emails?.length) {
		for (const e of contact.emails) {
			if (!e.address) continue;
			lines.push(`EMAIL;TYPE=INTERNET:${escapeVCardValue(e.address)}`);
		}
	}
	if (contact.phones?.length) {
		for (const p of contact.phones) {
			if (!p.number) continue;
			let fullNumber = p.number;

			if (p.code) {
				const dial = phoneByCountry.get(p.code.toUpperCase());
				if (dial) {
					fullNumber = `+${dial}${p.number}`;
				} else {
					fullNumber = `${p.code}${p.number}`;
				}
			}
			lines.push(`TEL;TYPE=CELL:${escapeVCardValue(fullNumber)}`);
		}
	}
	if (contact.addresses?.length) {
		for (const a of contact.addresses) {
			const adrParts = [
				"",
				a.streetAddressLine2 ?? "",
				a.streetAddress ?? "",
				a.city ?? "",
				a.state ?? "",
				a.code ?? "",
				a.country ?? "",
			];

			lines.push(`ADR;TYPE=HOME:${adrParts.map(escapeVCardValue).join(";")}`);
		}
	}
	if (contact.dob) {
		const compactDob = contact.dob.replace(/-/g, "");
		lines.push(`BDAY:${compactDob}`);
	}
	if (contact.notes) {
		lines.push(`NOTE:${escapeVCardValue(contact.notes)}`);
	}

	await addPhotoToVCard(lines, contact);
	if (labelItems?.length) {
		const cats = labelItems
			.filter((l): l is string => Boolean(l))
			.map(escapeVCardValue);
		if (cats.length) lines.push(`CATEGORIES:${cats.join(",")}`);
	}
	lines.push(`UID:${contact.id}`);
	lines.push("END:VCARD");
	return lines.map(foldLine).join("\r\n");
}
