"use client";

import React, { useState } from "react";

import {
	buildMergePlan,
	byMergePriority,
	type DuplicateCandidate,
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
	dob: "Birthday",
	profilePicture: "Photo",
	profilePictureXs: "Photo thumbnail",
};

/** Rendered as a single combined photo chooser instead of the generic loop. */
const PICTURE_FIELDS = new Set<ScalarField>(["profilePicture", "profilePictureXs"]);

const REASON_LABELS: Record<string, string> = {
	name: "same name",
	email: "shared email",
	phone: "shared phone",
};

function hasPhoto(c: DuplicateCandidate): boolean {
	return Boolean(c.profilePicture || c.profilePictureXs);
}

export default function DuplicateGroupCard({ group }: { group: DuplicateGroup }) {
	const plan = buildMergePlan(group);
	const orderedMembers = [...group.contacts].sort(byMergePriority);
	const survivor =
		group.contacts.find((c) => c.id === plan.survivorId) ?? orderedMembers[0];
	const survivorName = `${survivor.firstName} ${survivor.lastName ?? ""}`.trim();

	const photoMembers = group.contacts.filter(hasPhoto);
	const showPhotoChooser =
		photoMembers.length >= 2 || (!hasPhoto(survivor) && photoMembers.length >= 1);

	const [chosen, setChosen] = useState<Record<ScalarField, string | null>>(() => {
		const initial = {} as Record<ScalarField, string | null>;
		for (const field of Object.keys(plan.fields) as ScalarField[]) {
			if (PICTURE_FIELDS.has(field)) continue;
			initial[field] = plan.fields[field].selected;
		}

		// Keep the photo and its thumbnail coming from the same member: prefer
		// the survivor's own pair when it has one, otherwise the
		// highest-priority member that does.
		const photoSource = hasPhoto(survivor)
			? survivor
			: (orderedMembers.find(hasPhoto) ?? null);
		initial.profilePicture = photoSource?.profilePicture ?? null;
		initial.profilePictureXs = photoSource?.profilePictureXs ?? null;

		return initial;
	});

	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [merged, setMerged] = useState(false);
	const [confirming, setConfirming] = useState(false);

	if (merged) return null;

	const deleteCount = plan.mergedIds.length;

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
			<div className="mb-3 flex items-center justify-between gap-3">
				<div>
					<p className="text-sm font-medium">
						{group.contacts.length} contacts
					</p>
					<p className="text-xs text-muted-foreground">
						Grouped by {group.reasons.map((r) => REASON_LABELS[r]).join(", ")}
					</p>
				</div>

				{confirming ? (
					<div className="flex items-center gap-2">
						<p className="max-w-xs text-right text-xs text-red-600">
							Keep {survivorName}, delete {deleteCount}{" "}
							{deleteCount === 1 ? "other contact" : "other contacts"}. This
							also removes {deleteCount === 1 ? "it" : "them"} from CardDAV and
							your phone.
						</p>
						<button
							type="button"
							onClick={() => setConfirming(false)}
							disabled={busy}
							className="rounded-md border px-3 py-1.5 text-sm disabled:opacity-50"
						>
							Cancel
						</button>
						<button
							type="button"
							onClick={onMerge}
							disabled={busy}
							className="rounded-md bg-red-600 px-3 py-1.5 text-sm text-white disabled:opacity-50"
						>
							{busy ? "Merging…" : "Confirm merge"}
						</button>
					</div>
				) : (
					<button
						type="button"
						onClick={() => setConfirming(true)}
						disabled={busy}
						className="rounded-md bg-brand px-3 py-1.5 text-sm text-white disabled:opacity-50"
					>
						Merge group
					</button>
				)}
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
				{showPhotoChooser && (
					<div className="flex flex-wrap items-center gap-2">
						<span className="w-28 text-xs text-muted-foreground">Photo</span>
						{photoMembers.map((m) => {
							const isSelected =
								chosen.profilePicture === (m.profilePicture ?? null) &&
								chosen.profilePictureXs === (m.profilePictureXs ?? null);
							return (
								<button
									key={m.id}
									type="button"
									onClick={() =>
										setChosen((prev) => ({
											...prev,
											profilePicture: m.profilePicture ?? null,
											profilePictureXs: m.profilePictureXs ?? null,
										}))
									}
									className={[
										"flex items-center gap-1 rounded-md border px-2 py-1 text-xs",
										isSelected ? "border-brand bg-brand-100" : "",
									].join(" ")}
								>
									<ContactListAvatar
										signedUrl={storageObjectUrl(m.profilePictureXs)}
										alt={m.firstName}
									/>
									{m.firstName}
								</button>
							);
						})}
						<button
							type="button"
							onClick={() =>
								setChosen((prev) => ({
									...prev,
									profilePicture: null,
									profilePictureXs: null,
								}))
							}
							className={[
								"rounded-md border px-2 py-1 text-xs",
								chosen.profilePicture === null && chosen.profilePictureXs === null
									? "border-brand bg-brand-100"
									: "",
							].join(" ")}
						>
							No photo
						</button>
					</div>
				)}

				{(Object.keys(plan.fields) as ScalarField[])
					.filter(
						(field) =>
							!PICTURE_FIELDS.has(field) && plan.fields[field].alternatives.length > 1,
					)
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
