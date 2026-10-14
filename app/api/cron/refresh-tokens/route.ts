import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/client";
import { decryptToken, encryptToken } from "@/lib/meta/oauth";
import { maintainInstagramAccounts } from "@/lib/instagram/maintenance";
import { liveMetaOps } from "@/lib/instagram/meta-ops";

/**
 * Daily upkeep for every connected Instagram account: refresh tokens ahead of
 * expiry, verify and restore webhook subscriptions, and record anything that
 * needs a person (alerts). Safe to run more often than daily: each account has
 * its own schedule, backoff and lock, so extra runs only retry what is due.
 * Also resets the monthly usage counters, as before.
 */
export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET || process.env.NEXTAUTH_SECRET;

  if (authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json(
      { success: false, error: "Unauthorized" },
      { status: 401 }
    );
  }

  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

  const usageReset = await prisma.workspace.updateMany({
    where: { usagePeriodStart: { lt: monthStart } },
    data: {
      usagePeriodStart: monthStart,
      dmsSentThisPeriod: 0,
    },
  });

  const results = await maintainInstagramAccounts(prisma, liveMetaOps, {
    now,
    decrypt: decryptToken,
    encrypt: encryptToken,
  });

  return NextResponse.json({
    success: true,
    data: {
      totalProcessed: results.length,
      workspacesReset: usageReset.count,
      results,
    },
  });
}
