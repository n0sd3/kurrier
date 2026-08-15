import { FetchMailboxThreadsResult } from "@/lib/actions/mailbox";

type Participants = FetchMailboxThreadsResult[number]["participants"];
type Participant = { n?: string | null; e: string };

/** Mailboxes where the interesting party is the recipient, not the sender. */
const OUTGOING_KINDS = new Set(["sent", "drafts", "outbox"]);

function dedupe(lists: Participant[][], max: number) {
	const seen = new Set<string>();
	const merged: Participant[] = [];

	for (const list of lists) {
		for (const x of list) {
			const e = x?.e?.trim();
			if (!e) continue;
			const key = e.toLowerCase();
			if (seen.has(key)) continue;
			seen.add(key);
			merged.push({ n: x.n, e });
			if (merged.length >= max) return merged;
		}
	}

	return merged;
}

/**
 * Names to show in the sender column. Incoming mail shows who wrote it;
 * Sent/Drafts/Outbox show who it went to. Merging every field made the
 * user's own address repeat on every row.
 */
export function formatParticipants(p: Participants, mailboxKind?: string) {
	const from = p?.from ?? [];
	const recipients = [p?.to ?? [], p?.cc ?? [], p?.bcc ?? []];

	const lists = OUTGOING_KINDS.has(mailboxKind ?? "")
		? recipients
		: from.length > 0
			? [from]
			: recipients;

	const names = dedupe(lists, 6).map((x) => (x.n && x.n.trim()) || x.e);
	return names.slice(0, 3).join(", ") + (names.length > 3 ? "…" : "");
}

/** The one participant the row is "about" — drives the avatar. */
export function primaryParticipant(p: Participants, mailboxKind?: string) {
	const from = p?.from ?? [];
	const recipients = [p?.to ?? [], p?.cc ?? [], p?.bcc ?? []];

	const lists = OUTGOING_KINDS.has(mailboxKind ?? "")
		? recipients
		: from.length > 0
			? [from]
			: recipients;

	const [first] = dedupe(lists, 1);
	if (!first) return { label: "", email: "" };
	return { label: (first.n && first.n.trim()) || first.e, email: first.e };
}

const ENTITIES: Record<string, string> = {
	"&nbsp;": " ",
	"&amp;": "&",
	"&lt;": "<",
	"&gt;": ">",
	"&quot;": '"',
	"&#39;": "'",
};

/**
 * Preview text arrives with markup and tracking URLs still in it. Clean it
 * for display only — the stored value is left untouched.
 */
export function cleanPreviewText(input?: string | null) {
	if (!input) return "";

	return input
		.replace(/<style[\s\S]*?<\/style>/gi, " ")
		.replace(/<script[\s\S]*?<\/script>/gi, " ")
		.replace(/<[^>]*>/g, " ")
		// preview text is pre-truncated, so the last tag is often unterminated
		.replace(/<[^>]*$/, " ")
		.replace(/&[a-z]+;|&#\d+;/gi, (m) => ENTITIES[m.toLowerCase()] ?? " ")
		.replace(/\[?\bhttps?:\/\/\S+\]?/gi, " ")
		.replace(/\s+/g, " ")
		.trim();
}
