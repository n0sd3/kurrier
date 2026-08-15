export type SearchableContact = {
	firstName: string;
	lastName?: string | null;
	company?: string | null;
	jobTitle?: string | null;
	department?: string | null;
	notes?: string | null;
	emails?: { address: string }[] | null;
	phones?: { code?: string | null; number: string }[] | null;
};

/** Lowercases and strips accents so "jose" matches "José". */
export function normalizeForSearch(value: string): string {
	return value
		.normalize("NFD")
		.replace(/[\u0300-\u036f]/g, "")
		.toLowerCase()
		.replace(/\s+/g, " ")
		.trim();
}

function textHaystack(contact: SearchableContact): string {
	const parts = [
		contact.firstName,
		contact.lastName,
		contact.company,
		contact.jobTitle,
		contact.department,
		contact.notes,
		...(contact.emails ?? []).map((e) => e?.address),
		...(contact.phones ?? []).map((p) => `${p?.code ?? ""} ${p?.number ?? ""}`),
	];

	return normalizeForSearch(parts.filter(Boolean).join(" "));
}

function digitsOnly(value: string): string {
	return value.replace(/\D/g, "");
}

function phoneHaystack(contact: SearchableContact): string {
	return (contact.phones ?? [])
		.map((p) => digitsOnly(`${p?.code ?? ""}${p?.number ?? ""}`))
		.join(" ");
}

export function contactMatchesQuery(
	contact: SearchableContact,
	query: string,
): boolean {
	const needle = normalizeForSearch(query);
	if (!needle) return true;

	if (textHaystack(contact).includes(needle)) return true;

	// A digit-bearing query should match a phone however it happens to be
	// punctuated, so compare digits against digits.
	const needleDigits = digitsOnly(needle);
	if (needleDigits) {
		return phoneHaystack(contact)
			.split(" ")
			.some((phone) => phone.includes(needleDigits));
	}

	return false;
}

export function filterContactsByQuery<T extends SearchableContact>(
	contacts: T[],
	query: string,
): T[] {
	if (!normalizeForSearch(query)) return contacts;
	return contacts.filter((contact) => contactMatchesQuery(contact, query));
}
