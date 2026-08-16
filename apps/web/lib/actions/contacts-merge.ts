"use server";

import { and, eq, inArray, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { contacts } from "@db";

import { isSignedIn } from "@/lib/actions/auth";
import { rlsClient } from "@/lib/actions/clients";
import { getRedis } from "@/lib/actions/get-redis";
import type { ContactAddress, ScalarField } from "@/lib/contact-duplicates";

export type MergeContactsInput = {
	survivorId: string;
	mergedIds: string[];
	fields: Record<ScalarField, string | null>;
	emails: { address: string }[];
	phones: { code: string | null; number: string }[];
	addresses: ContactAddress[];
};

export async function mergeContacts(input: MergeContactsInput) {
	const user = await isSignedIn();
	if (!user) return { success: false, error: "Unauthorized" };

	const mergedIds = [...new Set(input.mergedIds)].filter(
		(id) => id !== input.survivorId,
	);
	if (mergedIds.length === 0) {
		return { success: false, error: "Nothing to merge" };
	}
	if (!input.fields.firstName) {
		return { success: false, error: "The surviving contact needs a first name" };
	}

	const allIds = [input.survivorId, ...mergedIds];
	const rls = await rlsClient();

	// RLS restricts contacts to address books this user owns, so anything the
	// caller may not touch simply will not come back here.
	const visible = await rls((tx) =>
		tx
			.select({ id: contacts.id })
			.from(contacts)
			.where(inArray(contacts.id, allIds)),
	);

	if (visible.length !== allIds.length) {
		return { success: false, error: "Some contacts are no longer available" };
	}

	await rls(async (tx) => {
		await tx
			.update(contacts)
			.set({
				firstName: input.fields.firstName as string,
				lastName: input.fields.lastName,
				company: input.fields.company,
				jobTitle: input.fields.jobTitle,
				department: input.fields.department,
				notes: input.fields.notes,
				dob: input.fields.dob,
				profilePicture: input.fields.profilePicture,
				profilePictureXs: input.fields.profilePictureXs,
				emails: input.emails,
				phones: input.phones,
				addresses: input.addresses,
				updatedAt: new Date(),
			})
			.where(eq(contacts.id, input.survivorId));

		// Carry every label off the losers, so a favourited duplicate keeps its
		// star. pk_contact_labels(contact_id, label_id) absorbs the duplicates.
		await tx.execute(sql`
			INSERT INTO contact_labels (contact_id, label_id, owner_id, workspace_id)
			SELECT
				${input.survivorId}::uuid,
				cl.label_id,
				cl.owner_id,
				cl.workspace_id
			FROM contact_labels cl
			WHERE cl.contact_id IN (${sql.join(
				mergedIds.map((id) => sql`${id}::uuid`),
				sql`, `,
			)})
			ON CONFLICT (contact_id, label_id) DO NOTHING
		`);
	});

	// Losers are deleted by the worker, never here: its deleteContact removes the
	// CardDAV card and the Postgres row together. Deleting locally first would
	// orphan the card and davSyncDb would recreate the contact.
	const { davQueue } = await getRedis();

	await davQueue.add("dav:update-contact", {
		contactId: input.survivorId,
		ownerId: user.id,
	});

	for (const id of mergedIds) {
		await davQueue.add("dav:delete-contact", {
			contactId: id,
			ownerId: user.id,
		});
	}

	revalidatePath("/[locale]/w/[wPublicId]/dashboard/contacts", "layout");
	return { success: true };
}
