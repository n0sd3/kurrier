import React from "react";

/**
 * Rendered when the workspace has no DAV-backed calendar yet. Provisioning is
 * queued asynchronously when an identity is created, so this is the expected
 * state for the short window before the `dav:create-identity` job completes.
 */
function NoCalendarPlaceholder() {
	return (
		<div className="flex flex-1 flex-col items-center justify-center gap-2 p-8 text-center">
			<h2 className="text-lg font-semibold text-foreground">
				No calendar yet
			</h2>
			<p className="max-w-prose text-sm text-muted-foreground">
				Your calendar is still being set up. This usually takes a few seconds
				after an identity is added — refresh the page to check again.
			</p>
		</div>
	);
}

export default NoCalendarPlaceholder;
