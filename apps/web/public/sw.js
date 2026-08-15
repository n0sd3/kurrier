// Hand-rolled service worker: app-shell + static asset caching only.
// Never intercepts non-GET requests or API/auth/DAV traffic — mail, calendar,
// contacts and drive data must always come straight from the network.
const CACHE_NAME = "kurrier-static-v1";
const OFFLINE_URL = "/offline.html";
const PRECACHE_URLS = [OFFLINE_URL, "/manifest.json", "/icons/icon-192.png", "/icons/icon-512.png"];

const NEVER_CACHE_PREFIXES = ["/api/", "/dav", "/oauth/", "/.well-known/"];

function isNeverCache(pathname) {
	return NEVER_CACHE_PREFIXES.some((prefix) => pathname.startsWith(prefix));
}

function isStaticAsset(pathname) {
	return pathname.startsWith("/_next/static/") || pathname.startsWith("/icons/");
}

self.addEventListener("install", (event) => {
	event.waitUntil(
		caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE_URLS)),
	);
});

self.addEventListener("activate", (event) => {
	event.waitUntil(
		caches.keys().then((keys) =>
			Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))),
		),
	);
});

self.addEventListener("fetch", (event) => {
	const { request } = event;
	if (request.method !== "GET") return;

	const url = new URL(request.url);
	if (url.origin !== self.location.origin) return;
	if (isNeverCache(url.pathname)) return;

	if (request.mode === "navigate") {
		event.respondWith(
			fetch(request).catch(
				() => caches.match(request).then((cached) => cached || caches.match(OFFLINE_URL)),
			),
		);
		return;
	}

	if (isStaticAsset(url.pathname)) {
		event.respondWith(
			caches.match(request).then(
				(cached) =>
					cached ||
					fetch(request).then((response) => {
						const copy = response.clone();
						caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
						return response;
					}),
			),
		);
	}
});

self.addEventListener("push", (event) => {
	if (!event.data) return;

	let payload;
	try {
		payload = event.data.json();
	} catch {
		return;
	}

	const { title, body, url } = payload;

	event.waitUntil(
		self.registration.showNotification(title, {
			body,
			icon: "/icons/icon-192.png",
			data: { url },
		}),
	);
});

self.addEventListener("notificationclick", (event) => {
	event.notification.close();
	const url = event.notification.data?.url || "/";

	event.waitUntil(
		clients.matchAll({ type: "window", includeUncontrolled: true }).then((windowClients) => {
			// Prefer a window that's already showing the target URL over
			// hijacking whichever window happened to be first in the list.
			// `url` (from notification.data.url) is relative; WindowClient.url
			// is always an absolute href, so resolve before comparing or this
			// branch never matches.
			const target = new URL(url, self.location.origin).href;
			const matching = windowClients.find((client) => client.url === target);
			if (matching && "focus" in matching) {
				return matching.focus();
			}

			const client = windowClients[0];
			if (client && "focus" in client) {
				// client.navigate() rejects when the client isn't controlled by
				// this service worker (possible with includeUncontrolled: true).
				// Fall back to opening a new window rather than silently
				// leaving a focused window that never navigated.
				return client
					.navigate(url)
					.then((navigated) => (navigated || client).focus())
					.catch(() => clients.openWindow(url));
			}

			return clients.openWindow(url);
		}),
	);
});
