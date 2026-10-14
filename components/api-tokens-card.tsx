"use client";

import { useEffect, useState } from "react";

interface TokenRow {
  id: string;
  name: string;
  tokenPrefix: string;
  scopes: string[];
  expiresAt: string;
  lastUsedAt: string | null;
  state: "active" | "revoked" | "expired";
}

interface TokensData {
  tokens: TokenRow[];
  issuableScopes: { scope: string; description: string }[];
  maxLifetimeDays: number;
  features: { api: boolean; mcp: boolean };
}

export function ApiTokensCard() {
  const [data, setData] = useState<TokensData | null>(null);
  const [hidden, setHidden] = useState(false);
  const [name, setName] = useState("");
  const [scopes, setScopes] = useState<string[]>(["read"]);
  const [days, setDays] = useState(30);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [newSecret, setNewSecret] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  async function load() {
    const res = await fetch("/api/settings/api-tokens", { cache: "no-store" });
    if (res.status === 403 || res.status === 401) {
      setHidden(true);
      return;
    }
    const payload = await res.json();
    if (payload.success) setData(payload.data);
  }

  useEffect(() => {
    fetch("/api/settings/api-tokens", { cache: "no-store" })
      .then(async (res) => {
        if (res.status === 403 || res.status === 401) {
          setHidden(true);
          return;
        }
        const payload = await res.json();
        if (payload.success) setData(payload.data);
      })
      .catch(() => setHidden(true));
  }, []);

  async function createToken(event: React.FormEvent) {
    event.preventDefault();
    setBusy("create");
    setError(null);
    setNewSecret(null);
    setCopied(false);
    const res = await fetch("/api/settings/api-tokens", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, scopes, expiresInDays: days }),
    });
    const payload = await res.json();
    if (payload.success) {
      setNewSecret(payload.data.secret);
      setName("");
      await load();
    } else {
      setError(payload.error ?? "Could not create token");
    }
    setBusy(null);
  }

  async function revoke(id: string) {
    setBusy(`revoke:${id}`);
    await fetch(`/api/settings/api-tokens?id=${encodeURIComponent(id)}`, {
      method: "DELETE",
    });
    await load();
    setBusy(null);
  }

  function toggleScope(scope: string) {
    setScopes((current) =>
      current.includes(scope)
        ? current.filter((s) => s !== scope)
        : [...current, scope]
    );
  }

  if (hidden || !data) return null;

  const origin = typeof window !== "undefined" ? window.location.origin : "";

  return (
    <section className="panel rounded p-4 sm:p-6">
      <h2 className="text-base font-semibold mb-2">API and MCP access</h2>
      <p className="text-xs text-muted mb-6">
        Tokens let tools like Claude manage draft campaigns. Drafts are always
        inactive, and nothing here can send a message. REST API:{" "}
        {data.features.api ? "enabled" : "off"} · MCP: {data.features.mcp ? "enabled" : "off"}
      </p>

      {newSecret && (
        <div className="mb-6 rounded border border-warning/30 bg-warning/10 p-4">
          <p className="text-sm font-semibold text-foreground">
            Copy this token now. It will not be shown again.
          </p>
          <p className="mt-2 break-all rounded bg-surface px-3 py-2 font-mono text-xs text-foreground">
            {newSecret}
          </p>
          <div className="mt-3 flex items-center gap-3">
            <button
              type="button"
              onClick={() => {
                void navigator.clipboard?.writeText(newSecret);
                setCopied(true);
              }}
              className="rounded bg-accent px-3 py-1.5 text-xs font-semibold text-white hover:bg-accent-hover"
            >
              {copied ? "Copied" : "Copy token"}
            </button>
            <button
              type="button"
              onClick={() => setNewSecret(null)}
              className="text-xs text-muted hover:text-foreground"
            >
              I saved it
            </button>
          </div>
          <p className="mt-3 text-xs text-muted">
            MCP URL: {origin}/api/mcp · REST base: {origin}/api/v1
          </p>
        </div>
      )}

      <div className="space-y-3">
        {data.tokens.length === 0 && (
          <p className="text-sm text-muted">No tokens yet.</p>
        )}
        {data.tokens.map((token) => (
          <div
            key={token.id}
            className="flex flex-col gap-3 rounded border border-border bg-surface/70 p-3 sm:flex-row sm:items-center sm:justify-between"
          >
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-foreground">
                {token.name}{" "}
                <span className="font-mono text-xs text-muted">{token.tokenPrefix}...</span>
              </p>
              <p className="text-xs text-muted">
                {token.scopes.join(", ")} · {token.state} · expires{" "}
                {new Date(token.expiresAt).toLocaleDateString()} · last used{" "}
                {token.lastUsedAt ? new Date(token.lastUsedAt).toLocaleString() : "never"}
              </p>
            </div>
            {token.state === "active" && (
              <button
                type="button"
                onClick={() => revoke(token.id)}
                disabled={busy === `revoke:${token.id}`}
                className="rounded-lg border border-error/20 px-3 py-1.5 text-xs font-medium text-error transition-colors hover:bg-error/10 disabled:opacity-50"
              >
                Revoke
              </button>
            )}
          </div>
        ))}
      </div>

      <form onSubmit={createToken} className="mt-6 space-y-4 border-t border-border pt-4">
        <input
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="Token name, e.g. Claude Desktop"
          maxLength={60}
          required
          className="w-full rounded border border-border bg-surface px-4 py-2 text-sm text-foreground outline-none transition-colors focus:border-accent/40"
        />
        <div className="space-y-2">
          {data.issuableScopes.map((item) => (
            <label key={item.scope} className="flex items-start gap-2 text-sm text-foreground">
              <input
                type="checkbox"
                checked={scopes.includes(item.scope)}
                onChange={() => toggleScope(item.scope)}
                className="mt-1"
              />
              <span>
                <span className="font-mono text-xs">{item.scope}</span>
                <span className="block text-xs text-muted">{item.description}</span>
              </span>
            </label>
          ))}
        </div>
        <label className="flex items-center gap-2 text-sm text-foreground">
          Expires in
          <input
            type="number"
            min={1}
            max={data.maxLifetimeDays}
            value={days}
            onChange={(event) => setDays(Number(event.target.value))}
            className="w-20 rounded border border-border bg-surface px-2 py-1 text-sm"
          />
          days (max {data.maxLifetimeDays})
        </label>
        <button
          type="submit"
          disabled={busy === "create" || scopes.length === 0}
          className="rounded bg-accent px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-accent-hover disabled:opacity-50"
        >
          {busy === "create" ? "Creating..." : "Create token"}
        </button>
        {error && <p className="text-sm text-error">{error}</p>}
      </form>
    </section>
  );
}
