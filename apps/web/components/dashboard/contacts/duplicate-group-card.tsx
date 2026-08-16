"use client";

import React, { useState } from "react";

import {
	buildMergePlan,
	type DuplicateGroup,
	type ScalarField,
} from "@/lib/contact-duplicates";
import { mergeContacts } from "@/lib/actions/contacts-merge";
import { storageObjectUrl } from "@/lib/storage-object-access";
import ContactListAvatar from "@/components/dashboard/contacts/contact-list-avatar";

const FIELD_LABELS: Record<ScalarField, string> = {
	firstName: "First name",
	lastName: "Last name",
	company: "Company",
	jobTitle: "Job title",
	department: "Department",
	notes: "Notes",
	profilePicture: "Photo",
	profilePictureXs: "Photo thumbnail",
};

const REASON_LABELS: Record<string, string> = {
	name: "same name",
	email: "shared email",
	phone: "shared phone",
};

export default function DuplicateGroupCard({ group }: { group: DuplicateGroup }) {
	const plan = buildMergePlan(group);

	const [chosen, setChosen] = useState<Record<ScalarField, string | null>>(() => {
		const initial = {} as Record<ScalarField, string | null>;
		for (const field of Object.keys(plan.fields) as ScalarField[]) {
			initial[field] = plan.fields[field].selected;
		}
		return initial;
	});

	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [merged, setMerged] = useState(false);

	if (merged) return null;

	const onMerge = async () => {
		setBusy(true);
		setError(null);

		try {
			const result = await mergeContacts({
				survivorId: plan.survivorId,
				mergedIds: plan.mergedIds,
				fields: chosen,
				emails: plan.emails,
				phones: plan.phones,
				addresses: plan.addresses,
			});

			if (result.success) setMerged(true);
			else setError(result.error ?? "Merge failed");
		} catch (e) {
			setError(e instanceof Error ? e.message : "Merge failed");
		} finally {
			setBusy(false);
		}
	};

	return (
		<div className="rounded-lg border bg-background/70 p-4">
			<div className="mb-3 flex items-center justify-between">
				<div>
					<p className="text-sm font-medium">
						{group.contacts.length} contacts
					</p>
					<p className="text-xs text-muted-foreground">
						Grouped by {group.reasons.map((r) => REASON_LABELS[r]).join(", ")}
					</p>
				</div>
				<button
					type="button"
					onClick={onMerge}
					disabled={busy}
					className="rounded-md bg-brand px-3 py-1.5 text-sm text-white disabled:opacity-50"
				>
					{busy ? "Merging…" : "Merge group"}
				</button>
			</div>

			<div className="mb-3 flex flex-wrap gap-3">
				{group.contacts.map((c) => (
					<div key={c.id} className="flex items-center gap-2 text-sm">
						<ContactListAvatar
							signedUrl={storageObjectUrl(c.profilePictureXs)}
							alt={c.firstName}
						/>
						<div>
							<p className={c.id === plan.survivorId ? "font-semibold" : ""}>
								{c.firstName} {c.lastName ?? ""}
								{c.id === plan.survivorId ? " (kept)" : ""}
							</p>
							<p className="text-xs text-muted-foreground">
								{(c.emails ?? []).map((e) => e.address).join(", ")}
							</p>
						</div>
					</div>
				))}
			</div>

			<div className="flex flex-col gap-2">
				{(Object.keys(plan.fields) as ScalarField[])
					.filter((field) => plan.fields[field].alternatives.length > 1)
					.map((field) => (
						<div key={field} className="flex flex-wrap items-center gap-2">
							<span className="w-28 text-xs text-muted-foreground">
								{FIELD_LABELS[field]}
							</span>
							{plan.fields[field].alternatives.map((value) => (
								<button
									key={value}
									type="button"
									onClick={() => setChosen((prev) => ({ ...prev, [field]: value }))}
									className={[
										"rounded-md border px-2 py-1 text-xs",
										chosen[field] === value ? "border-brand bg-brand-100" : "",
									].join(" ")}
								>
									{value}
								</button>
							))}
						</div>
					))}
			</div>

			{error && <p className="mt-2 text-xs text-red-600">{error}</p>}
		</div>
	);
}
