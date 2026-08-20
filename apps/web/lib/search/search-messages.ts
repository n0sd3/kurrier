// Deliberately NOT "use server": apps/web/lib/actions/mailbox.ts has that
// directive at the module level, which makes every export a POST-addressable
// server action. searchMessages takes raw filter strings and joins them
// straight into a Typesense filter_by clause with no auth check of its own —
// as a server action it would be directly callable by anyone who can read
// the action id out of the client bundle, letting them pass an arbitrary
// workspacePublicId filter and read another workspace's indexed mail. Living
// in a plain module means it can only be reached through the two callers
// that already resolve their own filters server-side (initSearch,
// initUnifiedSearch), not directly over the wire.
import Typesense, { Client } from "typesense";
import { getServerEnv, SearchThreadsResponse } from "@schema";
import { PAGE_SIZE } from "@common/mail-client";

let typeSenseClient: Client | null = null;
function getTypeSenseClient(): Client {
	if (typeSenseClient) return typeSenseClient;

	const {
		TYPESENSE_API_KEY,
		TYPESENSE_PORT,
		TYPESENSE_PROTOCOL,
		TYPESENSE_HOST,
	} = getServerEnv();

	typeSenseClient = new Typesense.Client({
		nodes: [
			{
				host: TYPESENSE_HOST,
				port: Number(TYPESENSE_PORT),
				protocol: TYPESENSE_PROTOCOL,
			},
		],
		apiKey: TYPESENSE_API_KEY,
	});

	return typeSenseClient;
}

export const searchMessages = async (
	filters: string[],
	q: string,
	page: number,
): Promise<SearchThreadsResponse> => {
	const client = getTypeSenseClient();

	const result = (await client.collections("messages").documents().search({
		q,
		query_by: "subject,html,text,snippet,fromName,fromEmail,participants",
		filter_by: filters.join(" && "),
		sort_by: "createdAt:desc",
		group_by: "threadId",
		group_limit: 1,
		per_page: PAGE_SIZE,
		page,
	})) as any;

	const groups = result?.grouped_hits as
		| Array<{ group_key: string[]; hits: Array<{ document: any }> }>
		| undefined;

	const sourceHits = groups?.length
		? groups.map((g) => g.hits[0]?.document ?? {})
		: (result?.hits ?? []).map((h: any) => h.document ?? {});

	return {
		items: sourceHits.map((d: any) => ({
			id: d.id ?? "",
			threadId: d.threadId ?? "",
			mailboxId: d.mailboxId ?? "",
			identityPublicId: d.identityPublicId ?? "",
			subject: d.subject ?? null,
			snippet: (d.snippet ?? d.text ?? "").slice(0, 200),
			fromName: d.fromName ?? null,
			fromEmail: d.fromEmail ?? null,
			participants: Array.isArray(d.participants) ? d.participants : [],
			labels: Array.isArray(d.labels) ? d.labels : [],
			hasAttachment: Number(d.hasAttachment) === 1,
			unread: Number(d.unread) === 1,
			starred: Number(d.starred) === 1,
			createdAt: d.createdAt ?? 0,
			lastInThreadAt: d.lastInThreadAt ?? d.createdAt ?? 0,
		})),
		totalThreads: result?.found ?? sourceHits.length,
		totalMessages: result?.found_docs ?? sourceHits.length,
	};
};
