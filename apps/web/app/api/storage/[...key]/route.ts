import { NextRequest } from "next/server";
import { GetObjectCommand } from "@aws-sdk/client-s3";
import { getServerEnv } from "@schema";

import { isSignedIn } from "@/lib/actions/auth";
import { s3 } from "@/lib/create-s3-client";
import { isKeyReadableBy } from "@/lib/storage-object-access";

export async function GET(
	request: NextRequest,
	{ params }: { params: Promise<{ key: string[] }> },
) {
	const user = await isSignedIn();
	if (!user) return new Response("Unauthorized", { status: 401 });

	// Next already percent-decodes dynamic segments.
	const { key: segments } = await params;
	const key = segments.join("/");

	if (!isKeyReadableBy(key, user.id)) {
		return new Response("Not found", { status: 404 });
	}

	const { S3_BUCKET } = getServerEnv();
	const range = request.headers.get("range") ?? undefined;

	try {
		const object = await s3.send(
			new GetObjectCommand({ Bucket: S3_BUCKET, Key: key, Range: range }),
		);

		if (!object.Body) return new Response("Not found", { status: 404 });

		const headers = new Headers({
			"Content-Type": object.ContentType ?? "application/octet-stream",
			// Objects are immutable once written, but they are per-user: keep them
			// out of any shared cache.
			"Cache-Control": "private, max-age=3600",
			"Content-Disposition": "inline",
			"X-Content-Type-Options": "nosniff",
		});

		if (object.ContentLength !== undefined) {
			headers.set("Content-Length", String(object.ContentLength));
		}
		if (object.ETag) headers.set("ETag", object.ETag);
		if (object.ContentRange) {
			headers.set("Content-Range", object.ContentRange);
			headers.set("Accept-Ranges", "bytes");
		}

		return new Response(object.Body.transformToWebStream(), {
			status: object.ContentRange ? 206 : 200,
			headers,
		});
	} catch (error) {
		const name = (error as { name?: string })?.name;
		if (name === "NoSuchKey" || name === "NotFound") {
			return new Response("Not found", { status: 404 });
		}
		console.error(`Failed to read storage object ${key}`, error);
		return new Response("Storage unavailable", { status: 502 });
	}
}
