"use client";
import React from "react";
import {
	FetchDecryptedSecretsResultRow,
	upsertSMTPAccount,
} from "@/lib/actions/dashboard";
import { ICLOUD_SPEC } from "@schema";
import { ReusableForm } from "@/components/common/reusable-form";
import { ulid } from "ulid";
import { VerifyResult } from "@providers";
import { parseSecret } from "@/lib/utils";
import { Button } from "@mantine/core";
import { useClipboard } from "@mantine/hooks";
import { Check, Copy, ExternalLink, Info } from "lucide-react";
import { toast } from "sonner";

function AppPasswordHelp() {
	const clipboard = useClipboard({ timeout: 1500 });

	return (
		<div className="rounded-md border border-border bg-muted/40 p-3">
			<div className="flex gap-2">
				<Info className="h-4 w-4 shrink-0 mt-0.5 text-muted-foreground" />
				<p className="text-xs text-muted-foreground">
					iCloud requires an app-specific password. Sign in with your Apple ID,
					go to Sign-In and Security → App-Specific Passwords and generate one
					(requires two-factor authentication enabled on your Apple ID).
				</p>
			</div>

			<div className="mt-3 flex flex-wrap gap-2">
				<Button
					size="xs"
					variant="light"
					component="a"
					href={ICLOUD_SPEC.manageUrl}
					target="_blank"
					rel="noopener noreferrer"
					leftSection={<ExternalLink className="h-3.5 w-3.5" />}
				>
					Open Apple ID
				</Button>
				<Button
					size="xs"
					variant="default"
					leftSection={
						clipboard.copied ? (
							<Check className="h-3.5 w-3.5" />
						) : (
							<Copy className="h-3.5 w-3.5" />
						)
					}
					onClick={() => {
						clipboard.copy(ICLOUD_SPEC.manageUrl);
						toast.success("Link copied to clipboard");
					}}
				>
					{clipboard.copied ? "Copied" : "Copy link"}
				</Button>
			</div>
		</div>
	);
}

function NewICloudAccountForm({
	smtpSecret,
	onCompleted,
}: {
	smtpSecret?: FetchDecryptedSecretsResultRow;
	onCompleted?: (res: VerifyResult) => void;
}) {
	const parsedVaultValues = parseSecret(smtpSecret);
	const isEdit = !!smtpSecret;

	// The Apple ID and app password are used for both SMTP and IMAP, so the
	// visible inputs are mirrored into hidden IMAP fields.
	const [appleId, setAppleId] = React.useState<string>(
		parsedVaultValues.SMTP_USERNAME ?? "",
	);
	const [appPassword, setAppPassword] = React.useState<string>(
		parsedVaultValues.SMTP_PASSWORD ?? "",
	);

	const hidden = (name: string, value: string) => ({
		name,
		wrapperClasses: "hidden",
		props: { type: "hidden" as const, value, readOnly: true },
	});

	const fields = [
		{
			name: "ulid",
			wrapperClasses: "hidden",
			props: { type: "hidden" as const, defaultValue: ulid() },
		},
		{
			name: "secretId",
			wrapperClasses: "hidden",
			props: {
				type: "hidden" as const,
				defaultValue: smtpSecret?.linkRow?.secretId ?? "",
			},
		},
		{
			name: "accountId",
			wrapperClasses: "hidden",
			props: {
				type: "hidden" as const,
				defaultValue: smtpSecret?.linkRow?.accountId ?? "",
			},
		},

		hidden("required.preset", ICLOUD_SPEC.preset),
		...Object.entries(ICLOUD_SPEC.defaults).map(([key, value]) =>
			hidden(key.startsWith("IMAP_") ? `optional.${key}` : `required.${key}`, value),
		),
		hidden("optional.IMAP_USERNAME", appleId),
		hidden("optional.IMAP_PASSWORD", appPassword),

		{
			name: "label",
			label: "Account label",
			required: true,
			props: {
				autoComplete: "off",
				required: true,
				placeholder: "My iCloud Account",
				defaultValue: parsedVaultValues.label ?? "",
			},
		},

		{
			name: "required.SMTP_USERNAME",
			label: "Apple ID",
			required: true,
			props: {
				autoComplete: "off",
				required: true,
				type: "email",
				placeholder: "you@icloud.com",
				value: appleId,
				onChange: (e: React.ChangeEvent<HTMLInputElement>) =>
					setAppleId(e.currentTarget.value),
			},
		},

		{
			name: "required.SMTP_PASSWORD",
			label: "App-specific password",
			required: true,
			props: {
				autoComplete: "off",
				required: true,
				type: "password",
				placeholder: "xxxx-xxxx-xxxx-xxxx",
				value: appPassword,
				onChange: (e: React.ChangeEvent<HTMLInputElement>) =>
					setAppPassword(e.currentTarget.value),
			},
		},

		{ el: <AppPasswordHelp /> },
	];

	return (
		<ReusableForm
			action={upsertSMTPAccount}
			onSuccess={onCompleted ? onCompleted : undefined}
			fields={fields}
			{...(isEdit
				? {
						submitButtonProps: {
							submitLabel: "Save",
							wrapperClasses: "justify-center mt-6 flex",
							fullWidth: true,
						},
					}
				: {})}
		/>
	);
}

export default NewICloudAccountForm;
