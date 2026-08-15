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
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
			setLoading(false);
			return;
		}
		navigator.serviceWorker.ready
			.then((reg) => reg.pushManager.getSubscription())
			.then((sub) => setEnabled(!!sub))
			.finally(() => setLoading(false));
	}, []);

	async function handleToggle(next: boolean) {
		setError(null);

		if (!VAPID_PUBLIC_KEY) {
			setError("Push notifications aren't configured on this server.");
			return;
		}

		const reg = await navigator.serviceWorker.ready;

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

			await subscribeToPush({
				endpoint: sub.endpoint,
				keys: {
					p256dh: btoa(String.fromCharCode(...new Uint8Array(sub.getKey("p256dh")!))),
					auth: btoa(String.fromCharCode(...new Uint8Array(sub.getKey("auth")!))),
				},
				userAgent: navigator.userAgent,
			});
			setEnabled(true);
		} else {
			const sub = await reg.pushManager.getSubscription();
			if (sub) {
				await unsubscribeFromPush(sub.endpoint);
				await sub.unsubscribe();
			}
			setEnabled(false);
		}
	}

	if (loading) return null;

	return (
		<div className="flex flex-col gap-2">
			<div className="flex items-center justify-between">
				<div>
					<p className="font-medium">Push notifications</p>
					<p className="text-sm text-muted-foreground">
						Get notified in this browser when new email arrives in your Inbox.
					</p>
				</div>
				<Switch checked={enabled} onCheckedChange={handleToggle} />
			</div>
			{error && <p className="text-sm text-destructive">{error}</p>}
		</div>
	);
}
