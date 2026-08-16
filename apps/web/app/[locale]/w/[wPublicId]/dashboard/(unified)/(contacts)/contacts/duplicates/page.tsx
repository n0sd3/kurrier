import React from "react";
import { contacts } from "@db";

import { rlsClient } from "@/lib/actions/clients";
import { findDuplicateGroups } from "@/lib/contact-duplicates";
import DuplicateGroupCard from "@/components/dashboard/contacts/duplicate-group-card";

export default async function DuplicatesPage() {
	const rls = await rlsClient();
	const rows = await rls((tx) => tx.select().from(contacts));

	const groups = findDuplicateGroups(rows);

	return (
		<div className="flex h-full flex-col gap-3 overflow-y-auto p-4">
			<div>
				<h2 className="text-sm font-semibold">Duplicates</h2>
				<p className="text-xs text-muted-foreground">
					{groups.length === 0
						? "No duplicate contacts found."
						: `${groups.length} suspected duplicate groups.`}
				</p>
			</div>

			{groups.map((group) => (
				<DuplicateGroupCard key={group.contacts[0].id} group={group} />
			))}
		</div>
	);
}
