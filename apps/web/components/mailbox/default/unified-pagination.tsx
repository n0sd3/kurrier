"use client";

import * as React from "react";
import { Pagination } from "@mantine/core";
import { useRouter } from "next/navigation";
import { pageHref, totalPages } from "@/lib/unified-mailbox";

type Props = {
	total: number;
	pageSize: number;
	page: number;
	/** Path without a query string; the page param is appended to it. */
	basePath: string;
	/** Query params that must survive a page change — the search view's query and filters. */
	preservedParams?: Record<string, string>;
};

/**
 * Serves both unified views. They differ only in the URL they build, so this
 * component takes the path and the params to preserve rather than knowing
 * anything about mailboxes or search.
 */
export default function UnifiedPagination({
	total,
	pageSize,
	page,
	basePath,
	preservedParams,
}: Props) {
	const router = useRouter();
	const pages = totalPages(total, pageSize);

	// Nothing to navigate between.
	if (pages <= 1) return null;

	// A hand-typed ?page beyond the end would otherwise leave the control
	// showing a page that does not exist.
	const current = Math.min(Math.max(page, 1), pages);

	return (
		<div className="flex justify-center">
			<Pagination
				value={current}
				total={pages}
				onChange={(next) =>
					router.push(pageHref(basePath, preservedParams ?? {}, next))
				}
			/>
		</div>
	);
}
