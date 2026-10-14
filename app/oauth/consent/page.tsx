import { SCOPE_DEFINITIONS, type Scope } from "@/lib/api/scopes";
import { prisma } from "@/lib/db/client";
import { isOAuthEnabled } from "@/lib/oauth/config";
import { loadPendingRequest } from "@/lib/oauth/service";
import { canManageBilling, getCurrentWorkspaceContext } from "@/lib/workspace-access";
import { notFound, redirect } from "next/navigation";

export const dynamic = "force-dynamic";
export const metadata = { title: "Connect an app - OpenReply" };

export default async function ConsentPage({
  searchParams,
}: {
  searchParams: Promise<{ request?: string; error?: string }>;
}) {
  if (!isOAuthEnabled()) notFound();
  const params = await searchParams;
  const context = await getCurrentWorkspaceContext();
  if (!context) redirect("/login");

  const pending = params.request ? await loadPendingRequest(prisma, params.request, context.userId) : null;
  const isOwner = canManageBilling(context.role);

  let redirectHost = "";
  if (pending) {
    try {
      redirectHost = new URL(pending.redirectUri).host;
    } catch {
      redirectHost = "";
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-6">
      <div className="w-full max-w-md">
        <h1 className="text-2xl font-semibold text-foreground text-center mb-6">OpenReply</h1>
        <div className="panel rounded p-8 shadow-black/40 space-y-5">
          {params.error && (
            <p className="text-sm text-error" role="alert">
              {params.error}
            </p>
          )}
          {!pending ? (
            <p className="text-sm text-muted">
              This connection request has expired or was already handled. Start again from the app you
              were connecting.
            </p>
          ) : !isOwner ? (
            <p className="text-sm text-muted">
              Only the workspace owner can connect apps. Ask the owner to approve this request.
            </p>
          ) : (
            <form method="post" action="/api/oauth/consent" className="space-y-5">
              <input type="hidden" name="request" value={params.request} />
              <div>
                <p className="text-sm text-muted">An app wants to connect to your workspace</p>
                <p className="text-lg font-medium text-foreground mt-1">{pending.client.name}</p>
                <p className="text-xs text-muted mt-1">
                  It will return you to <span className="font-mono">{redirectHost}</span>. Only continue if
                  you started this connection.
                </p>
              </div>
              <fieldset className="space-y-2">
                <legend className="text-sm font-medium text-foreground mb-1">It will be able to</legend>
                {pending.scopes.map((scope) => (
                  <label key={scope} className="flex items-start gap-2 text-sm">
                    <input
                      type="checkbox"
                      name="scope"
                      value={scope}
                      defaultChecked
                      className="mt-1"
                    />
                    <span>
                      {SCOPE_DEFINITIONS[scope as Scope]?.description ?? scope}
                      <span className="text-muted font-mono text-xs"> ({scope})</span>
                    </span>
                  </label>
                ))}
              </fieldset>
              <p className="text-xs text-muted">
                It cannot send messages, activate campaigns, delete anything, or see your Instagram
                credentials. You can disconnect it any time in Settings.
              </p>
              <div className="flex gap-3">
                <button type="submit" name="decision" value="approve" className="inline-flex items-center justify-center rounded bg-accent px-6 py-2.5 text-sm font-semibold text-white">
                  Allow
                </button>
                <button type="submit" name="decision" value="deny" className="inline-flex items-center justify-center rounded border border-white/10 px-6 py-2.5 text-sm font-medium">
                  Cancel
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
