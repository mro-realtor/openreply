import { createHmac, timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/client";
import { messengerEvents } from "@/lib/messenger/events";

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
  if (events.length) {
    const pages = await prisma.messengerPage.findMany({
      where: { id: { in: events.map((event) => event.pageId) } }, select: { id: true },
    });
    const ids = new Set(pages.map((page) => page.id));
    await prisma.messengerEvent.createMany({ data: events.filter((event) => ids.has(event.pageId)), skipDuplicates: true });
  }
  return NextResponse.json({ success: true });
}
