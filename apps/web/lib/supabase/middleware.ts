import { NextResponse, type NextRequest } from "next/server";

export async function updateSession(request: NextRequest, extraHeaders?: HeadersInit) {
	if (!extraHeaders) {
		return NextResponse.next({ request });
	}

	const headers = new Headers(request.headers);
	new Headers(extraHeaders).forEach((value, key) => headers.set(key, value));

	return NextResponse.next({ request: { headers } });
}
