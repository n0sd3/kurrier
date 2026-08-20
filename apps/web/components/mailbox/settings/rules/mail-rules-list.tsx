"use client";
import React, { useState } from "react";
import {
    deleteRule,
    FetchAppLabelsResult,
    FetchMailRulesResult,
    runRuleNow,
    toggleRule,
    updateRule,
} from "@/lib/actions/mail-rules";
import { ReusableFormButton } from "@/components/common/reusable-form-button";
import { Pencil, Play, Power, PowerOff, Trash2 } from "lucide-react";
import { usePathname } from "next/navigation";
import { Collapse } from "@mantine/core";
import CreateRuleFormGmailV1 from "@/components/mailbox/settings/rules/create-rule-form";
import {
    describeCondition,
    ruleToFormValues,
} from "@/components/mailbox/settings/rules/rule-form-values";

function formatActionLabel(a: string) {
    return a.replaceAll("_", " ");
}

const chipClasses =
    "inline-flex items-center rounded-full border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-900 px-2 py-0.5 text-[11px] font-medium text-neutral-700 dark:text-neutral-200";

const iconButtonClasses =
    "rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-950 hover:bg-neutral-50 dark:hover:bg-neutral-900";

function MailRuleCard({
    rule,
    appLabels,
    pathname,
}: {
    rule: FetchMailRulesResult[number];
    appLabels: FetchAppLabelsResult;
    pathname: string;
}) {
    const [editing, setEditing] = useState(false);

    const actions = rule.actions.slice().sort((a, b) => a.order - b.order);
    const conditions = rule.match?.conditions ?? [];
    const matchesAny = rule.match?.logic === "any";
    const { values, unsupported } = ruleToFormValues(rule);

    return (
        <div className="rounded-2xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-950 p-4">
            <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                        <div className="truncate text-sm font-semibold text-neutral-900 dark:text-neutral-100">
                            {rule.name}
                        </div>

                        <span
                            className={[
                                "inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium",
                                rule.enabled
                                    ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300"
                                    : "bg-neutral-100 text-neutral-700 dark:bg-neutral-900 dark:text-neutral-300",
                            ].join(" ")}
                        >
                            {rule.enabled ? "Enabled" : "Disabled"}
                        </span>
                    </div>

                    <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-neutral-600 dark:text-neutral-400">
                        <span>Priority {rule.priority}</span>
                    </div>
                </div>

                <div className={"flex items-center gap-3"}>
                    {rule.enabled ? (
                        <ReusableFormButton
                            action={runRuleNow}
                            actionIcon
                            key={`${rule.id}-run`}
                            notify={{ kind: "toast" }}
                            actionIconProps={{
                                size: "sm",
                                variant: "subtle",
                                children: <Play size={16} />,
                                title: "Run this rule on existing messages",
                                className: iconButtonClasses,
                            }}
                        >
                            <input type="hidden" name="ruleId" value={rule.id} />
                        </ReusableFormButton>
                    ) : null}

                    <button
                        type="button"
                        onClick={() => setEditing((v) => !v)}
                        title={editing ? "Close editor" : "Edit rule"}
                        aria-expanded={editing}
                        className={`${iconButtonClasses} flex h-[30px] w-[30px] items-center justify-center text-neutral-700 dark:text-neutral-200`}
                    >
                        <Pencil size={16} />
                    </button>

                    <ReusableFormButton
                        action={toggleRule}
                        actionIcon
                        key={`${rule.id}-toggle-${rule.enabled ? "on" : "off"}`}
                        actionIconProps={{
                            size: "sm",
                            variant: "subtle",
                            children: rule.enabled ? <Power size={16} /> : <PowerOff size={16} />,
                            title: "Toggle rule",
                            className: iconButtonClasses,
                        }}
                    >
                        <input type="hidden" name="ruleId" value={rule.id} />
                        <input type="hidden" name="pathname" value={pathname} />
                    </ReusableFormButton>

                    <ReusableFormButton
                        action={deleteRule}
                        actionIcon
                        key={`${rule.id}-delete`}
                        actionIconProps={{
                            size: "sm",
                            variant: "light",
                            children: <Trash2 size={16} />,
                            title: "Delete rule",
                            className: iconButtonClasses,
                        }}
                    >
                        <input type="hidden" name="ruleId" value={rule.id} />
                    </ReusableFormButton>
                </div>
            </div>

            <div className="mt-4">
                <div className="text-xs font-medium text-neutral-900 dark:text-neutral-100">
                    {matchesAny ? "Matches any of" : "Matches all of"}
                </div>

                {conditions.length ? (
                    <div className="mt-2 flex flex-wrap gap-2">
                        {conditions.map((c, i) => (
                            <span key={`${rule.id}-cond-${i}`} className={chipClasses}>
                                {describeCondition(c)}
                            </span>
                        ))}
                    </div>
                ) : (
                    <div className="mt-2 text-xs text-neutral-600 dark:text-neutral-400">
                        No criteria — this rule never matches.
                    </div>
                )}
            </div>

            <div className="mt-4">
                <div className="text-xs font-medium text-neutral-900 dark:text-neutral-100">
                    Actions
                </div>

                {actions.length ? (
                    <div className="mt-2 flex flex-wrap gap-2">
                        {actions.map((a) => (
                            <span key={a.id} className={chipClasses}>
                                {formatActionLabel(a.actionType)}
                            </span>
                        ))}
                    </div>
                ) : (
                    <div className="mt-2 text-xs text-neutral-600 dark:text-neutral-400">
                        None
                    </div>
                )}
            </div>

            <Collapse in={editing}>
                <div className="mt-4 border-t border-neutral-200 dark:border-neutral-800 pt-4">
                    {unsupported.length ? (
                        <div className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
                            This rule has {unsupported.length} criteria the simple editor
                            can&apos;t show ({unsupported.map(describeCondition).join("; ")}).
                            Saving here replaces them.
                        </div>
                    ) : null}

                    <CreateRuleFormGmailV1
                        // The inputs are uncontrolled, so a saved rule only shows
                        // its new values once the form remounts.
                        key={`${rule.id}-${new Date(rule.updatedAt).getTime()}`}
                        action={updateRule}
                        identityId={rule.identityId}
                        appLabels={appLabels}
                        values={values}
                        ruleId={rule.id}
                        pathname={pathname}
                        submitLabel="Save changes"
                    />
                </div>
            </Collapse>
        </div>
    );
}

export default function MailRulesList({
    rules,
    appLabels,
}: {
    rules: FetchMailRulesResult;
    appLabels: FetchAppLabelsResult;
}) {
    const pathname = usePathname();

    if (!rules.length) {
        return (
            <div className="mt-6 rounded-xl border border-dashed border-neutral-200 dark:border-neutral-800 p-6 text-sm text-neutral-600 dark:text-neutral-400 mb-8">
                No rules yet.
            </div>
        );
    }

    return (
        <div className="mt-6 space-y-3">
            {rules.map((rule) => (
                <MailRuleCard
                    key={rule.id}
                    rule={rule}
                    appLabels={appLabels}
                    pathname={pathname}
                />
            ))}
        </div>
    );
}
