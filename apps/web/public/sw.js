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
