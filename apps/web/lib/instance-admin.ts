/**
 * Instance administration is opt-in through the ADMIN_EMAILS env var, the same
 * shape as the management API's API_ADMIN_KEY: unset means nobody is an admin.
 * The env value is passed in rather than read here, which keeps these checks
 * pure and testable and leaves the caller responsible for never handing the
 * list to the browser.
 */

/** Minimum length required of a password set through the admin page. */
export const MIN_ADMIN_SET_PASSWORD_LENGTH = 8;

export function parseAdminEmails(raw?: string | null): string[] {
	if (!raw) return [];

	return raw
		.split(",")
		.map((entry) => entry.trim().toLowerCase())
		.filter((entry) => entry !== "");
}

export function isInstanceAdminEmail(
	email?: string | null,
	raw?: string | null,
): boolean {
	if (!email) return false;

	return parseAdminEmails(raw).includes(email.trim().toLowerCase());
}

/** Returns an error message, or null when the password is acceptable. */
export function validateNewPassword(password?: string | null): string | null {
	if (!password) return "Password is required";

	if (password.length < MIN_ADMIN_SET_PASSWORD_LENGTH) {
		return `Password must be at least ${MIN_ADMIN_SET_PASSWORD_LENGTH} characters`;
	}

	return null;
}
