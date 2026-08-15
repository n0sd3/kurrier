type AddressObjectJSON = {
	value: Array<{ address?: string | null; name: string }>;
};

export type PushMessageInfo = {
	threadId: string;
	subject: string | null;
	from: AddressObjectJSON | null;
};

export type PushPayload = {
	title: string;
	body: string;
	threadId: string | null;
};

const GROUP_THRESHOLD = 3;

export function buildPushPayloads(messages: PushMessageInfo[]): PushPayload[] {
	if (messages.length === 0) return [];

	if (messages.length > GROUP_THRESHOLD) {
		return [
			{
				title: `${messages.length} new emails`,
				body: "Tap to open your inbox",
				threadId: null,
			},
		];
	}

	return messages.map((message) => ({
		title: senderLabel(message.from),
		body: message.subject || "(no subject)",
		threadId: message.threadId,
	}));
}

function senderLabel(from: AddressObjectJSON | null): string {
	const first = from?.value?.[0];
	return first?.name || first?.address || "New email";
}
