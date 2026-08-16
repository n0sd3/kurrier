import { normalizeForSearch } from "./contact-search";

export type ContactAddress = {
	country: string | null;
	streetAddress: string | null;
	streetAddressLine2: string | null;
	city: string | null;
	state: string | null;
	code: string | null;
};

export type DuplicateCandidate = {
	id: string;
	firstName: string;
	lastName?: string | null;
	company?: string | null;
	jobTitle?: string | null;
	department?: string | null;
	notes?: string | null;
	profilePicture?: string | null;
	profilePictureXs?: string | null;
	createdAt?: string | Date | null;
	emails?: { address: string }[] | null;
	phones?: { code?: string | null; number: string }[] | null;
	addresses?: ContactAddress[] | null;
};

export type DuplicateReason = "name" | "email" | "phone";

export type DuplicateGroup = {
	contacts: DuplicateCandidate[];
	reasons: DuplicateReason[];
};

/** Names that carry no identity, so they must not group contacts together. */
const PLACEHOLDER_NAMES = new Set(["unknown"]);

const MIN_PHONE_DIGITS = 8;

export function nameKey(contact: DuplicateCandidate): string | null {
	const full = normalizeForSearch(
		`${contact.firstName ?? ""} ${contact.lastName ?? ""}`,
	);
	if (!full) return null;
	if (PLACEHOLDER_NAMES.has(full)) return null;
	return full;
}

export function emailKeys(contact: DuplicateCandidate): string[] {
	return (contact.emails ?? [])
		.map((e) => normalizeForSearch(e?.address ?? ""))
		.filter(Boolean);
}

export function phoneKeys(contact: DuplicateCandidate): string[] {
	return (contact.phones ?? [])
		.map((p) => `${p?.code ?? ""}${p?.number ?? ""}`.replace(/\D/g, ""))
		.filter((digits) => digits.length >= MIN_PHONE_DIGITS);
}

const KEY_BUILDERS: Record<
	DuplicateReason,
	(contact: DuplicateCandidate) => string[]
> = {
	name: (c) => {
		const key = nameKey(c);
		return key ? [key] : [];
	},
	email: emailKeys,
	phone: phoneKeys,
};

const REASON_ORDER: DuplicateReason[] = ["name", "email", "phone"];

class UnionFind {
	private parent = new Map<string, string>();

	find(id: string): string {
		const seen = this.parent.get(id);
		if (seen === undefined) {
			this.parent.set(id, id);
			return id;
		}
		if (seen === id) return id;
		const root = this.find(seen);
		this.parent.set(id, root);
		return root;
	}

	union(a: string, b: string): void {
		const rootA = this.find(a);
		const rootB = this.find(b);
		if (rootA !== rootB) this.parent.set(rootA, rootB);
	}
}

/** Buckets contact ids by every key a rule produces for them. */
function keyBuckets(
	contacts: DuplicateCandidate[],
	reason: DuplicateReason,
): Map<string, string[]> {
	const buckets = new Map<string, string[]>();

	for (const contact of contacts) {
		for (const key of KEY_BUILDERS[reason](contact)) {
			const bucket = buckets.get(key);
			if (bucket) bucket.push(contact.id);
			else buckets.set(key, [contact.id]);
		}
	}

	return buckets;
}

export function findDuplicateGroups(
	contacts: DuplicateCandidate[],
): DuplicateGroup[] {
	const unionFind = new UnionFind();
	for (const contact of contacts) unionFind.find(contact.id);

	const bucketsByReason = new Map<DuplicateReason, Map<string, string[]>>();

	for (const reason of REASON_ORDER) {
		const buckets = keyBuckets(contacts, reason);
		bucketsByReason.set(reason, buckets);

		for (const members of buckets.values()) {
			for (let i = 1; i < members.length; i++) {
				unionFind.union(members[0], members[i]);
			}
		}
	}

	const components = new Map<string, DuplicateCandidate[]>();
	for (const contact of contacts) {
		const root = unionFind.find(contact.id);
		const component = components.get(root);
		if (component) component.push(contact);
		else components.set(root, [contact]);
	}

	const groups: DuplicateGroup[] = [];

	for (const members of components.values()) {
		if (members.length < 2) continue;

		const memberIds = new Set(members.map((m) => m.id));
		const reasons = REASON_ORDER.filter((reason) => {
			const buckets = bucketsByReason.get(reason);
			if (!buckets) return false;
			for (const bucketMembers of buckets.values()) {
				const inGroup = bucketMembers.filter((id) => memberIds.has(id));
				if (new Set(inGroup).size > 1) return true;
			}
			return false;
		});

		groups.push({ contacts: members, reasons });
	}

	return groups.sort((a, b) => b.contacts.length - a.contacts.length);
}
