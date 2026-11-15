import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/client";
import { getCurrentWorkspaceContext, canManageWorkspace } from "@/lib/workspace-access";
import { mediaSignature } from "@/lib/media-assets";

const MAX_SIZE = 25 * 1024 * 1024;
const ALLOWED = new Set(["image/jpeg", "image/png", "image/gif", "image/webp", "application/pdf", "audio/mpeg", "audio/mp4", "video/mp4"]);

export async function POST(request: Request) {
  const context = await getCurrentWorkspaceContext();
  if (!context || !canManageWorkspace(context.role)) return NextResponse.json({ error: "Administrator required" }, { status: 403 });
  const file = (await request.formData()).get("file");
  if (!(file instanceof File)) return NextResponse.json({ error: "Choose a file" }, { status: 400 });
  if (!ALLOWED.has(file.type)) return NextResponse.json({ error: "This file type is not supported" }, { status: 400 });
  if (file.size < 1 || file.size > MAX_SIZE) return NextResponse.json({ error: "Files must be smaller than 25 MB" }, { status: 400 });
  const asset = await prisma.mediaAsset.create({ data: { workspaceId: context.workspaceId, filename: file.name.slice(0, 200), mimeType: file.type, size: file.size, data: Buffer.from(await file.arrayBuffer()) } });
  return NextResponse.json({ id: asset.id, url: `/api/media/${asset.id}?sig=${mediaSignature(asset.id)}`, filename: asset.filename, mimeType: asset.mimeType, size: asset.size });
}
