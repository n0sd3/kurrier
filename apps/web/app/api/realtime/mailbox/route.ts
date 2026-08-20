import { isSignedIn } from "@/lib/actions/auth";
import {
	getListenClient,
	MAILBOX_THREADS_CHANNEL,
	type MailboxThreadsNotification,
} from "@/lib/realtime/listen-client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Long enough to stay well clear of proxy idle timeouts (cloudflared cuts at
// 100s), short enough that a dead connection is noticed quickly.
const HEARTBEAT_MS = 25_000;

export async function GET(request: Request) {
	const user = await isSignedIn();
	if (!user) return new Response("Unauthorized", { status: 401 });

	const sql = getListenClient();
	const encoder = new TextEncoder();

	let unlisten: (() => Promise<unknown>) | null = null;
	let heartbeat: ReturnType<typeof setInterval> | null = null;
	let closed = false;

	const stream = new ReadableStream({
		async start(controller) {
			const send = (chunk: string) => {
				if (closed) return;
				try {
					controller.enqueue(encoder.encode(chunk));
				} catch {
					// The consumer went away between the abort signal and here.
					closed = true;
				}
			};

			send(": connected\n\n");

			heartbeat = setInterval(() => send(": ping\n\n"), HEARTBEAT_MS);

			const meta = await sql.listen(MAILBOX_THREADS_CHANNEL, (raw) => {
				let event: MailboxThreadsNotification;
				try {
					event = JSON.parse(raw);
				} catch {
					return;
				}

				// The channel is global — this is the line that keeps one user's
				// mailbox activity from reaching another user's browser.
				if (event.ownerId !== user.id) return;

				send(
					`data: ${JSON.stringify({
						mailboxId: event.mailboxId,
						identityPublicId: event.identityPublicId,
						op: event.op,
					})}\n\n`,
				);
			});

			unlisten = meta.unlisten;

			if (request.signal.aborted) {
				await cleanup();
				return;
			}

			request.signal.addEventListener("abort", () => {
				void cleanup();
			});

			async function cleanup() {
				if (closed) return;
				closed = true;
				if (heartbeat) clearInterval(heartbeat);
				try {
					await unlisten?.();
				} catch {
					// Connection already gone; nothing to release.
				}
				try {
					controller.close();
				} catch {
					// Already closed by the runtime.
				}
			}
		},
		cancel() {
			closed = true;
			if (heartbeat) clearInterval(heartbeat);
			void unlisten?.();
		},
	});

	return new Response(stream, {
		headers: {
			"Content-Type": "text/event-stream; charset=utf-8",
			"Cache-Control": "no-cache, no-transform",
			Connection: "keep-alive",
			// Stops nginx/proxies from buffering the stream into silence.
			"X-Accel-Buffering": "no",
		},
	});
}
