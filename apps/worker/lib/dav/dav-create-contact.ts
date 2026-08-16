import {
	db,
	contacts,
	addressBooks,
	davAccounts,
	secretsMeta,
	getSecretAdmin,
	labels,
	contactLabels,
} from "@db";
import { and, desc, eq } from "drizzle-orm";
import DigestFetch from "digest-fetch";
import { buildVCard } from "./dav-build-card";
import { normalizeEtag } from "./sync/dav-sync-db";
import { pushUpdateContact } from "./dav-update-contact";

/** Nomes dos labels do contato, para o `CATEGORIES` do cartão (§1). */
async function fetchContactLabelNames(contactId: string) {
	const rows = await db
		.select({ name: labels.name })
		.from(contactLabels)
		.innerJoin(labels, eq(contactLabels.labelId, labels.id))
		.where(eq(contactLabels.contactId, contactId));

	return rows.map((r) => r.name);
}

export async function createContactViaHttp(opts: {
	carddata: string;
	davBaseUrl: string;
	username: string;
	password: string;
	collectionPath: string;
	davUri: string;
}) {
	const { carddata, davBaseUrl, username, password, collectionPath, davUri } =
		opts;

	const client = new DigestFetch(username, password);
	const digestFetch = client.fetch.bind(client);

	const base = davBaseUrl.replace(/\/$/, "");
	const collection = collectionPath.replace(/^\//, "");
	const url = `${base}/${collection}/${encodeURIComponent(davUri)}`;

	const res = await digestFetch(url, {
		method: "PUT",
		headers: {
			"Content-Type": "text/vcard; charset=utf-8",
			"If-None-Match": "*",
		},
		body: carddata,
	});

	// 412 com If-None-Match: * = o cartão já existe lá. Não é erro, é pull+merge (§2).
	if (res.status === 412) {
		return { etag: null, alreadyExists: true };
	}

	if (!(res.status === 200 || res.status === 201 || res.status === 204)) {
		const text = await res.text().catch(() => "");
		throw new Error(
			`CardDAV PUT failed (${res.status} ${res.statusText}): ${text}`,
		);
	}

	const etag = res.headers.get("etag") ?? null;
	return { etag, alreadyExists: false };
}


export const createContact = async (contactId: string, ownerId: string) => {
	const [contact] = await db
		.select()
		.from(contacts)
		.where(and(eq(contacts.id, contactId), eq(contacts.ownerId, ownerId)));

	if (!contact) return;

	const [book] = await db
		.select()
		.from(addressBooks)
		.where(eq(addressBooks.ownerId, ownerId),);

	if (!book) return;

	const [secretRow] = await db
		.select({
			account: davAccounts,
			metaId: secretsMeta.id,
		})
		.from(davAccounts)
		.where(eq(davAccounts.id, book.davAccountId))
		.leftJoin(secretsMeta, eq(davAccounts.secretId, secretsMeta.id))
		.orderBy(desc(davAccounts.createdAt));

	if (!secretRow?.account) return;

	const davUsername = secretRow.account.username;
	const collectionPath = `addressbooks/${davUsername}/${book.slug}`;

	const secret = await getSecretAdmin(String(secretRow.metaId));
	const passwordFromSecret = secret?.vault?.decrypted_secret;

	if (!passwordFromSecret) {
		console.error(
			"No password found in secret for DAV account",
			book.davAccountId,
		);
		return;
	}

	const carddata = await buildVCard(
		contact,
		await fetchContactLabelNames(contact.id),
	);
	const davUri = `${contact.id}.vcf`;

	const { etag, alreadyExists } = await createContactViaHttp({
		carddata,
		davBaseUrl: `${process.env.DAV_URL}/dav.php`,
		username: davUsername,
		password: passwordFromSecret,
		collectionPath,
		davUri,
	});

	await db
		.update(contacts)
		.set({
			davUri,
			davEtag: normalizeEtag(etag),
			updatedAt: new Date(),
		})
		.where(eq(contacts.id, contact.id));

	// Já existia no servidor: o caminho de update faz GET + merge do cartão remoto.
	if (alreadyExists) {
		console.warn(
			`[DAV] cartão ${davUri} já existia no servidor, caindo para update com merge`,
		);
		return pushUpdateContact(contact.id, ownerId);
	}

	return { success: true };
};
