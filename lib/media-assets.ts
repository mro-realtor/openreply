import { createHmac, timingSafeEqual } from "node:crypto";

const secret = () => process.env.AUTH_SECRET ?? process.env.NEXTAUTH_SECRET ?? "openreply-media-development-secret";
export function mediaSignature(id: string) { return createHmac("sha256", secret()).update(id).digest("hex"); }
export function isValidMediaSignature(id: string, signature: string | null) {
  if (!signature || !/^[a-f0-9]{64}$/.test(signature)) return false;
  const expected = Buffer.from(mediaSignature(id), "hex");
  const provided = Buffer.from(signature, "hex");
  return expected.length === provided.length && timingSafeEqual(expected, provided);
}
