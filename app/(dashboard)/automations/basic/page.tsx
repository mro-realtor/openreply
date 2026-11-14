"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import AutomationTabs from "@/components/automation-tabs";
import { resolveBasicAccountsResponse, type BasicAutomationAccount } from "@/lib/basic-automations";

const basicItems = [
  {
    title: "Say hi to new followers",
    description: "Send a one-time welcome DM when someone follows your account.",
    state: "Unavailable",
    detail: "This follower event is not currently supported by OpenReply.",
  },
  {
    title: "Conversation Starters",
    description: "Show FAQ buttons when a new follower opens a conversation.",
    state: "Unavailable",
    detail: "Instagram conversation-starter buttons are not configured here yet.",
  },
  {
    title: "Story Mention Reply",
    description: "Reply when someone mentions your account in their Story.",
    state: "Unavailable",
    detail: "Story mention triggers are not currently supported.",
  },
  {
    title: "Default Reply",
    description: "Reply to incoming DMs that do not match another trigger.",
    state: "Partial",
    detail: "OpenReply supports keyword-triggered DM campaigns, but not an account-wide fallback reply.",
  },
  {
    title: "Main Menu",
    description: "Offer persistent shortcuts inside the Instagram DM inbox.",
    state: "Unavailable",
    detail: "A persistent Instagram Main Menu is not configured here yet.",
  },
] as const;

export default function BasicAutomationsPage() {
  const [accounts, setAccounts] = useState<BasicAutomationAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    let current = true;
    fetch("/api/dashboard/stats", { cache: "no-store" })
      .then(async (response) => ({
        ok: response.ok,
        payload: await response.json().catch(() => null),
      }))
      .then(({ ok, payload }) => {
        if (!current) return;
        const result = resolveBasicAccountsResponse(ok, payload);
        if (result.status === "error") setLoadError(true);
        else setAccounts(result.accounts);
      })
      .catch((error: unknown) => {
        console.error("Could not load connected accounts", error);
        if (current) setLoadError(true);
      })
      .finally(() => {
        if (current) setLoading(false);
      });
    return () => { current = false; };
  }, [reload]);

  return (
    <main className="space-y-5">
      <header>
        <h2 className="text-2xl font-semibold">Basic Automations</h2>
        <p className="mt-1 text-sm text-muted">Account-level replies and entry points.</p>
      </header>
      <AutomationTabs active="basic" />
      {loading ? (
        <p className="text-sm text-muted">Loading connected accounts…</p>
      ) : loadError ? (
        <section role="alert" className="panel rounded-lg p-8 text-center">
          <h3 className="text-lg font-semibold">Could not load connected accounts</h3>
          <p className="mx-auto mt-2 max-w-md text-sm text-muted">Your connection status could not be checked. Try again before changing account settings.</p>
          <button type="button" onClick={() => { setLoadError(false); setLoading(true); setReload((value) => value + 1); }}
            className="mt-5 rounded-md border border-border px-4 py-2.5 text-sm font-semibold hover:bg-surface-hover">Try again</button>
        </section>
      ) : accounts.length === 0 ? (
        <section className="panel rounded-lg p-8 text-center">
          <h3 className="text-lg font-semibold">Connect an Instagram account</h3>
          <p className="mx-auto mt-2 max-w-md text-sm text-muted">Basic automation settings are grouped by connected account. Connect an account to see its available setup options.</p>
          <Link href="/settings" className="mt-5 inline-flex rounded-md bg-accent px-4 py-2.5 text-sm font-semibold text-white hover:bg-accent-hover">Open Settings</Link>
        </section>
      ) : (
        <div className="space-y-5">
          {accounts.map((account) => (
            <section key={account.id} aria-labelledby={`account-${account.id}`} className="overflow-hidden rounded-lg border border-border bg-background">
              <header className="border-b border-border bg-surface px-5 py-4">
                <h3 id={`account-${account.id}`} className="font-semibold">@{account.username}</h3>
                <p className="mt-1 text-sm text-muted">{account.name || "Instagram account"} · Instagram</p>
              </header>
              <div className="divide-y divide-border">
                {basicItems.map((item) => (
                  <article key={item.title} className="flex flex-wrap items-start justify-between gap-4 px-5 py-4">
                    <div className="max-w-2xl">
                      <h4 className="font-medium">{item.title}</h4>
                      <p className="mt-1 text-sm text-muted">{item.description}</p>
                      <p className="mt-2 text-xs text-muted">{item.detail}</p>
                    </div>
                    <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-medium ${item.state === "Partial" ? "bg-amber-500/10 text-amber-700" : "bg-surface text-muted"}`}>
                      {item.state}
                    </span>
                  </article>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </main>
  );
}
