"use client";

import { useEffect, useState } from "react";

interface GrantRow {
  id: string;
  name: string;
  scopes: string[];
  createdAt: string;
  lastUsedAt: string | null;
}

export function ConnectedAppsCard() {
  const [grants, setGrants] = useState<GrantRow[] | null>(null);
  const [hidden, setHidden] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function apply(res: Response) {
    if (res.status === 401 || res.status === 403) {
      setHidden(true);
      return Promise.resolve();
    }
    return res.json().then((payload) => {
      if (!payload.success || !payload.data.enabled) setHidden(true);
      else setGrants(payload.data.grants);
    });
  }

  function reload() {
    return fetch("/api/settings/oauth-grants", { cache: "no-store" }).then(apply);
  }

  useEffect(() => {
    fetch("/api/settings/oauth-grants", { cache: "no-store" })
      .then(apply)
      .catch(() => setHidden(true));
    // apply only uses state setters, which are stable
  }, []);

  async function disconnect(id: string) {
    setBusy(id);
    setError(null);
    const res = await fetch(`/api/settings/oauth-grants?id=${encodeURIComponent(id)}`, {
      method: "DELETE",
    });
    setBusy(null);
    if (!res.ok) {
      setError("Could not disconnect that app. Try again.");
      return;
    }
    await reload();
  }

  if (hidden || !grants) return null;

  return (
    <section className="panel rounded p-4 sm:p-6">
      <h2 className="text-lg font-semibold text-foreground">Connected apps</h2>
      <p className="text-sm text-muted mt-1">
        AI apps you approved by signing in (for example ChatGPT). Disconnecting ends their access at once.
      </p>
      {error && (
        <p className="text-sm text-error mt-3" role="alert">
          {error}
        </p>
      )}
      {grants.length === 0 ? (
        <p className="text-sm text-muted mt-4">No apps connected.</p>
      ) : (
        <ul className="mt-4 divide-y divide-white/5">
          {grants.map((grant) => (
            <li key={grant.id} className="flex items-center justify-between gap-4 py-3">
              <div className="min-w-0">
                <p className="text-sm font-medium text-foreground truncate">{grant.name}</p>
                <p className="text-xs text-muted">
                  {grant.scopes.join(", ")} · connected {new Date(grant.createdAt).toLocaleDateString()}
                  {grant.lastUsedAt
                    ? ` · last used ${new Date(grant.lastUsedAt).toLocaleDateString()}`
                    : " · not used yet"}
                </p>
              </div>
              <button
                type="button"
                onClick={() => disconnect(grant.id)}
                disabled={busy === grant.id}
                className="rounded-lg border border-error/20 px-3 py-1.5 text-xs font-medium text-error transition-colors hover:bg-error/10 disabled:opacity-50"
              >
                Disconnect
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
