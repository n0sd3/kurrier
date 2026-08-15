"use client";
import React from "react";
import { Mail, MailOpen, Paperclip, Trash2 } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { MailboxEntity, MailboxSyncEntity } from "@db";
import {
	FetchMailboxThreadsResult,
	markAsRead,
	markAsUnread,
	moveToTrash,
	toggleStar,
} from "@/lib/actions/mailbox";
import {
	FetchLabelsResult,
	FetchMailboxThreadLabelsResult,
} from "@/lib/actions/labels";
import { IconStar, IconStarFilled } from "@tabler/icons-react";

type Props = {
	mailboxThreadItem: FetchMailboxThreadsResult[number];
	activeMailbox: MailboxEntity;
	identityPublicId: string;
	mailboxSync: MailboxSyncEntity | undefined;
	globalLabels: FetchLabelsResult;
	labelsByThreadId: FetchMailboxThreadLabelsResult;
	workspacePublicId?: string;
};
import { Temporal } from "@js-temporal/polyfill";
import { useDynamicContext } from "@/hooks/use-dynamic-context";
import { toast } from "sonner";
import LabelRowTag from "@/components/dashboard/labels/label-row-tag";
import ThreadLabelHoverButtons from "@/components/dashboard/labels/thread-label-hover-buttons";
import SnoozeMail from "@/components/mailbox/default/snooze-mail";
import { cleanPreviewText, formatParticipants } from "@/lib/mailbox-row";
import { usePendingThreadActions } from "@/hooks/use-pending-thread-actions";
import SwipeableThreadRow, {
	type SwipeAction,
} from "@/components/mailbox/default/swipeable-thread-row";

export default function WebmailListItem({
	mailboxThreadItem,
	activeMailbox,
	identityPublicId,
	mailboxSync,
	globalLabels,
	labelsByThreadId,
	workspacePublicId
}: Props) {
	function formatDateLabel(input?: string | number | Date) {
		const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
		if (!input) return "";

		let zdt: Temporal.ZonedDateTime;
		try {
			const instant = Temporal.Instant.from(new Date(input).toISOString());
			zdt = instant.toZonedDateTimeISO(tz);
		} catch {
			return "";
		}

		const today = Temporal.Now.zonedDateTimeISO(tz).toPlainDate();
		const date = zdt.toPlainDate();

		const diffDays = today.since(date, { largestUnit: "day" }).days;

		if (diffDays === 0) {
			return zdt.toLocaleString(undefined, {
				hour: "numeric",
				minute: "2-digit",
			});
		}

		if (date.year === today.year) {
			return zdt.toLocaleString(undefined, {
				month: "short",
				day: "numeric",
			});
		}

		return zdt.toLocaleString(undefined, {
			month: "short",
			day: "numeric",
			year: "numeric",
		});
	}

	function formatRelative(input?: string | number | Date) {
		const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
		if (!input) return "";

		let zdt: Temporal.ZonedDateTime;
		try {
			const instant = Temporal.Instant.from(new Date(input).toISOString());
			zdt = instant.toZonedDateTimeISO(tz);
		} catch {
			return "";
		}

		const now = Temporal.Now.zonedDateTimeISO(tz);
		const dur = now.since(zdt, { largestUnit: "day" });

		const days = Math.abs(dur.days);
		const hours = Math.abs(dur.hours);
		const minutes = Math.abs(dur.minutes);

		if (days >= 1) return `${days}d ago`;
		if (hours >= 1) return `${hours}h ago`;
		if (minutes >= 1) return `${minutes}m ago`;
		return "just now";
	}

	function getThreadTimeLabel(item: typeof mailboxThreadItem) {
		const now = Date.now();

		if (item.snoozedUntil && new Date(item.snoozedUntil).getTime() > now) {
			return {
				text: "Snoozed",
				className: "text-sm text-orange-400",
				title: `Snoozed until ${new Date(item.snoozedUntil).toLocaleString()}`,
			};
		}

		if (item.unsnoozedAt) {
			const ageMs = now - new Date(item.unsnoozedAt).getTime();
			const showWindowMs = 60 * 60 * 1000;

			if (ageMs >= 0 && ageMs <= showWindowMs) {
				return {
					text: `Snoozed back ${formatRelative(item.unsnoozedAt)}`,
					className: "text-sm text-orange-400",
					title: `Returned from snooze ${new Date(item.unsnoozedAt).toLocaleString()}`,
				};
			}
		}

		const date = new Date(item.lastActivityAt || now);
		return {
			text: formatDateLabel(date),
			className: "text-sm text-foreground",
			title: "",
		};
	}

	const router = useRouter();

	const timeLabel = getThreadTimeLabel(mailboxThreadItem);

	const pathname = usePathname();
	const isOnSnoozedPage = pathname.split("/").includes("snoozed");

	const openThread = async () => {
		const url = pathname.match("/dashboard/mail")
			? `/w/${workspacePublicId}/dashboard/mail/${identityPublicId}/${activeMailbox.slug}/threads/${mailboxThreadItem.threadId}`
			: `/mail/${identityPublicId}/${activeMailbox.slug}/threads/${mailboxThreadItem.threadId}`;

		// TODO: Fix full page reload on snoozed page, hoist @thread layout to higher level
		if (isOnSnoozedPage) {
			window.location.href = url;
			return;
		}
		router.push(url);
	};

	const allNames = formatParticipants(
		mailboxThreadItem.participants,
		activeMailbox.kind,
	);
	const previewText = cleanPreviewText(mailboxThreadItem.previewText);

	const canMarkAsRead = mailboxThreadItem.unreadCount > 0;
	const canMarkAsUnread =
		mailboxThreadItem.messageCount > 0 && mailboxThreadItem.unreadCount === 0;

	const isRead = mailboxThreadItem.unreadCount === 0;

	const { state, setState } = useDynamicContext<{
		selectedThreadIds: Set<string>;
	}>();

	const { schedule, isPending } = usePendingThreadActions();

	if (isPending(mailboxThreadItem.threadId)) return null;

	const swipeTrash: SwipeAction = {
		icon: <Trash2 className="h-5 w-5" />,
		label: "Move to Trash",
		bgClassName: "bg-red-500",
		onCommit: () =>
			schedule(
				mailboxThreadItem.threadId,
				() =>
					moveToTrash(
						mailboxThreadItem.threadId,
						activeMailbox.id,
						!!mailboxSync,
						true,
						undefined,
						pathname,
					),
				"Moved to Trash",
			),
	};

	// Nothing to do if the thread is already read, so that direction stays inert.
	const swipeMarkRead: SwipeAction | null = canMarkAsRead
		? {
				icon: <MailOpen className="h-5 w-5" />,
				label: "Mark as read",
				bgClassName: "bg-blue-500",
				onCommit: () =>
					schedule(
						mailboxThreadItem.threadId,
						() =>
							markAsRead(
								mailboxThreadItem.threadId,
								activeMailbox.id,
								!!mailboxSync,
								true,
								pathname,
							),
						"Marked as read",
					),
			}
		: null;

	return (
		<>
			<SwipeableThreadRow
				left={swipeTrash}
				right={swipeMarkRead}
				className={[
					"relative group flex cursor-pointer items-start gap-3",
					"px-3 py-2.5 transition-colors hover:bg-muted/70",
					// grid from md up: minmax(0,1fr) is what keeps a long subject
					// from widening the row past its container
					"md:grid md:grid-cols-[auto_minmax(9rem,14rem)_minmax(0,1fr)_auto] md:items-center",
					isRead ? "bg-muted/30" : "font-semibold",
				].join(" ")}
			>
				{/* controls */}
				<div className="flex shrink-0 items-center gap-2 pt-0.5 md:pt-0">
					{!isOnSnoozedPage && (
						<input
							type="checkbox"
							onChange={(e) => {
								const newSet = new Set(state?.selectedThreadIds);
								if (e.target.checked) {
									newSet.add(mailboxThreadItem.threadId);
								} else {
									newSet.delete(mailboxThreadItem.threadId);
								}
								setState({ selectedThreadIds: newSet });
							}}
							checked={state?.selectedThreadIds?.has(
								mailboxThreadItem.threadId,
							)}
							aria-label={`Select thread ${mailboxThreadItem.subject}`}
							className="h-4 w-4 rounded border-muted-foreground/40"
							onClick={(e) => e.stopPropagation()}
						/>
					)}

					<button
						type="button"
						aria-label="Star"
						className="text-muted-foreground hover:text-foreground"
						onClick={async () => {
							await toggleStar(
								mailboxThreadItem.threadId,
								activeMailbox.id,
								mailboxThreadItem.starred,
								!!mailboxSync,
								pathname,
							);
							router.refresh();
						}}
					>
						{mailboxThreadItem.starred ? (
							<IconStarFilled className={"text-yellow-400"} size={14} />
						) : (
							<IconStar className="h-3.5 w-3.5" />
						)}
					</button>
				</div>

				{/*
					One row, two shapes: stacked on phones, a single line from md up.
					md:contents dissolves this wrapper so the two blocks below become
					grid cells of the <li>. The date renders twice — inline with the
					sender on mobile, in its own column on desktop.
				*/}
				<div
					onClick={openThread}
					className="flex min-w-0 flex-1 flex-col md:contents"
				>
					<div className="flex min-w-0 items-baseline gap-2">
						<span className="min-w-0 flex-1 truncate">{allNames}</span>
						{mailboxThreadItem.messageCount > 1 && (
							<span className="shrink-0 text-xs text-muted-foreground font-normal">
								{mailboxThreadItem.messageCount}
							</span>
						)}
						<time
							className="ml-auto shrink-0 whitespace-nowrap text-xs text-muted-foreground font-normal md:hidden"
							title={timeLabel.title}
						>
							{timeLabel.text}
						</time>
					</div>

					<div className="flex min-w-0 flex-1 flex-col md:flex-row md:items-center md:gap-1">
						<div className="flex min-w-0 items-center gap-1 md:max-w-[60%]">
							<LabelRowTag
								threadId={mailboxThreadItem.threadId}
								labelsByThreadId={labelsByThreadId}
								isRead={isRead}
							/>
							<span className="min-w-0 flex-1 truncate">
								{mailboxThreadItem.subject}
							</span>
							{mailboxThreadItem.hasAttachments && (
								<Paperclip className="h-3.5 w-3.5 shrink-0 text-muted-foreground md:h-4 md:w-4" />
							)}
						</div>
						{previewText && (
							<>
								<span className="mx-1 hidden shrink-0 text-muted-foreground md:inline">
									–
								</span>
								<span className="min-w-0 flex-1 truncate text-muted-foreground font-normal">
									{previewText}
								</span>
							</>
						)}
					</div>
				</div>

				<time
					className={[
						"hidden shrink-0 whitespace-nowrap transition-opacity",
						"group-hover:opacity-0 md:block",
						timeLabel.className,
					].join(" ")}
					title={timeLabel.title}
				>
					{timeLabel.text}
				</time>

				<div
					className={[
						"pointer-events-none absolute inset-y-0 right-0 hidden w-40 items-center justify-end gap-1 pr-3 pl-8 md:flex",
						"bg-gradient-to-l from-muted from-60% to-transparent",
						"opacity-0 transition-opacity duration-100",
						"group-hover:opacity-100 group-hover:pointer-events-auto",
					].join(" ")}
					onClick={(e) => e.stopPropagation()}
				>
					<ThreadLabelHoverButtons
						mailboxThreadItem={mailboxThreadItem}
						labelsByThreadId={labelsByThreadId}
						allLabels={globalLabels}
					/>

					{canMarkAsUnread && (
						<button
							onClick={async () => {
								await markAsUnread(
									mailboxThreadItem.threadId,
									activeMailbox.id,
									!!mailboxSync,
									true,
									pathname,
								);
								router.refresh();
							}}
							className="rounded p-1 hover:bg-muted"
							title="Mark as unread"
						>
							<Mail className="h-4 w-4" />
						</button>
					)}
					{canMarkAsRead && (
						<button
							onClick={async () => {
								await markAsRead(
									mailboxThreadItem.threadId,
									activeMailbox.id,
									!!mailboxSync,
									true,
									pathname,
								);
								router.refresh();
							}}
							className="rounded p-1 hover:bg-muted"
							title="Mark as read"
						>
							<MailOpen className="h-4 w-4" />
						</button>
					)}

					<SnoozeMail
						mailboxThreadId={mailboxThreadItem.threadId}
						activeMailboxId={activeMailbox.id}
					/>

					<button
						onClick={async () => {
							try {
								await moveToTrash(
									mailboxThreadItem.threadId,
									activeMailbox.id,
									!!mailboxSync,
									true,
									undefined,
									pathname,
								);
								router.refresh();
								toast.success("Messages moved to Trash", {
									position: "bottom-left",
								});
							} catch {
								toast.error("Failed to move message to Trash", {
									position: "bottom-left",
								});
							}
						}}
						className="rounded p-1 hover:bg-muted"
						title="Delete"
					>
						<Trash2 className="h-4 w-4" />
					</button>
				</div>
			</SwipeableThreadRow>
		</>
	);
}
