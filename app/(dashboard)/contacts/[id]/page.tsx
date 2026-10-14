"use client";

/**
 * One contact: linked identities, who owns follow up, Instagram DM permission and
 * opt-out, and the campaign activity. Read only; nothing here contacts the person.
 */

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import StatusBadge from "@/components/status-badge";
import { DM_PERMISSION_LABEL, FOLLOW_UP_LABEL, FOLLOW_UP_TONE, formatWhen } from "@/lib/contacts/labels";

interface Detail {
  id: string;
  displayName: string | null;
  status: string;
  optedOutAt: string | null;
  followUpState: string;
  humanTakeover: boolean;
  humanTakeoverAt: string | null;
  assignedToUserId: string | null;
  assignedAt: string | null;
  firstSeenAt: string;
  lastSeenAt: string;
  lastDmSentAt: string | null;
  consent: { status: string; updatedAt: string | null; source: string | null };
  identities: { id: string; platform: string; externalId: string; handle: string | null }[];
  consentHistory: { id: string; status: string; source: string; note: string | null; createdAt: string }[];
}

interface HistoryItem {
  id: string;
  campaign: { id: string; name: string };
  account: string;
  status: string;
  matchedKeyword: string | null;
  dmSentAt: string | null;
  errorMessage: string | null;
  createdAt: string;
  commentText?: string;
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded border border-border">
      <h2 className="border-b border-border px-4 py-2.5 text-sm font-semibold">{title}</h2>
      <div className="space-y-2 px-4 py-3 text-sm">{children}</div>
    </section>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5 sm:flex-row sm:justify-between sm:gap-4">
      <span className="text-muted">{label}</span>
      <span className="min-w-0 break-words sm:text-right">{children}</span>
    </div>
  );
}

export default function ContactDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const [contact, setContact] = useState<Detail | null>(null);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [owner, setOwner] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const loadHistory = useCallback(
    async (cursor: string | null) => {
      const qs = new URLSearchParams({ limit: "20" });
      if (cursor) qs.set("cursor", cursor);
      const json = await (await fetch(`/api/contacts/${id}/history?${qs}`, { cache: "no-store" })).json();
      if (!json.success) throw new Error(json.error || "Could not load history");
      return json.data as { items: HistoryItem[]; nextCursor: string | null };
    },
    [id]
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const json = await (await fetch(`/api/contacts/${id}`, { cache: "no-store" })).json();
        if (!json.success) throw new Error(json.error || "Could not load contact");
        const detail = json.data as Detail;
        const [hist, members] = await Promise.all([
          loadHistory(null),
          fetch("/api/workspace/members", { cache: "no-store" }).then((r) => r.json()).catch(() => null),
        ]);
        if (cancelled) return;
        setContact(detail);
        setHistory(hist.items);
        setNextCursor(hist.nextCursor);
        const list = (members?.data?.members ?? []) as { user: { id: string; name: string | null; email: string | null } }[];
        const match = list.find((m) => m.user.id === detail.assignedToUserId);
        setOwner(match ? match.user.name || match.user.email || "Teammate" : "");
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Could not load contact");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id, loadHistory]);

  async function more() {
    if (!nextCursor) return;
    try {
      const page = await loadHistory(nextCursor);
      setHistory((prev) => [...prev, ...page.items]);
      setNextCursor(page.nextCursor);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load more");
    }
  }

  if (loading) return <p className="py-10 text-center text-sm text-muted">Loading contact...</p>;
  if (!contact) {
    return (
      <div className="mx-auto max-w-3xl space-y-3">
        <p role="alert" className="rounded border border-error/40 px-3 py-2 text-sm text-error">
          {error || "Contact not found"}
        </p>
        <Link href="/contacts" className="text-sm text-accent">
          Back to contacts
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <Link href="/contacts" className="text-sm text-accent">
        Back to contacts
      </Link>
      <div>
        <h2 className="text-lg font-semibold">{contact.displayName || "Unnamed contact"}</h2>
        <p className={`text-sm ${FOLLOW_UP_TONE[contact.followUpState] ?? ""}`}>
          {FOLLOW_UP_LABEL[contact.followUpState] ?? contact.followUpState}
        </p>
      </div>

      {error && (
        <p role="alert" className="rounded border border-error/40 px-3 py-2 text-sm text-error">
          {error}
        </p>
      )}

      <Section title="Linked identities">
        {contact.identities.length === 0 ? (
          <p className="text-muted">None</p>
        ) : (
          contact.identities.map((i) => (
            <Row key={i.id} label={i.platform === "INSTAGRAM" ? "Instagram" : i.platform}>
              {i.handle ? `@${i.handle}` : "No handle"} <span className="text-muted">ID {i.externalId}</span>
            </Row>
          ))
        )}
        <p className="pt-1 text-xs text-muted">
          This person is recognized by their Instagram ID, not their name or handle, so a changed username does not
          create a second contact.
        </p>
      </Section>

      <Section title="Follow up">
        <Row label="Assigned to">{contact.assignedToUserId ? owner || "Teammate" : "Nobody yet"}</Row>
        <Row label="Assigned">{formatWhen(contact.assignedAt)}</Row>
        <Row label="Person handling the chat">
          {contact.humanTakeover ? `Yes, since ${formatWhen(contact.humanTakeoverAt)}` : "No"}
        </Row>
        <Row label="First seen">{formatWhen(contact.firstSeenAt)}</Row>
        <Row label="Last seen">{formatWhen(contact.lastSeenAt)}</Row>
        <Row label="Last DM sent">{formatWhen(contact.lastDmSentAt)}</Row>
      </Section>

      <Section title="Permission to message">
        <Row label="Instagram DM">
          {DM_PERMISSION_LABEL[contact.consent.status] ?? contact.consent.status}
          {contact.consent.source ? <span className="text-muted"> via {contact.consent.source}</span> : null}
        </Row>
        <Row label="Opted out of Instagram DMs">
          {contact.status === "OPTED_OUT" ? `Yes, ${formatWhen(contact.optedOutAt)}` : "No"}
        </Row>
        <Row label="SMS">Not tracked here</Row>
        <Row label="Phone calls">Not tracked here</Row>
        <p className="pt-1 text-xs text-muted">
          Permission to send an Instagram DM is separate from permission to text or call. Never treat one as the other.
        </p>
        {contact.consentHistory.length > 0 && (
          <ul className="space-y-1 border-t border-border pt-2">
            {contact.consentHistory.map((e) => (
              <li key={e.id} className="text-xs text-muted">
                {formatWhen(e.createdAt)}: {DM_PERMISSION_LABEL[e.status] ?? e.status} via {e.source}
                {e.note ? ` (${e.note})` : ""}
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="Campaign activity">
        {history.length === 0 ? (
          <p className="text-muted">No campaign activity yet.</p>
        ) : (
          <ul className="divide-y divide-border">
            {history.map((h) => (
              <li key={h.id} className="space-y-1 py-2">
                <div className="flex items-center justify-between gap-3">
                  <span className="min-w-0 truncate font-medium">{h.campaign.name}</span>
                  <StatusBadge status={h.status} />
                </div>
                {h.commentText && <p className="break-words text-muted">&ldquo;{h.commentText}&rdquo;</p>}
                <p className="text-xs text-muted">
                  @{h.account} · {formatWhen(h.createdAt)}
                  {h.matchedKeyword ? ` · keyword ${h.matchedKeyword}` : ""}
                </p>
                {h.errorMessage && <p className="break-words text-xs text-error">{h.errorMessage}</p>}
              </li>
            ))}
          </ul>
        )}
        {nextCursor && (
          <button type="button" onClick={more} className="rounded border border-border px-3 py-1.5 text-sm hover:bg-surface-hover">
            Load more
          </button>
        )}
      </Section>
    </div>
  );
}
