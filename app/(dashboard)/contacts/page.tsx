"use client";

/**
 * Contacts: a read-only view of the people who interacted with your Instagram
 * accounts. Viewing or searching never sends anything to anyone.
 */

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { DM_PERMISSION_LABEL, FOLLOW_UP_LABEL, FOLLOW_UP_TONE, formatWhen } from "@/lib/contacts/labels";

interface ContactItem {
  id: string;
  displayName: string | null;
  status: string;
  followUpState: string;
  assignedToUserId: string | null;
  lastSeenAt: string;
  consent: { status: string };
  identities: { id: string; platform: string; externalId: string; handle: string | null }[];
}

interface Member {
  userId: string;
  label: string;
}

const input =
  "w-full rounded border border-border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:border-accent";

export default function ContactsPage() {
  const [items, setItems] = useState<ContactItem[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [enabled, setEnabled] = useState(true);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState("");
  const [members, setMembers] = useState<Member[]>([]);
  const [q, setQ] = useState("");
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("");
  const [consent, setConsent] = useState("");
  const [assignedTo, setAssignedTo] = useState("");

  useEffect(() => {
    const t = setTimeout(() => setQuery(q.trim()), 300);
    return () => clearTimeout(t);
  }, [q]);

  useEffect(() => {
    fetch("/api/workspace/members", { cache: "no-store" })
      .then((r) => r.json())
      .then((json) => {
        if (!json.success) return;
        const list = (json.data.members ?? []) as { user: { id: string; name: string | null; email: string | null } }[];
        setMembers(list.map((m) => ({ userId: m.user.id, label: m.user.name || m.user.email || "Teammate" })));
      })
      .catch(() => {});
  }, []);

  const load = useCallback(
    async (cursor: string | null) => {
      const params = new URLSearchParams({ limit: "25" });
      if (query) params.set("q", query);
      if (status) params.set("status", status);
      if (consent) params.set("consent", consent);
      if (assignedTo) params.set("assignedTo", assignedTo);
      if (cursor) params.set("cursor", cursor);
      const res = await fetch(`/api/contacts?${params}`, { cache: "no-store" });
      const json = await res.json();
      if (!json.success) throw new Error(json.error || "Could not load contacts");
      return json.data as { items: ContactItem[]; nextCursor: string | null; contactsEnabled?: boolean };
    },
    [query, status, consent, assignedTo]
  );

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");
    load(null)
      .then((data) => {
        if (cancelled) return;
        setItems(data.items);
        setNextCursor(data.nextCursor);
        setEnabled(data.contactsEnabled !== false);
      })
      .catch((e: Error) => !cancelled && setError(e.message))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [load]);

  async function more() {
    if (!nextCursor) return;
    setLoadingMore(true);
    try {
      const data = await load(nextCursor);
      setItems((prev) => [...prev, ...data.items]);
      setNextCursor(data.nextCursor);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load more");
    } finally {
      setLoadingMore(false);
    }
  }

  const nameOf = (userId: string | null) =>
    userId ? (members.find((m) => m.userId === userId)?.label ?? "Teammate") : "Nobody yet";
  const filtered = Boolean(query || status || consent || assignedTo);

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <p className="text-sm text-muted">
        People who commented on your posts. This page only shows information. Looking at a contact never sends them a
        message.
      </p>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <label className="block sm:col-span-2 lg:col-span-1">
          <span className="mb-1 block text-xs text-muted">Search</span>
          <input
            className={input}
            placeholder="Name, handle or Instagram ID"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            aria-label="Search contacts"
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs text-muted">Status</span>
          <select className={input} value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">All</option>
            <option value="ACTIVE">Active</option>
            <option value="OPTED_OUT">Opted out</option>
          </select>
        </label>
        <label className="block">
          <span className="mb-1 block text-xs text-muted">Instagram DM permission</span>
          <select className={input} value={consent} onChange={(e) => setConsent(e.target.value)}>
            <option value="">All</option>
            <option value="UNKNOWN">Not recorded</option>
            <option value="GRANTED">Allowed</option>
            <option value="WITHDRAWN">Withdrawn</option>
          </select>
        </label>
        <label className="block">
          <span className="mb-1 block text-xs text-muted">Assigned to</span>
          <select className={input} value={assignedTo} onChange={(e) => setAssignedTo(e.target.value)}>
            <option value="">Anyone</option>
            <option value="unassigned">Nobody yet</option>
            {members.map((m) => (
              <option key={m.userId} value={m.userId}>
                {m.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      {error && (
        <p role="alert" className="rounded border border-error/40 px-3 py-2 text-sm text-error">
          {error}
        </p>
      )}

      {loading ? (
        <p className="py-10 text-center text-sm text-muted">Loading contacts...</p>
      ) : items.length === 0 ? (
        <div className="rounded border border-border px-4 py-10 text-center text-sm text-muted">
          {filtered
            ? "No contacts match these filters."
            : enabled
              ? "No contacts yet. People appear here after they comment on a post with an active campaign."
              : "Contact tracking is switched off for this installation, so no contacts are being saved."}
        </div>
      ) : (
        <ul className="divide-y divide-border rounded border border-border">
          {items.map((c) => {
            const handles = c.identities.map((i) => (i.handle ? `@${i.handle}` : i.externalId));
            return (
              <li key={c.id}>
                <Link
                  href={`/contacts/${c.id}`}
                  className="flex flex-col gap-1 px-4 py-3 hover:bg-surface-hover sm:flex-row sm:items-center sm:justify-between"
                >
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium">{c.displayName || handles[0] || "Unknown"}</span>
                    <span className="block truncate text-xs text-muted">
                      {handles.length ? `Instagram ${handles.join(", ")}` : "No linked identity"}
                    </span>
                  </span>
                  <span className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
                    <span className={FOLLOW_UP_TONE[c.followUpState] ?? ""}>
                      {FOLLOW_UP_LABEL[c.followUpState] ?? c.followUpState}
                    </span>
                    <span className="text-muted">DM: {DM_PERMISSION_LABEL[c.consent.status] ?? c.consent.status}</span>
                    <span className="text-muted">Owner: {nameOf(c.assignedToUserId)}</span>
                    <span className="text-muted">Seen {formatWhen(c.lastSeenAt)}</span>
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}

      {nextCursor && !loading && (
        <div className="text-center">
          <button
            type="button"
            onClick={more}
            disabled={loadingMore}
            className="rounded border border-border px-4 py-2 text-sm hover:bg-surface-hover disabled:opacity-60"
          >
            {loadingMore ? "Loading..." : "Load more"}
          </button>
        </div>
      )}
    </div>
  );
}
