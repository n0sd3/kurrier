"use client";

import { useEffect, useState } from "react";
import { Switch } from "@/components/ui/switch";
import { useConfigContext } from "@/components/providers/config-provider";
import { subscribeToPush, unsubscribeFromPush } from "@/lib/actions/push";

function urlBase64ToUint8Array(base64String: string) {
	const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
	const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
	const rawData = atob(base64);
	return Uint8Array.from([...rawData].map((char) => char.charCodeAt(0)));
}

export function ManagePushNotifications() {
	const { VAPID_PUBLIC_KEY } = useConfigContext();
	const [enabled, setEnabled] = useState(false);
	const [loading, setLoading] = useState(true);
	const [submitting, setSubmitting] = useState(false);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
			setLoading(false);
			return;
		}
		// Use getRegistration() rather than `.ready` for the initial check:
		// `.ready` never resolves if no service worker has been registered
		// (e.g. local dev, where PwaRegister only registers in production),
		// which would otherwise hang `loading` forever.
		navigator.serviceWorker
			.getRegistration()
			.then((reg) => reg?.pushManager.getSubscription() ?? null)
			.then((sub) => setEnabled(!!sub))
			.catch(() => setEnabled(false))
			.finally(() => setLoading(false));
	}, []);

	async function getOrRegisterServiceWorker(): Promise<ServiceWorkerRegistration> {
		let reg = await navigator.serviceWorker.getRegistration();
		if (!reg) {
			// PwaRegister only registers the service worker in production
			// builds, so in dev (or if production registration hasn't
			// completed yet) we register it ourselves here — otherwise the
			// toggle would be unusable outside a production build.
			reg = await navigator.serviceWorker.register("/sw.js");
		}
		return Promise.race([
			navigator.serviceWorker.ready,
			new Promise<never>((_, reject) =>
				setTimeout(() => reject(new Error("Service worker took too long to activate.")), 10000),
			),
		]);
	}

	async function handleToggle(next: boolean) {
		setError(null);

		if (!VAPID_PUBLIC_KEY) {
			setError("Push notifications aren't configured on this server.");
			return;
		}

		setSubmitting(true);
		try {
			const reg = await getOrRegisterServiceWorker();

			if (next) {
				const permission = await Notification.requestPermission();
				if (permission !== "granted") {
					setError("Notification permission was denied.");
					return;
				}

				const sub = await reg.pushManager.subscribe({
					userVisibleOnly: true,
					applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
				});

				try {
					await subscribeToPush({
						endpoint: sub.endpoint,
						keys: {
							p256dh: btoa(String.fromCharCode(...new Uint8Array(sub.getKey("p256dh")!))),
							auth: btoa(String.fromCharCode(...new Uint8Array(sub.getKey("auth")!))),
						},
						userAgent: navigator.userAgent,
					});
				} catch (actionError) {
					// The browser subscription succeeded but the server
					// never learned about it — self-heal by tearing down
					// the browser-side subscription so client and server
					// can't disagree about whether push is enabled.
					await sub.unsubscribe().catch(() => {});
					throw actionError;
				}

				setEnabled(true);
			} else {
				const sub = await reg.pushManager.getSubscription();
				if (sub) {
					await unsubscribeFromPush(sub.endpoint);
					await sub.unsubscribe();
				}
				setEnabled(false);
			}
		} catch (err) {
			console.error("Failed to update push notification settings", err);
			setError("Something went wrong updating your notification settings. Please try again.");
		} finally {
			setSubmitting(false);
		}
	}

	if (loading) {
		return <p className="text-sm text-muted-foreground">Loading notification settings…</p>;
	}

	return (
		<div className="flex flex-col gap-2">
			<div className="flex items-center justify-between">
				<div>
					<p className="font-medium">Push notifications</p>
					<p className="text-sm text-muted-foreground">
						Get notified in this browser when new email arrives in your Inbox.
					</p>
				</div>
				<Switch checked={enabled} onCheckedChange={handleToggle} disabled={submitting} />
			</div>
			{error && <p className="text-sm text-destructive">{error}</p>}
		</div>
	);
}
