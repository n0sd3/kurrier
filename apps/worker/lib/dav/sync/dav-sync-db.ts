import {
	AddressBookEntity,
	addressBooks,
	contactLabels,
	ContactEntity,
	contacts,
	db,
	labels,
} from "@db";
import {and, eq, inArray, isNull, notInArray} from "drizzle-orm";
import slugify from "@sindresorhus/slugify";
import {davAddressbooks, davCards, DavCardsEntity, davDb} from "../dav-schema";
import { parseVCardToContact } from "./dav-vcard";
import { nanoid } from "nanoid";
import { davParsePhoto } from "./dav-profile-image";
import {createContact} from "../../../lib/dav/dav-create-contact";

const fetchContactData = async (card: DavCardsEntity) => {
	const vcardBytes = card.carddata as Uint8Array;
	return Buffer.from(vcardBytes).toString("utf8");
};

/**
 * Reconcilia `CATEGORIES` do cartão com os labels de contato (§1). Ausência da
 * propriedade significa "sem tags", então os vínculos existentes são removidos.
 */
const syncContactCategories = async (
	contactId: string,
	book: AddressBookEntity,
	categories: string[],
) => {
	const wanted = [...new Set(categories.map((c) => c.trim()).filter(Boolean))];

	if (!wanted.length) {
		await db.delete(contactLabels).where(eq(contactLabels.contactId, contactId));
		return;
	}

	const slugs = wanted.map((name) => slugify(name.toLowerCase()));

	const existing = await db
		.select()
		.from(labels)
		.where(
			and(
				eq(labels.workspaceId, book.workspaceId),
				eq(labels.scope, "contact"),
				inArray(labels.slug, slugs),
			),
		);

	const bySlug = new Map(existing.map((l) => [l.slug, l]));

	for (let i = 0; i < wanted.length; i++) {
		if (bySlug.has(slugs[i])) continue;
		const [created] = await db
			.insert(labels)
			.values({
				name: wanted[i],
				slug: slugs[i],
				scope: "contact",
				ownerId: book.ownerId,
				workspaceId: book.workspaceId,
			})
			.onConflictDoNothing()
			.returning();
		if (created) bySlug.set(created.slug, created);
	}

	const labelIds = slugs.map((s) => bySlug.get(s)?.id).filter(Boolean) as string[];
	if (!labelIds.length) return;

	await db
		.delete(contactLabels)
		.where(
			and(
				eq(contactLabels.contactId, contactId),
				notInArray(contactLabels.labelId, labelIds),
			),
		);

	await db
		.insert(contactLabels)
		.values(
			labelIds.map((labelId) => ({
				contactId,
				labelId,
				ownerId: book.ownerId,
				workspaceId: book.workspaceId,
			})),
		)
		.onConflictDoNothing();
};

const createContactFromDav = async ({
										card,
										book,
									}: {
	card: DavCardsEntity;
	book: AddressBookEntity;
}) => {
	console.log("Creating contact from DAV card:", { uri: card.uri, etag: card.etag });
	const parsed = parseVCardToContact(await fetchContactData(card));

	const newContactPublicId = nanoid(10);
	const payload = {
		ownerId: book.ownerId,
		workspaceId: book.workspaceId,
		addressBookId: book.id,
		publicId: newContactPublicId,
		...parsed,
	} as ContactEntity;

	await davParsePhoto(parsed, book, newContactPublicId, payload);

	payload.davUri = card.uri;
	payload.davEtag = normalizeEtag(card.etag);

	const [inserted] = await db
		.insert(contacts)
		.values(payload)
		.onConflictDoNothing()
		.returning();

	if (inserted) {
		await syncContactCategories(inserted.id, book, parsed.categories ?? []);
	}

	return inserted;
};

const updateContact = async ({
								 card,
								 book,
								 localContact,
							 }: {
	card: DavCardsEntity;
	book: AddressBookEntity;
	localContact: ContactEntity;
}) => {
	const parsed = parseVCardToContact(await fetchContactData(card));

	const payload = {
		ownerId: book.ownerId,
		addressBookId: book.id,
		...parsed,
	} as ContactEntity;

	await davParsePhoto(parsed, book, localContact.publicId, payload);

	payload.davUri = card.uri;
	payload.davEtag = normalizeEtag(card.etag);

	const [contact] = await db
		.update(contacts)
		.set(payload)
		.where(eq(contacts.id, localContact.id))
		.returning();

	await syncContactCategories(localContact.id, book, parsed.categories ?? []);

	return contact;
};

const syncBook = async (book: AddressBookEntity) => {
	if (!book.davAddressBookId) return;

	const unsyncedContacts = await db
		.select()
		.from(contacts)
		.where(
			and(
				eq(contacts.addressBookId, book.id),
				isNull(contacts.davUri)
			),
		);

	for (const local of unsyncedContacts) {
		console.log("Pushing local contact to DAV:", local.id);

		await createContact(local.id, book.ownerId);
	}

	const [davBook] = await davDb
		.select()
		.from(davAddressbooks)
		.where(eq(davAddressbooks.id, book.davAddressBookId))
		.limit(1);

	if (!davBook) return;

	const remoteToken = String(davBook.synctoken);
	const localToken = book.davSyncToken;

	if (localToken && localToken === remoteToken) {
		return;
	}

	const cards = await davDb
		.select()
		.from(davCards)
		.where(eq(davCards.addressbookid, book.davAddressBookId));

	const remoteUris = new Set<string>();

	for (const card of cards) {
		remoteUris.add(card.uri);

		const [localContact] = await db
			.select()
			.from(contacts)
			.where(
				and(
					eq(contacts.addressBookId, book.id),
					eq(contacts.davUri, card.uri),
				),
			);

		if (localContact) {
			if (normalizeEtag(card.etag) !== localContact.davEtag) {
				await updateContact({ card, book, localContact });
			}
		} else {
			await createContactFromDav({ card, book });
		}
	}

	const localContacts = await db
		.select()
		.from(contacts)
		.where(eq(contacts.addressBookId, book.id));

	for (const local of localContacts) {
		if (local.davUri && !remoteUris.has(local.davUri)) {
			await db.delete(contacts).where(eq(contacts.id, local.id));
		}
	}

	await db.update(addressBooks)
		.set({ davSyncToken: remoteToken })
		.where(eq(addressBooks.id, book.id));
};


export const davSyncDb = async () => {
	const books = await db.select().from(addressBooks)
	for (const book of books) {
		try {
			await syncBook(book);
		} catch (err: any) {
			console.error("DAV sync error:", book.id, err?.message ?? err);
		}
	}
};

export function normalizeEtag(etag?: string | null): string | null {
	if (!etag) return null;
	let e = etag.trim();
	if (e.startsWith('"') && e.endsWith('"')) {
		e = e.slice(1, -1);
	}
	const weak = e.match(/^W\/"(.+)"$/);
	if (weak) {
		return weak[1];
	}
	return e.replace(/^W\//, "").replace(/"/g, "");
}
