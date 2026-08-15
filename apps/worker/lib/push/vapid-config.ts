export function getVapidConfig(): {
	publicKey: string;
	privateKey: string;
	subject: string;
} | null {
	const publicKey = process.env.VAPID_PUBLIC_KEY;
	const privateKey = process.env.VAPID_PRIVATE_KEY;
	const subject = process.env.VAPID_SUBJECT;

	if (!publicKey || !privateKey || !subject) return null;

	return { publicKey, privateKey, subject };
}
