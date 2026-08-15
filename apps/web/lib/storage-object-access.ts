/**
 * Object storage is only reachable from inside the Docker network, so presigned
 * URLs built against S3_ENDPOINT can never be fetched by a browser. Objects are
 * served through /api/storage instead; these helpers describe who may read what.
 */

/** Storage roots whose second path segment is the owning user id. */
const OWNED_ROOTS = new Set(["private", "eml"]);

export const STORAGE_PROXY_PREFIX = "/api/storage/";

export function isKeyReadableBy(key: string, userId: string): boolean {
	if (!key || !userId) return false;

	const segments = key.split("/");
	if (segments.length < 3) return false;
	if (segments.some((segment) => segment === "" || segment === "." || segment === "..")) {
		return false;
	}

	const [root, ownerId] = segments;
	return OWNED_ROOTS.has(root) && ownerId === userId;
}

export function storageObjectUrl(key: string | null | undefined): string | null {
	if (!key) return null;

	const path = key
		.split("/")
		.map((segment) => encodeURIComponent(segment))
		.join("/");

	return `${STORAGE_PROXY_PREFIX}${path}`;
}
