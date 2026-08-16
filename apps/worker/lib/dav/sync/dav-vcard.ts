import type { ContactEntity } from "@db";
import { lookup as mimeLookup, extension as mimeExtension } from "mime-types";

export type ParsedContactFields = {
	firstName?: string | null;
	lastName?: string | null;
	company?: string | null;
	department?: string | null;
	jobTitle?: string | null;
	emails?: any[] | null;
	phones?: any[] | null;
	addresses?: any[] | null;
	notes?: string | null;
	dob?: string | null;
	categories?: string[];
	photo?: {
		type: string | null;
		mime: string | null;
		ext: string | null;
		base64?: string | null;
		url?: string | null;
	} | null;
};

/**
 * Parser próprio em vez do `vcf`: aquela lib divide componentes estruturados
 * (`N`, `ADR`) sem respeitar `\;`, devolve `ORG` como string única (juntando
 * company e department) e nunca faz unescape. Tudo isso quebra o round-trip
 * exigido pela §1 do contrato.
 */
type VCardLine = { name: string; params: Record<string, string>; value: string };

/** Unescape numa passada só, senão `\\n` (barra escapada + n) vira quebra de linha. */
function unescapeVCardValue(v: string): string {
	return v.replace(/\\(.)/g, (_, c: string) =>
		c === "n" || c === "N" ? "\n" : c,
	);
}

/** Divide em `sep` ignorando ocorrências escapadas com barra invertida. */
function splitUnescaped(value: string, sep: string): string[] {
	const out: string[] = [];
	let cur = "";
	for (let i = 0; i < value.length; i++) {
		const ch = value[i];
		if (ch === "\\" && i + 1 < value.length) {
			cur += ch + value[i + 1];
			i++;
			continue;
		}
		if (ch === sep) {
			out.push(cur);
			cur = "";
			continue;
		}
		cur += ch;
	}
	out.push(cur);
	return out;
}

function parseVCardLines(raw: string): VCardLine[] {
	// unfold antes de qualquer coisa (§1, regras de leitura)
	const unfolded = raw.replace(/\r\n[ \t]/g, "").replace(/\n[ \t]/g, "");
	const out: VCardLine[] = [];

	for (const line of unfolded.split(/\r?\n/)) {
		if (!line.trim()) continue;

		// primeiro `:` fora de aspas separa cabeçalho e valor
		let colon = -1;
		let quoted = false;
		for (let i = 0; i < line.length; i++) {
			const ch = line[i];
			if (ch === '"') quoted = !quoted;
			else if (ch === ":" && !quoted) {
				colon = i;
				break;
			}
		}
		if (colon === -1) continue;

		const head = line.slice(0, colon);
		const value = line.slice(colon + 1);
		const [nameRaw, ...paramParts] = head.split(";");

		const params: Record<string, string> = {};
		for (const p of paramParts) {
			const eq = p.indexOf("=");
			if (eq === -1) {
				// forma vCard 2.1 sem `TYPE=`, ex.: `TEL;CELL:`
				params.type = p.trim().toLowerCase();
			} else {
				params[p.slice(0, eq).trim().toLowerCase()] = p
					.slice(eq + 1)
					.trim()
					.replace(/^"|"$/g, "")
					.toLowerCase();
			}
		}

		// nome pode vir com prefixo de grupo, ex.: `item1.EMAIL`
		const name = (nameRaw.split(".").pop() ?? nameRaw).trim().toLowerCase();
		out.push({ name, params, value });
	}

	return out;
}

function normalizePhotoType(rawType: string | null): {
	mime: string | null;
	ext: string | null;
} {
	let mime: string | null = null;

	if (rawType) {
		const t = rawType.toLowerCase();
		// O contrato manda `TYPE=<mime>`; clientes antigos mandam só `JPEG`/`PNG`.
		if (t.startsWith("image/")) return { mime: t, ext: mimeExtension(t) || "jpg" };

		const looked = mimeLookup(t);
		if (looked) {
			mime = looked as string;
		} else {
			switch (t) {
				case "jpeg":
				case "jpg":
					mime = "image/jpeg";
					break;
				case "png":
					mime = "image/png";
					break;
				case "gif":
					mime = "image/gif";
					break;
			}
		}
	}

	if (!mime) mime = "image/jpeg";

	let ext = mimeExtension(mime);
	if (!ext) ext = "jpg";

	return { mime, ext };
}

export function parseVCardToContact(raw: string): ParsedContactFields {
	const props = parseVCardLines(raw);

	const findFirst = (name: string) => props.find((p) => p.name === name);
	const findAll = (name: string) => props.filter((p) => p.name === name);
	/** Componentes estruturados: divide em `;` não escapado e faz unescape de cada um. */
	const components = (value: string) =>
		splitUnescaped(value, ";").map(unescapeVCardValue);
	const text = (value: string) => unescapeVCardValue(value).trim();

	let firstName: string | null = null;
	let lastName: string | null = null;
	let company: string | null = null;
	let department: string | null = null;
	let jobTitle: string | null = null;
	const emails: any[] = [];
	const phones: any[] = [];
	const addresses: any[] = [];
	let notes: string | null = null;
	let dob: string | null = null;
	let categories: string[] = [];
	let photo: ParsedContactFields["photo"] = null;

	const nProp = findFirst("n");
	if (nProp) {
		const v = components(nProp.value);
		firstName = (v[1] ?? "").trim() || null;
		lastName = (v[0] ?? "").trim() || null;
	}

	if (!firstName && !lastName) {
		const fnProp = findFirst("fn");
		if (fnProp) {
			const fnVal = text(fnProp.value);
			if (fnVal) {
				const parts = fnVal.split(/\s+/);
				if (parts.length === 1) {
					firstName = parts[0];
				} else {
					firstName = parts.slice(0, -1).join(" ");
					lastName = parts[parts.length - 1];
				}
			}
		}
	}

	const orgProp = findFirst("org");
	if (orgProp) {
		const v = components(orgProp.value);
		company = (v[0] ?? "").trim() || null;
		department = (v[1] ?? "").trim() || null;
	}

	const titleProp = findFirst("title");
	if (titleProp) jobTitle = text(titleProp.value) || null;

	for (const p of findAll("email")) {
		const v = text(p.value);
		if (v) emails.push({ address: v });
	}

	for (const p of findAll("tel")) {
		const v = text(p.value);
		if (v) phones.push({ number: v, code: null });
	}

	for (const p of findAll("adr")) {
		const v = components(p.value);
		const addr = {
			streetAddressLine2: v[1]?.trim() || null,
			streetAddress: v[2]?.trim() || null,
			city: v[3]?.trim() || null,
			state: v[4]?.trim() || null,
			code: v[5]?.trim() || null,
			country: v[6]?.trim() || null,
		};
		if (Object.values(addr).some((x) => x && String(x).trim().length)) {
			addresses.push(addr);
		}
	}

	const bdayProp = findFirst("bday");
	if (bdayProp) {
		const rawDob = text(bdayProp.value);
		if (/^\d{8}$/.test(rawDob)) {
			dob = `${rawDob.slice(0, 4)}-${rawDob.slice(4, 6)}-${rawDob.slice(6, 8)}`;
		} else if (rawDob) {
			// aceita `YYYY-MM-DD` e qualquer outra coisa sem derrubar o parse
			dob = rawDob;
		}
	}

	const noteProp = findFirst("note");
	if (noteProp) notes = unescapeVCardValue(noteProp.value) || null;

	const catProp = findFirst("categories");
	if (catProp) {
		categories = splitUnescaped(catProp.value, ",")
			.map((c) => unescapeVCardValue(c).trim())
			.filter(Boolean);
	}

	const photoProp = findFirst("photo");
	if (photoProp) {
		const encoding = photoProp.params.encoding ?? null;
		const rawType = photoProp.params.type ?? null;
		const value = photoProp.value.trim();
		const { mime, ext } = normalizePhotoType(rawType);

		if (encoding === "b" || encoding === "base64") {
			photo = { type: rawType, mime, ext, base64: value || null };
		} else if (value.startsWith("http://") || value.startsWith("https://")) {
			photo = { type: rawType, mime, ext, url: value };
		} else if (photoProp.params.value === "uri" && value.startsWith("data:")) {
			const comma = value.indexOf(",");
			photo = { type: rawType, mime, ext, base64: value.slice(comma + 1) || null };
		}
	}

	return {
		firstName: firstName || "",
		lastName,
		company,
		department,
		jobTitle,
		emails,
		phones,
		addresses,
		notes,
		dob,
		categories,
		photo,
	};
}


/**
 * Merge de conflito (§2): o lado local vence campo a campo porque acabou de ser
 * escrito, mas todo campo que está vazio localmente herda o valor remoto e as
 * listas viram união — assim o lado perdedor nunca é descartado em silêncio.
 * Mora aqui, junto do parser, porque é puro: testável sem subir o client de DB.
 */
export function mergeRemoteIntoLocal(
	local: ContactEntity,
	remote: ParsedContactFields,
) {
	const pick = <K extends keyof ContactEntity>(key: K, remoteValue: unknown) => {
		const localValue = local[key];
		const localEmpty =
			localValue === null ||
			localValue === undefined ||
			(typeof localValue === "string" && localValue.trim() === "");
		return localEmpty && remoteValue ? remoteValue : localValue;
	};

	const union = <T>(a: T[], b: T[], key: (x: T) => string) => {
		const seen = new Set(a.map(key));
		return [...a, ...b.filter((x) => !seen.has(key(x)))];
	};

	return {
		firstName: pick("firstName", remote.firstName) as string,
		lastName: pick("lastName", remote.lastName) as string | null,
		company: pick("company", remote.company) as string | null,
		department: pick("department", remote.department) as string | null,
		jobTitle: pick("jobTitle", remote.jobTitle) as string | null,
		notes: pick("notes", remote.notes) as string | null,
		dob: pick("dob", remote.dob) as string | null,
		emails: union(
			local.emails ?? [],
			(remote.emails ?? []) as { address: string }[],
			(e) => e.address.toLowerCase(),
		),
		phones: union(
			local.phones ?? [],
			(remote.phones ?? []) as { code: string | null; number: string }[],
			(p) => p.number.replace(/\D/g, ""),
		),
		addresses: union(
			local.addresses ?? [],
			(remote.addresses ?? []) as ContactEntity["addresses"],
			// `JSON.stringify` não serve de chave aqui: `addresses` é jsonb e o
			// Postgres reordena as chaves, então o endereço lido do banco e o
			// recém-parseado do vCard geram strings diferentes para o mesmo
			// endereço — e o union duplicaria a cada 412. Compara por valor,
			// em ordem fixa.
			(a) =>
				[
					a?.streetAddress,
					a?.streetAddressLine2,
					a?.city,
					a?.state,
					a?.code,
					a?.country,
				]
					.map((x) => (x ?? "").trim().toLowerCase())
					.join(" "),
		),
	};
}
