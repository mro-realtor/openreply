import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/client";
import { isValidMediaSignature } from "@/lib/media-assets";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const signature = new URL(_request.url).searchParams.get("sig");
  if (!isValidMediaSignature(id, signature)) return new NextResponse("Not found", { status: 404 });
  const asset = await prisma.mediaAsset.findUnique({ where: { id }, select: { data: true, mimeType: true, filename: true } });
  if (!asset) return new NextResponse("Not found", { status: 404 });
  return new NextResponse(asset.data, { headers: { "Content-Type": asset.mimeType, "Content-Disposition": `inline; filename="${asset.filename.replace(/[\"\\\r\n]/g, "_")}"`, "Cache-Control": "public, max-age=31536000, immutable" } });
}
