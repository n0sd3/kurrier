"use client";
import React, { useRef, useEffect, useState } from "react";
import { Loader2, MailOpen, RefreshCw, RotateCw, Trash2 } from "lucide-react";
import { useDynamicContext } from "@/hooks/use-dynamic-context";
import {
	deleteForever,
	deltaFetch,
	FetchIdentityMailboxListResult,
	FetchMailboxThreadsResult,
	markAsRead,
	moveToTrash,
	resyncGmailMailbox,
	revalidateMailbox,
} from "@/lib/actions/mailbox";
import { ActionIcon, Button, Tooltip } from "@mantine/core";
import type { IdentityEntity, MailboxEntity, MailboxSyncEntity } from "@db";
import { toast } from "sonner";
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
	AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import ComposeMail from "@/components/mailbox/default/compose-mail";
import { PublicConfig } from "@schema";
import { useMediaQuery } from "@mantine/hooks";
import { clsx } from "clsx";
import MoveToFolder from "@/components/mailbox/default/move-to-folder";
import { usePathname, useRouter } from "next/navigation";

function MailListHeader({
	mailboxThreads,
	mailboxSync,
	publicConfig,
	identityMailboxes,
	activeMailbox,
	identity,
}: {
	mailboxThreads: FetchMailboxThreadsResult;
	publicConfig: PublicConfig;
	identityMailboxes: FetchIdentityMailboxListResult;
	activeMailbox: MailboxEntity;
	mailboxSync?: MailboxSyncEntity;
	identity?: IdentityEntity;
}) {
	const isGmailIdentity = !!(identity?.metaData as any)?.gmail?.googleAccountId;
	const { state, setState } = useDynamicContext<{
		selectedThreadIds: Set<string>;
		activeMailbox?: MailboxEntity | null;
		identityPublicId: string;
	}>();

	const identityIdRef = useRef<string | undefined>(activeMailbox?.identityId);
	const mailboxIdRef = useRef<string | undefined>(activeMailbox?.id);
	const mailboxKind = useRef<string | undefined>(activeMailbox?.kind);
	useEffect(() => {
		if (activeMailbox?.identityId)
			identityIdRef.current = activeMailbox.identityId;
		if (activeMailbox?.id) mailboxIdRef.current = activeMailbox.id;
	}, [activeMailbox?.identityId, activeMailbox?.id]);

	const selectedSize = state?.selectedThreadIds?.size ?? 0;
	const hasSelected = selectedSize > 0;
	const isChecked =
		selectedSize === mailboxThreads.length && mailboxThreads.length > 0;

	const clearSelection = () =>
		setState((prev) => ({ ...(prev ?? {}), selectedThreadIds: new Set() }));

	// Threads can leave the list without going through this header — a swipe, a
	// move to another folder, a sync. Drop ids that are no longer on screen so
	// the select-all box and the action bar can't act on stale threads.
	useEffect(() => {
		const visible = new Set(mailboxThreads.map((t) => t.threadId));
		setState((prev) => {
			const selected: Set<string> = prev?.selectedThreadIds ?? new Set();
			const kept = new Set([...selected].filter((id) => visible.has(id)));
			if (kept.size === selected.size) return prev;
			return { ...(prev ?? {}), selectedThreadIds: kept };
		});
	}, [mailboxThreads, setState]);

	const pathName = usePathname();
	const router = useRouter();

	const [reloading, setReloading] = useState(false);
	const reload = async () => {
		const identityId = identityIdRef.current;
		try {
			setReloading(true);
			if (identityId) {
				await deltaFetch({ identityId });
			}
			await revalidateMailbox(pathName);
			router.refresh();
			toast.success("Mailbox synced", { position: "bottom-left" });
		} catch {
			toast.error("Sync failed", { position: "bottom-left" });
		} finally {
			setReloading(false);
		}
	};

	const [resyncing, setResyncing] = useState(false);
	const resync = async () => {
		const identityId = identityIdRef.current;
		if (!identityId) return;
		const toastId = toast.loading(
			"Resyncing entire mailbox from Gmail… this can take a few minutes",
			{ position: "bottom-left" },
		);
		try {
			setResyncing(true);
			await resyncGmailMailbox(identityId);
			router.refresh();
			toast.success("Mailbox resync started — new messages will keep appearing as they sync", {
				id: toastId,
				position: "bottom-left",
			});
		} catch {
			toast.error("Failed to start mailbox resync", { id: toastId, position: "bottom-left" });
		} finally {
			setResyncing(false);
		}
	};

	const [markingRead, setMarkingRead] = useState(false);
	const markRead = async () => {
		try {
			setMarkingRead(true);
			await markAsRead(
				Array.from(state?.selectedThreadIds ?? []),
				String(mailboxIdRef.current),
				!!mailboxSync,
				true,
				pathName,
			);
			clearSelection();
			router.refresh();
		} catch {
			toast.error("Failed to mark as read", { position: "bottom-left" });
		} finally {
			setMarkingRead(false);
		}
	};

	const [bulkDeleting, setBulkDeleting] = useState(false);
	const deleteThreads = async () => {
		if (mailboxKind.current === "trash") {
			await removeTrash();
			return;
		}
		const count = state?.selectedThreadIds?.size ?? 0;
		const toastId = toast.loading(
			count > 1 ? `Moving ${count} messages to Trash…` : "Moving message to Trash…",
			{ position: "bottom-left" },
		);
		try {
			setBulkDeleting(true);
			await moveToTrash(
				Array.from(state?.selectedThreadIds ?? []),
				String(mailboxIdRef.current),
				!!mailboxSync,
				true,
				undefined,
				pathName,
			);
			clearSelection();
			router.refresh();
			toast.success("Messages moved to Trash", { id: toastId, position: "bottom-left" });
		} catch {
			toast.error("Failed to move messages to Trash", { id: toastId, position: "bottom-left" });
		} finally {
			setBulkDeleting(false);
		}
	};

	const removeTrash = async () => {
		const count = state?.selectedThreadIds?.size ?? 0;
		const toastId = toast.loading(
			count > 1 ? `Deleting ${count} messages forever…` : "Deleting message forever…",
			{ position: "bottom-left" },
		);
		try {
			setBulkDeleting(true);
			await deleteForever(
				Array.from(state?.selectedThreadIds ?? []),
				String(mailboxIdRef.current),
				!!mailboxSync,
				true,
				undefined,
				pathName,
			);
			clearSelection();
			router.refresh();
			toast.success("Thread deleted forever", { id: toastId, position: "bottom-left" });
		} catch {
			toast.error("Failed to delete thread", { id: toastId, position: "bottom-left" });
		} finally {
			setBulkDeleting(false);
		}
	};

	const [emptyingTrash, setEmptyingTrash] = useState(false);
	const emptyTrash = async () => {
		const toastId = toast.loading("Emptying Trash…", { position: "bottom-left" });
		try {
			setEmptyingTrash(true);
			await deleteForever(
				null,
				String(mailboxIdRef.current),
				!!mailboxSync,
				true,
				{
					emptyAll: true,
				},
				pathName,
			);
			clearSelection();
			router.refresh();
			toast.success("Trash removed successfully", { id: toastId, position: "bottom-left" });
		} catch {
			toast.error("Failed to empty Trash", { id: toastId, position: "bottom-left" });
		} finally {
			setEmptyingTrash(false);
		}
	};

	const isMobile = useMediaQuery("(max-width: 768px)");
	const isOnSnoozedPage = pathName.split("/").includes("snoozed");

	return (
		<>
			<div className="sticky top-0 z-10 flex items-center bg-background/95 px-3 py-2 backdrop-blur rounded-t-xl">
				{!isOnSnoozedPage && (
					<input
						type="checkbox"
						onChange={(e) => {
							const newSet = new Set(state?.selectedThreadIds ?? []);
							if (e.target.checked) {
								mailboxThreads.forEach((t) => newSet.add(t.threadId));
							} else {
								mailboxThreads.forEach((t) => newSet.delete(t.threadId));
							}
							setState((prev) => ({
								...(prev ?? {}),
								selectedThreadIds: newSet,
							}));
						}}
						checked={isChecked}
						aria-label="Select all"
						className="h-4 w-4 rounded border-muted-foreground/40"
					/>
				)}

				<div className="flex-1" />

				<div className="flex items-center gap-2 ml-auto">
					<Tooltip label="Sync" withArrow>
						<ActionIcon
							variant="subtle"
							onClick={reload}
							title="Sync"
							className="h-8 w-8"
						>
							<RotateCw className={reloading ? "animate-spin" : ""} size={16} />
						</ActionIcon>
					</Tooltip>

					{isGmailIdentity && (
						<Tooltip label="Full resync from Gmail" withArrow>
							<ActionIcon
								variant="subtle"
								onClick={resync}
								disabled={resyncing}
								title="Full resync from Gmail"
								className="h-8 w-8"
							>
								<RefreshCw className={resyncing ? "animate-spin" : ""} size={16} />
							</ActionIcon>
						</Tooltip>
					)}

					<div
						className={clsx(
							"inset-0 flex items-center gap-1 transition-opacity",
							hasSelected
								? "opacity-100"
								: "opacity-0 hidden pointer-events-none",
						)}
					>
						<MoveToFolder
							identityMailboxes={identityMailboxes}
							activeMailbox={activeMailbox}
						/>
						<button
							type="button"
							onClick={deleteThreads}
							disabled={bulkDeleting}
							className="inline-flex h-7 items-center gap-1 rounded-md px-2 text-xs hover:bg-muted disabled:opacity-50 disabled:pointer-events-none"
							title="Delete"
						>
							{bulkDeleting ? (
								<Loader2 className="h-4 w-4 animate-spin" />
							) : (
								<Trash2 className="h-4 w-4" />
							)}
						</button>
						<button
							type="button"
							onClick={markRead}
							disabled={markingRead}
							className="inline-flex h-7 items-center gap-1 rounded-md px-2 text-xs hover:bg-muted disabled:opacity-50 disabled:pointer-events-none"
							title="Mark read"
						>
							{markingRead ? (
								<Loader2 className="h-4 w-4 animate-spin" />
							) : (
								<MailOpen className="h-4 w-4" />
							)}
						</button>
					</div>

					{isMobile && <ComposeMail publicConfig={publicConfig} identityMailboxes={identityMailboxes} />}
				</div>
			</div>

			{mailboxKind.current === "trash" && (
				<div
					className={
						"flex p-2 text-sm text-muted-foreground justify-center mb-3  mx-2 rounded items-center"
					}
				>
					<span>
						Messages that have been in the Trash for more than 30 days will be
						deleted automatically.
					</span>
					<AlertDialog>
						<AlertDialogTrigger asChild={true} className={"-mx-2"}>
							<Button variant={"transparent"} loading={emptyingTrash}>
								Empty Bin Now
							</Button>
						</AlertDialogTrigger>
						<AlertDialogContent>
							<AlertDialogHeader>
								<AlertDialogTitle>Are you absolutely sure?</AlertDialogTitle>
								<AlertDialogDescription>
									This action cannot be undone. This will permanently delete
									your account and remove your data from our servers.
								</AlertDialogDescription>
							</AlertDialogHeader>
							<AlertDialogFooter>
								<AlertDialogCancel>Cancel</AlertDialogCancel>
								<AlertDialogAction onClick={emptyTrash}>
									Continue
								</AlertDialogAction>
							</AlertDialogFooter>
						</AlertDialogContent>
					</AlertDialog>
				</div>
			)}
		</>
	);
}

export default MailListHeader;
