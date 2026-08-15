"use client";
import { ICLOUD_SPEC } from "@schema";
import {
	Card,
	CardAction,
	CardContent,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import { Plus } from "lucide-react";
import { modals } from "@mantine/modals";
import NewICloudAccountForm from "@/components/dashboard/providers/new-icloud-account-form";
import { FetchDecryptedSecretsResult } from "@/lib/actions/dashboard";
import SmtpAccountCard from "@/components/dashboard/providers/smtp-account-card";
import { Button } from "@mantine/core";
import { isICloudSecret } from "@/lib/utils";

export default function ICloudCard({
	smtpSecrets,
}: {
	smtpSecrets: FetchDecryptedSecretsResult;
}) {
	const icloudSecrets = (smtpSecrets ?? []).filter(isICloudSecret);

	const openAddModal = () => {
		const openModalId = modals.open({
			title: (
				<div className="font-semibold text-brand-foreground">
					Add iCloud Account
				</div>
			),
			closeOnEscape: false,
			closeOnClickOutside: false,
			size: "lg",
			children: (
				<div className="p-2">
					<NewICloudAccountForm onCompleted={() => modals.close(openModalId)} />
				</div>
			),
		});
	};

	return (
		<div className="flex flex-col">
			<Card className={"shadow-none border-border"}>
				<CardHeader className="gap-2">
					<div className="flex flex-col lg:flex-row lg:items-center lg:justify-between">
						<div className="max-w-2xl">
							<CardTitle className="text-xl">{ICLOUD_SPEC.name}</CardTitle>
							<p className="text-sm text-muted-foreground mt-1">
								Connect an iCloud mailbox for sending and receiving. Credentials
								are stored in your vault.
							</p>
							<p className="text-xs text-muted-foreground/80 mt-1">
								{ICLOUD_SPEC.help}
							</p>
						</div>

						<CardAction className="mt-3 lg:mt-0">
							<Button size="sm" onClick={openAddModal} className="gap-2">
								<Plus className="h-4 w-4" />
								Add iCloud Account
							</Button>
						</CardAction>
					</div>
				</CardHeader>

				<CardContent className="space-y-6">
					{icloudSecrets.length === 0 && (
						<div className="rounded-md border border-dashed p-6 text-sm text-muted-foreground text-center flex flex-col items-center gap-4 bg-muted">
							<div>
								<div className="font-medium text-card-foreground">
									No iCloud accounts yet
								</div>
								<div className="text-xs text-card-foreground mt-1">
									Add an account with an app-specific password to start syncing
									mail.
								</div>
							</div>
							<Button
								variant="default"
								size="sm"
								onClick={openAddModal}
								className="gap-2"
							>
								<Plus className="h-4 w-4" />
								Add iCloud Account
							</Button>
						</div>
					)}

					<div className="grid grid-cols-1 gap-4">
						{icloudSecrets.map((smtpSecret) => (
							<SmtpAccountCard
								smtpSecret={smtpSecret}
								key={smtpSecret.metaId}
							/>
						))}
					</div>
				</CardContent>
			</Card>
		</div>
	);
}
