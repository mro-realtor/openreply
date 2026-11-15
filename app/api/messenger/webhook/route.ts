import { createHmac, timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { messengerEvents } from "@/lib/messenger/events";
import { routeMessengerEvent } from "@/lib/messenger/router";

export function GET(request: NextRequest) {
  const query = request.nextUrl.searchParams;
  const token = process.env.MESSENGER_VERIFY_TOKEN;
  const challenge = query.get("hub.challenge");
  if (token && challenge && query.get("hub.mode") === "subscribe" && query.get("hub.verify_token") === token) {
    return new NextResponse(challenge);
  }
  return new NextResponse(null, { status: 403 });
}

export async function POST(request: NextRequest) {
  const secret = process.env.MESSENGER_APP_SECRET || process.env.FACEBOOK_APP_SECRET;
  const signature = request.headers.get("x-hub-signature-256");
  const body = await request.text();
  if (!secret || !signature || !/^sha256=[a-f0-9]{64}$/.test(signature) ||
      !timingSafeEqual(Buffer.from(signature), Buffer.from("sha256=" + createHmac("sha256", secret).update(body).digest("hex")))) {
    return new NextResponse(null, { status: 401 });
  }
  let payload: unknown;
  try { payload = JSON.parse(body); } catch { return new NextResponse(null, { status: 400 }); }
  const events = messengerEvents(payload);
  for (const event of events) await routeMessengerEvent(event);
  return NextResponse.json({ success: true });
}
