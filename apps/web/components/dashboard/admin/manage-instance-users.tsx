"use client";

import { Alert, Button, Card, Modal, Table } from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import * as React from "react";
import { Container } from "@/components/common/containers";
import { ReusableForm } from "@/components/common/reusable-form";
import {
	type FetchInstanceUsersResult,
	setUserPassword,
} from "@/lib/actions/admin-users";
import { formatDateTime } from "@/lib/format-datetime";

type InstanceUser = FetchInstanceUsersResult[number];

export default function ManageInstanceUsers({
	usersList,
}: {
	usersList: FetchInstanceUsersResult;
}) {
	const [opened, { open, close }] = useDisclosure(false);
	const [target, setTarget] = React.useState<InstanceUser | null>(null);

	const fields = [
		{
			name: "userId",
			wrapperClasses: "hidden",
			props: { type: "hidden", defaultValue: target?.id ?? "" },
		},
		{
			name: "password",
			label: "New password",
			wrapperClasses: "col-span-12",
			props: {
				type: "password",
				required: true,
				autoComplete: "new-password",
				placeholder: "At least 8 characters",
			},
		},
	];

	return (
		<Container variant="wide">
			<div className="flex items-center justify-between my-4">
				<h1 className="text-xl font-bold text-foreground">Instance Users</h1>
				<span className="text-sm text-muted-foreground">
					{usersList.length} {usersList.length === 1 ? "account" : "accounts"}
				</span>
			</div>

			<p className="max-w-prose text-sm text-muted-foreground my-6">
				Every account on this instance. Setting a password here replaces it
				immediately.
			</p>

			<Alert color="yellow" variant="light" className="mb-6">
				<span className="text-sm">
					Changing a password does not sign the user out. Sessions are 30-day
					cookies with no server-side record, so an existing session stays valid
					until it expires.
				</span>
			</Alert>

			<Card className="shadow-none mt-4 !rounded-2xl border">
				<div className="p-4">
					{usersList.length === 0 ? (
						<div className="text-sm text-muted-foreground">
							No accounts found. If you are reading this, something is wrong —
							your own account should be listed here.
						</div>
					) : (
						<Table verticalSpacing="sm" highlightOnHover>
							<Table.Thead>
								<Table.Tr>
									<Table.Th>Email</Table.Th>
									<Table.Th>Created</Table.Th>
									<Table.Th>Workspace</Table.Th>
									<Table.Th className="w-40 text-right">Password</Table.Th>
								</Table.Tr>
							</Table.Thead>
							<Table.Tbody>
								{usersList.map((u) => (
									<Table.Tr key={u.id}>
										<Table.Td>{u.email}</Table.Td>
										<Table.Td>{formatDateTime(u.createdAt)}</Table.Td>
										<Table.Td>{u.workspaceName ?? "—"}</Table.Td>
										<Table.Td className="text-right">
											<Button
												variant="subtle"
												size="xs"
												onClick={() => {
													setTarget(u);
													open();
												}}
											>
												Set password
											</Button>
										</Table.Td>
									</Table.Tr>
								))}
							</Table.Tbody>
						</Table>
					)}
				</div>
			</Card>

			<Modal
				opened={opened}
				onClose={close}
				title={`Set password for ${target?.email ?? ""}`}
				centered
			>
				<ReusableForm
					// Remount per target so the hidden userId and the typed password
					// never carry over from the previously opened row.
					key={target?.id}
					formKey={target?.id}
					action={setUserPassword}
					fields={fields}
					notify={{ kind: "toast" }}
					onSuccess={close}
					submitButtonProps={{
						submitLabel: "Set password",
						wrapperClasses: "mt-6 flex justify-center",
						fullWidth: true,
					}}
				/>
			</Modal>
		</Container>
	);
}
