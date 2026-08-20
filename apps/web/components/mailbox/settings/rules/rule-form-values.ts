import type { FetchMailRulesResult } from "@/lib/actions/mail-rules";

// The rule form is a Gmail-style shortcut over the richer match schema: it only
// ever emits `contains` on from/to/subject, contains/not_contains on the body,
// and the attachment/size pair. Editing has to walk that mapping backwards, so
// anything outside it is reported instead of being silently dropped on save.
export type RuleFormValues = {
	name: string;
	priority: number;
	enabled: boolean;
	from: string;
	to: string;
	subject: string;
	hasWords: string;
	doesntHave: string;
	hasAttachment: boolean;
	sizeOp: "gt" | "lt";
	sizeValue: number;
	sizeUnit: "KB" | "MB";
	markRead: boolean;
	flag: boolean;
	trash: boolean;
	applyLabel: boolean;
	labelId: string;
};

export const emptyRuleFormValues: RuleFormValues = {
	name: "New rule",
	priority: 100,
	enabled: true,
	from: "",
	to: "",
	subject: "",
	hasWords: "",
	doesntHave: "",
	hasAttachment: false,
	sizeOp: "gt",
	sizeValue: 0,
	sizeUnit: "MB",
	markRead: false,
	flag: false,
	trash: false,
	applyLabel: false,
	labelId: "",
};

type Rule = FetchMailRulesResult[number];
type Condition = { field: string; op: string; value?: unknown };

const MB = 1024 * 1024;
const KB = 1024;

function asText(value: unknown) {
	return value === null || value === undefined ? "" : String(value);
}

export function ruleToFormValues(rule: Rule): {
	values: RuleFormValues;
	unsupported: Condition[];
} {
	const values: RuleFormValues = {
		...emptyRuleFormValues,
		name: rule.name,
		priority: rule.priority,
		enabled: rule.enabled,
	};

	const unsupported: Condition[] = [];
	const conditions = (rule.match?.conditions ?? []) as Condition[];

	for (const c of conditions) {
		if (c.op === "contains" && c.field === "from") values.from = asText(c.value);
		else if (c.op === "contains" && c.field === "to") values.to = asText(c.value);
		else if (c.op === "contains" && c.field === "subject")
			values.subject = asText(c.value);
		else if (c.op === "contains" && c.field === "text")
			values.hasWords = asText(c.value);
		else if (c.op === "not_contains" && c.field === "text")
			values.doesntHave = asText(c.value);
		else if (c.field === "has_attachments" && c.op === "eq")
			values.hasAttachment = c.value === true || c.value === "true";
		else if (
			c.field === "size_bytes" &&
			(c.op === "gt" || c.op === "lt")
		) {
			const bytes = Number(c.value) || 0;
			values.sizeOp = c.op;
			if (bytes >= MB && bytes % MB === 0) {
				values.sizeUnit = "MB";
				values.sizeValue = bytes / MB;
			} else {
				values.sizeUnit = "KB";
				values.sizeValue = Math.round(bytes / KB);
			}
		} else unsupported.push(c);
	}

	for (const action of rule.actions) {
		if (action.actionType === "mark_read") values.markRead = true;
		else if (action.actionType === "flag") values.flag = true;
		else if (action.actionType === "trash") values.trash = true;
		else if (action.actionType === "add_label") {
			values.applyLabel = true;
			values.labelId = (action.params as any)?.labelId ?? "";
		}
	}

	return { values, unsupported };
}

const FIELD_LABELS: Record<string, string> = {
	from: "From",
	to: "To",
	cc: "Cc",
	bcc: "Bcc",
	reply_to: "Reply-To",
	subject: "Subject",
	text: "Body",
	snippet: "Snippet",
	list_id: "List-Id",
	subscription_key: "Subscription",
	has_attachments: "Has attachment",
	size_bytes: "Size",
};

const OP_LABELS: Record<string, string> = {
	exists: "exists",
	not_exists: "does not exist",
	eq: "is",
	not_eq: "is not",
	contains: "contains",
	not_contains: "does not contain",
	starts_with: "starts with",
	ends_with: "ends with",
	regex: "matches",
	gt: "greater than",
	gte: "at least",
	lt: "less than",
	lte: "at most",
	in: "is one of",
	not_in: "is none of",
};

export function describeCondition(c: Condition) {
	const field = FIELD_LABELS[c.field] ?? c.field;
	const op = OP_LABELS[c.op] ?? c.op;

	if (c.op === "exists" || c.op === "not_exists") return `${field} ${op}`;

	if (c.field === "size_bytes") {
		const bytes = Number(c.value) || 0;
		const pretty =
			bytes >= MB ? `${(bytes / MB).toFixed(1)} MB` : `${Math.round(bytes / KB)} KB`;
		return `${field} ${op} ${pretty}`;
	}

	const value = Array.isArray(c.value)
		? c.value.join(", ")
		: asText(c.value);

	return value ? `${field} ${op} “${value}”` : `${field} ${op}`;
}
