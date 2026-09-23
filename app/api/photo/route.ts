import { NextRequest } from "next/server";
import { getR2 } from "@/db";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const key = request.nextUrl.searchParams.get("key");
  if (!key || !/^[a-f0-9-]+\.(jpg|png|webp)$/.test(key)) {
    return new Response("Not found", { status: 404 });
  }

  try {
    const object = await getR2().get(key);
    if (!object) return new Response("Not found", { status: 404 });
    const headers = new Headers();
    object.writeHttpMetadata(headers);
    headers.set("Cache-Control", "private, max-age=86400");
    headers.set("ETag", object.httpEtag);
    return new Response(object.body, { headers });
  } catch (error) {
    console.error("device_photo_read_failed", error);
    return new Response("Image unavailable", { status: 503 });
  }
}
