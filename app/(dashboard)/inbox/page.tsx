"use client";

/**
 * Inbox
 *
 * Instagram DM conversations for the selected account, with live message
 * history and a reply composer. Messages are read from the Conversations API
 * (Meta only exposes the 20 most recent per thread) and refreshed by polling.
 * Sending is subject to Instagram's 24-hour messaging window — Meta's error is
 * surfaced verbatim when it applies.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import AccountSelect, { type AccountOption } from "@/components/account-select";
import { readCache, writeCache } from "@/lib/client-cache";
import type { ConversationListItem } from "@/app/api/instagram/conversations/route";
import type { ThreadMessage } from "@/app/api/instagram/conversations/[id]/route";

const POLL_MS = 12_000;
// Cached list/threads are shown instantly on revisit, then revalidated in the
// background. The Instagram Conversations API is slow (often several seconds),
// so this is what makes the inbox feel fast after the first load.
const CACHE_MAX_AGE_MS = 60_000;
const convCacheKey = (accountId: string) => `inbox:convs:${accountId}`;
const msgCacheKey = (conversationId: string) => `inbox:msgs:${conversationId}`;

function formatTime(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  return sameDay
    ? d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })
    : d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

type FacebookThread = { id: string; pageId: string; pageName: string; recipientId: string; events: {
  eventId: string; receivedAt: string; text: string | null; kind: string;
}[] };

type ThreadState = {
  threadKey: string; closed: boolean; favorite: boolean; assigneeId: string | null;
  readThrough: string | null; notes: { id: string; body: string; createdAt: string }[];
};

export default function InboxPage() {
  const [inboxState, setInboxState] = useState<Record<string, ThreadState>>({});
  const [viewer, setViewer] = useState("");
  const [folder, setFolder] = useState("All chats");
  const [statusFilter, setStatusFilter] = useState("open");
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [showContact, setShowContact] = useState(false);
  const [note, setNote] = useState("");
  const [workflowError, setWorkflowError] = useState("");
  const [mutating, setMutating] = useState(false);

  useEffect(() => {
    let disposed = false;
    async function loadState() {
      try {
        const response = await fetch("/api/inbox/state", { cache: "no-store" });
        if (!response.ok) throw new Error();
        const data = await response.json() as { threads: ThreadState[]; userId: string };
        if (!disposed) {
          setInboxState(Object.fromEntries(data.threads.map((thread) => [thread.threadKey, thread])));
          setViewer(data.userId);
        }
      } catch {
        if (!disposed) setWorkflowError("Inbox settings could not be loaded.");
      }
    }
    void loadState();
    return () => { disposed = true; };
  }, []);

  const [channel, setChannel] = useState("all");
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState("newest");
  const [facebook, setFacebook] = useState<FacebookThread[]>([]);
  const [facebookError, setFacebookError] = useState("");
  const [facebookEditable, setFacebookEditable] = useState(false);
  const [facebookId, setFacebookId] = useState<string>();
  const facebookActive = facebook.find((thread) => thread.id === facebookId);

  useEffect(() => {
    let active = true;
    async function loadFacebook() {
      try {
        const response = await fetch("/api/messenger", { cache: "no-store" });
        if (!response.ok) throw new Error("Unable to load Facebook conversations.");
        const data = await response.json() as { editable: boolean; pages: {
          id: string; name: string; events: (FacebookThread["events"][number] & { recipientId: string })[];
        }[] };
        const threads = new Map<string, FacebookThread>();
        for (const page of data.pages) {
          for (const event of page.events) {
            const id = `${page.id}:${event.recipientId}`;
            const thread = threads.get(id) ?? {
              id, pageId: page.id, pageName: page.name, recipientId: event.recipientId, events: [],
            };
            thread.events.push(event);
            threads.set(id, thread);
          }
        }
        if (active) {
          setFacebook([...threads.values()]);
          setFacebookEditable(data.editable);
          setFacebookError("");
        }
      } catch {
        if (active) setFacebookError("Unable to load Facebook conversations.");
      }
    }
    void loadFacebook();
    const timer = setInterval(loadFacebook, POLL_MS);
    return () => { active = false; clearInterval(timer); };
  }, []);
  const [enrollmentChoices, setEnrollmentChoices] = useState<{ id: string; name: string }[] | null>(null);
  const [enrollmentNotice, setEnrollmentNotice] = useState("");
  const [enrolling, setEnrolling] = useState(false);
  const [accounts, setAccounts] = useState<AccountOption[]>([]);
  // Seed from the last-used account so a revisit can paint the cached
  // conversation list immediately, before the account list even loads.
  const [selectedAccountId, setSelectedAccountId] = useState(() => {
    if (typeof window === "undefined") return "";
    return window.sessionStorage.getItem("inbox:selectedAccount") ?? "";
  });

  const [conversations, setConversations] = useState<ConversationListItem[]>([]);
  const [convLoading, setConvLoading] = useState(true);
  const [convError, setConvError] = useState<string | null>(null);

  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ThreadMessage[]>([]);
  const [threadLoading, setThreadLoading] = useState(false);

  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);

  const scrollRef = useRef<HTMLDivElement>(null);

  const active = conversations.find((c) => c.id === activeId) ?? null;

  // Accounts for the selector; default to the first connected account. Uses the
  // lightweight accounts endpoint (one query) rather than the heavy dashboard
  // stats aggregation, so the inbox isn't gated on analytics before it can load.
  useEffect(() => {
    fetch("/api/instagram/accounts")
      .then((r) => r.json())
      .then((payload) => {
        if (!payload.success) return;
        const next: AccountOption[] = payload.data.instagramAccounts ?? [];
        setAccounts(next);
        setSelectedAccountId((prev) => {
          // Keep the seeded account only if it's still connected; otherwise
          // fall back to the default so a removed account can't wedge the inbox.
          const stillValid = prev && next.some((a) => a.id === prev);
          return stillValid
            ? prev
            : payload.data.selectedInstagramAccountId || next[0]?.id || "";
        });
      })
      .catch(() => setAccounts([]));
  }, []);

  // Remember the chosen account for the next visit.
  useEffect(() => {
    if (typeof window === "undefined" || !selectedAccountId) return;
    window.sessionStorage.setItem("inbox:selectedAccount", selectedAccountId);
  }, [selectedAccountId]);

  const loadConversations = useCallback(
    async (silent: boolean) => {
      if (!selectedAccountId) return;
      if (!silent) setConvLoading(true);
      try {
        const res = await fetch(
          `/api/instagram/conversations?instagramAccountId=${selectedAccountId}`,
          { cache: "no-store" }
        );
        const data = await res.json();
        if (data.success) {
          setConversations(data.data.conversations);
          writeCache(convCacheKey(selectedAccountId), data.data.conversations);
          setConvError(null);
        } else if (!silent) {
          setConvError(data.error ?? "Failed to load conversations");
        }
      } catch {
        if (!silent) setConvError("Failed to load conversations");
      } finally {
        if (!silent) setConvLoading(false);
      }
    },
    [selectedAccountId]
  );

  // Load + poll conversations for the selected account. A cached list is shown
  // immediately (so revisits are instant) while a fresh copy loads silently.
  useEffect(() => {
    if (!selectedAccountId) return;
    // Reset the open thread when switching accounts. This is an intentional
    // synchronous reset on a dependency change, not derived render state.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setActiveId(null);
    setMessages([]);
    const cached = readCache<ConversationListItem[]>(
      convCacheKey(selectedAccountId),
      CACHE_MAX_AGE_MS
    );
    if (cached.data) {
      setConversations(cached.data);
      setConvLoading(false);
    } else {
      setConversations([]);
      setConvLoading(true);
    }
    void loadConversations(Boolean(cached.data));
    const timer = window.setInterval(() => void loadConversations(true), POLL_MS);
    return () => window.clearInterval(timer);
  }, [selectedAccountId, loadConversations]);

  const loadMessages = useCallback(
    async (conversationId: string, silent: boolean) => {
      if (!selectedAccountId) return;
      if (!silent) setThreadLoading(true);
      try {
        const res = await fetch(
          `/api/instagram/conversations/${conversationId}?instagramAccountId=${selectedAccountId}`,
          { cache: "no-store" }
        );
        const data = await res.json();
        if (data.success) {
          setMessages(data.data.messages);
          writeCache(msgCacheKey(conversationId), data.data.messages);
        }
      } catch {
        // keep whatever is shown
      } finally {
        if (!silent) setThreadLoading(false);
      }
    },
    [selectedAccountId]
  );

  // Load + poll the open thread. Cached messages render instantly while a fresh
  // copy loads silently; opening a thread never shows a blank pane on revisit.
  useEffect(() => {
    if (!activeId) return;
    const cached = readCache<ThreadMessage[]>(
      msgCacheKey(activeId),
      CACHE_MAX_AGE_MS
    );
    if (cached.data) {
      // Paint cached messages instantly on thread change; intentional reset.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setMessages(cached.data);
      setThreadLoading(false);
    } else {
      setMessages([]);
      setThreadLoading(true);
    }
    void loadMessages(activeId, Boolean(cached.data));
    const timer = window.setInterval(
      () => void loadMessages(activeId, true),
      POLL_MS
    );
    return () => window.clearInterval(timer);
  }, [activeId, loadMessages]);

  // Keep the thread pinned to the latest message.
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages]);

  function openConversation(id: string) {
    setFacebookId(undefined);
    setActiveId(id);
    setEnrollmentChoices(null);
    setEnrollmentNotice("");
    setSendError(null);
    // Paint any cached thread synchronously so the pane never flashes empty
    // or shows the previously open conversation while the fetch runs.
    const cached = readCache<ThreadMessage[]>(msgCacheKey(id), CACHE_MAX_AGE_MS);
    setMessages(cached.data ?? []);
    setThreadLoading(!cached.data);
  }

  async function openSequencePicker() {
    setEnrollmentNotice("");
    try {
      const response = await fetch("/api/sequences");
      const data = await response.json();
      if (!response.ok || !data.editable) throw new Error("Workspace administrator required");
      setEnrollmentChoices(data.sequences.filter((sequence: { enabled: boolean }) => sequence.enabled));
    } catch (error) {
      setEnrollmentNotice(error instanceof Error ? error.message : "Could not load sequences");
    }
  }

  async function subscribeToSequence(sequenceId: string) {
    if (!active?.contact.id || enrolling) return;
    setEnrolling(true);
    try {
      const response = await fetch("/api/sequences/enrollment", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sequenceId, accountId: selectedAccountId, conversationId: active.id, recipientId: active.contact.id }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      setEnrollmentChoices(null);
      setEnrollmentNotice("Contact subscribed.");
    } catch (error) {
      setEnrollmentNotice(error instanceof Error ? error.message : "Could not subscribe");
    } finally {
      setEnrolling(false);
    }
  }

  async function handleSend() {
    const text = draft.trim();
    if (!text || !active?.contact.id || sending) return;
    setSending(true);
    setSendError(null);

    // Optimistically show the reply immediately, then confirm with the server.
    const optimistic: ThreadMessage = {
      id: `optimistic-${Date.now()}`,
      text,
      fromMe: true,
      fromUsername: null,
      createdTime: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, optimistic]);
    setDraft("");

    try {
      const res = await fetch("/api/instagram/conversations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          instagramAccountId: selectedAccountId,
          recipientId: active.contact.id,
          text,
        }),
      });
      const data = await res.json();
      if (data.success) {
        await loadMessages(active.id, true);
        void loadConversations(true);
      } else {
        // Roll the optimistic message back and restore the draft so it's not lost.
        setMessages((prev) => prev.filter((m) => m.id !== optimistic.id));
        setDraft(text);
        setSendError(data.error ?? "Failed to send message");
      }
    } catch {
      setMessages((prev) => prev.filter((m) => m.id !== optimistic.id));
      setDraft(text);
      setSendError("Failed to send message");
    } finally {
      setSending(false);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void handleSend();
    }
  }

  const selectedKey = facebookActive ? `fb:${facebookActive.id}` : active ? `ig:${selectedAccountId}:${active.id}` : "";
  const currentState = inboxState[selectedKey];
  const currentDate = facebookActive?.events[0]?.receivedAt ?? active?.updatedTime ?? null;

  function isUnread(key: string, date: string | null) {
    return Boolean(date && Date.parse(date) > (Date.parse(inboxState[key]?.readThrough ?? "") || 0));
  }

  async function updateThread(threadKey: string, fields: Record<string, unknown>) {
    setWorkflowError("");
    setMutating(true);
    try {
      const response = await fetch("/api/inbox/state", {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ threadKey, ...fields }),
      });
      if (!response.ok) throw new Error();
      const saved: ThreadState = await response.json();
      setInboxState((current) => ({ ...current, [threadKey]: saved }));
      return true;
    } catch {
      setWorkflowError("The conversation change could not be saved.");
      return false;
    } finally { setMutating(false); }
  }

  const actionClass = "rounded border border-border px-2 py-1 text-xs font-medium disabled:opacity-50";
  const threadActions = selectedKey && (
    <div className="ml-auto flex flex-wrap gap-2">
      <button className={actionClass} disabled={mutating} onClick={() => void updateThread(selectedKey, { closed: !currentState?.closed })}>
        {currentState?.closed ? "Mark as Open" : "Mark as Closed"}
      </button>
      <button className={actionClass} disabled={mutating} aria-label={currentState?.favorite ? "Remove from favorites" : "Add to favorites"}
        onClick={() => void updateThread(selectedKey, { favorite: !currentState?.favorite })}>{currentState?.favorite ? "♥" : "♡"}</button>
      <button className={actionClass} disabled={mutating || !currentDate} onClick={() =>
        void updateThread(selectedKey, { readThrough: isUnread(selectedKey, currentDate) ? currentDate : null })}>
        {isUnread(selectedKey, currentDate) ? "Mark as read" : "Mark as unread"}
      </button>
      <button className={actionClass} onClick={() => setShowContact(!showContact)} aria-expanded={showContact}>Contact details</button>
    </div>
  );

  const threads = [
    ...(channel !== "facebook" ? conversations.map((conversation) => ({
      id: conversation.id, key: `ig:${selectedAccountId}:${conversation.id}`, channel: "Instagram", name: `@${conversation.contact.username ?? "unknown"}`,
      text: conversation.lastMessage?.text, date: conversation.updatedTime,
    })) : []),
    ...(channel !== "instagram" ? facebook.map((thread) => ({
      id: thread.id, key: `fb:${thread.id}`, channel: "Facebook", name: `${thread.pageName} · ${thread.recipientId}`,
      text: thread.events[0]?.text, date: thread.events[0]?.receivedAt ?? null,
    })) : []),
  ].filter((thread) => {
    const state = inboxState[thread.key];
    if (statusFilter !== "all" && Boolean(state?.closed) !== (statusFilter === "closed")) return false;
    if (unreadOnly && !isUnread(thread.key, thread.date)) return false;
    if (folder === "Unassigned" && state?.assigneeId) return false;
    if (folder === "Assigned to me" && (!viewer || state?.assigneeId !== viewer)) return false;
    if (folder === "Favorites" && !state?.favorite) return false;
    return true;
  }).filter((thread) => `${thread.name} ${thread.text ?? ""}`.toLowerCase().includes(search.trim().toLowerCase()))
    .sort((left, right) => (sort === "newest" ? 1 : -1) * ((right.date ?? "").localeCompare(left.date ?? "")));

  async function sendFacebookReply() {
    if (!facebookActive || !draft.trim() || sending) return;
    setSending(true);
    setSendError(null);
    try {
      const response = await fetch("/api/messenger", {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pageId: facebookActive.pageId, recipientId: facebookActive.recipientId, text: draft.trim() }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      setDraft("");
    } catch (error) {
      setSendError(error instanceof Error ? error.message : "Reply failed");
    } finally { setSending(false); }
  }

  return (
    <div className="space-y-3">
      {workflowError && <p role="alert" className="text-sm text-error">{workflowError}</p>}
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold text-foreground">Inbox</h1>
        <input type="search" aria-label="Search through Inbox conversations" placeholder="Search through Inbox conversations"
          className="w-full max-w-sm rounded border border-border bg-surface px-3 py-2 text-sm"
          value={search} onChange={(event) => setSearch(event.target.value)} />
        <Link className="rounded border border-border px-3 py-2 text-sm" href="/messenger">Add Channel</Link>
      </header>
      <div className="flex flex-wrap items-center gap-2 rounded border border-border bg-surface p-2 text-sm">
        <select aria-label="Chat status" className="rounded border border-border bg-surface p-2" value={statusFilter}
          onChange={(event) => setStatusFilter(event.target.value)}>
          <option value="open">Open chats</option><option value="closed">Closed chats</option><option value="all">All statuses</option>
        </select>
        <button className="rounded border border-border px-3 py-2 aria-pressed:bg-blue-600 aria-pressed:text-white"
          aria-pressed={unreadOnly} onClick={() => setUnreadOnly(!unreadOnly)}>Unread</button>
        <select aria-label="Channel" className="rounded border border-border bg-surface p-2" value={channel}
          onChange={(event) => { setChannel(event.target.value); setActiveId(null); setFacebookId(undefined); setDraft(""); }}>
          <option value="all">All channels</option><option value="instagram">Instagram</option><option value="facebook">Facebook</option>
        </select>
        <select aria-label="Sort conversations" className="rounded border border-border bg-surface p-2" value={sort}
          onChange={(event) => setSort(event.target.value)}>
          <option value="newest">Sort: Newest</option><option value="oldest">Sort: Oldest</option>
        </select>
        {channel !== "facebook" && accounts.length > 1 && (
          <AccountSelect accounts={accounts} value={selectedAccountId} onChange={setSelectedAccountId} includeAll={false} />
        )}
      </div>
      <div className="grid h-[calc(100dvh-13rem)] grid-cols-1 overflow-hidden rounded border border-border sm:grid-cols-[275px_minmax(0,1fr)] lg:grid-cols-[175px_290px_minmax(0,1fr)]">
        <nav aria-label="Inbox folders" className={`flex gap-1 overflow-x-auto border-b border-border bg-surface p-2 sm:col-span-2 lg:col-span-1 lg:flex-col lg:border-b-0 lg:border-r ${selectedKey ? "hidden sm:flex" : ""}`}>
          {["All chats", "Unassigned", "Assigned to me", "Favorites"].map((name) => (
            <button key={name} aria-pressed={folder === name} onClick={() => setFolder(name)}
              className="rounded px-3 py-2 text-left text-sm whitespace-nowrap hover:bg-surface-hover aria-pressed:bg-surface-hover aria-pressed:font-semibold">{name}</button>
          ))}
        </nav>
        <div className={`min-h-0 flex-col border-border sm:flex sm:border-r ${active || facebookActive ? "hidden" : "flex"}`}>
          <div className="border-b border-border px-4 py-3 text-sm font-semibold">{folder}</div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            {channel !== "facebook" && convLoading && accounts.length > 0 && <p className="p-4 text-sm text-muted">Loading Instagram…</p>}
            {channel !== "facebook" && convError && <p className="p-4 text-sm text-error">{convError}</p>}
            {channel !== "instagram" && facebookError && <p className="p-4 text-sm text-error">{facebookError}</p>}
            {!threads.length && <p className="p-4 text-sm text-muted">No conversations found.</p>}
            {threads.map((thread) => (
              <button key={`${thread.channel}:${thread.id}`} type="button"
                className={`block w-full border-b border-border px-4 py-3 text-left hover:bg-surface-hover ${thread.id === (activeId ?? facebookId) ? "bg-surface-hover" : ""}`}
                onClick={() => {
                  setDraft("");
                  setNote("");
                  if (thread.date && isUnread(thread.key, thread.date) && !mutating) void updateThread(thread.key, { readThrough: thread.date });
                  if (thread.channel === "Instagram") openConversation(thread.id);
                  else { setActiveId(null); setFacebookId(thread.id); setSendError(null); }
                }}>
                <span className="flex justify-between gap-2 text-sm font-medium">
                  <span className="truncate">{isUnread(thread.key, thread.date) && <span aria-label="Unread" className="mr-1 text-blue-600">●</span>}{thread.name}</span>
                  <span className="shrink-0 text-xs text-muted">{formatTime(thread.date)}</span>
                </span>
                <span className="block truncate text-xs text-muted">{thread.channel} · {thread.text || "No text"}</span>
              </button>
            ))}
          </div>
        </div>

        <div className={`min-h-0 min-w-0 ${showContact && selectedKey ? "grid grid-rows-[minmax(0,1fr)_auto] xl:grid-cols-[minmax(0,1fr)_240px] xl:grid-rows-1" : "grid"}`}>
        {facebookActive ? (
          <section className="flex min-h-0 flex-col">
            <header className="flex items-center gap-2 border-b border-border p-4 text-sm font-semibold">
              <button type="button" onClick={() => setFacebookId(undefined)} className="sm:hidden">Back</button>
              <span>Facebook · {facebookActive.pageName}</span>
              {threadActions}
            </header>
            <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
              {[...facebookActive.events].reverse().map((event) => (
                <div key={event.eventId} className={`max-w-[75%] rounded-lg border border-border p-3 text-sm ${event.kind === "OUTBOUND" ? "ml-auto bg-blue-600 text-white" : "bg-surface"}`}>
                  <p className="whitespace-pre-wrap break-words">{event.text ?? "Attachment"}</p>
                  <p className="mt-1 text-xs opacity-70">{formatTime(event.receivedAt)}</p>
                </div>
              ))}
            </div>
            {facebookEditable && (
              <form className="space-y-2 border-t border-border p-3" onSubmit={(event) => { event.preventDefault(); void sendFacebookReply(); }}>
                {sendError && <p role="alert" className="text-sm text-error">{sendError}</p>}
                <div className="flex gap-2">
                  <textarea aria-label="Facebook reply" placeholder="Write a reply…" className="flex-1 rounded border border-border bg-surface p-2"
                    rows={1} maxLength={2000} value={draft} onChange={(event) => setDraft(event.target.value)} />
                  <button className="rounded bg-blue-600 px-4 py-2 text-sm text-white disabled:opacity-50" disabled={sending || !draft.trim()}>Send</button>
                </div>
              </form>
            )}
          </section>
        ) : (
        <div
          className={`min-h-0 flex-col ${active ? "flex" : "hidden sm:flex"}`}
        >
          {!active ? (
            <div className="flex flex-1 items-center justify-center p-6 text-sm text-muted">
              Select a conversation to read and reply.
            </div>
          ) : (
            <>
              <div className="flex shrink-0 items-center gap-2 border-b border-border px-4 py-3 text-sm font-semibold text-foreground">
                <button
                  type="button"
                  onClick={() => setActiveId(null)}
                  className="-ml-1 rounded px-2 py-1 text-muted hover:text-foreground sm:hidden"
                  aria-label="Back to conversations"
                >
                  Back
                </button>
                <span className="truncate">
                  @{active.contact.username ?? "unknown"}
                </span>
                {threadActions}
                <button type="button" className="ml-auto rounded border border-border px-2 py-1 text-xs"
                  onClick={() => enrollmentChoices ? setEnrollmentChoices(null) : void openSequencePicker()}>
                  Subscribe to Sequence
                </button>
              </div>

              {enrollmentChoices && (
                <div className="border-b border-border p-3">
                  <label className="flex items-center gap-2 text-sm">
                    Choose a sequence
                    <select className="rounded border border-border bg-surface p-1" value="" disabled={enrolling}
                      onChange={(event) => { if (event.target.value) void subscribeToSequence(event.target.value); }}>
                      <option value="">{enrollmentChoices.length ? "Select to subscribe" : "No active sequences"}</option>
                      {enrollmentChoices.map((sequence) => <option key={sequence.id} value={sequence.id}>{sequence.name}</option>)}
                    </select>
                  </label>
                </div>
              )}
              {enrollmentNotice && <p role="status" className="px-3 py-2 text-sm">{enrollmentNotice}</p>}

              <div ref={scrollRef} className="min-h-0 flex-1 space-y-2 overflow-y-auto p-4">
                {threadLoading && messages.length === 0 ? (
                  <p className="text-sm text-muted">Loading…</p>
                ) : messages.length === 0 ? (
                  <p className="text-sm text-muted">No messages.</p>
                ) : (
                  messages.map((m) => (
                    <div
                      key={m.id}
                      className={`flex ${m.fromMe ? "justify-end" : "justify-start"}`}
                    >
                      <div
                        className={`max-w-[75%] rounded-lg px-3 py-2 text-sm ${
                          m.fromMe
                            ? "bg-accent text-white"
                            : "bg-surface text-foreground border border-border"
                        }`}
                      >
                        <p className="whitespace-pre-wrap break-words">{m.text}</p>
                        <p
                          className={`mt-1 text-[10px] ${
                            m.fromMe ? "text-white/70" : "text-zinc-500"
                          }`}
                        >
                          {formatTime(m.createdTime)}
                        </p>
                      </div>
                    </div>
                  ))
                )}
              </div>

              <div className="shrink-0 border-t border-border p-3">
                {sendError && (
                  <p className="mb-2 text-xs text-error">{sendError}</p>
                )}
                <div className="flex items-end gap-2">
                  <textarea
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    onKeyDown={handleKeyDown}
                    rows={1}
                    placeholder="Write a reply…  (Enter to send, Shift+Enter for a new line)"
                    className="max-h-32 min-h-[40px] flex-1 resize-none rounded-lg border border-border bg-surface px-3 py-2 text-sm text-foreground placeholder:text-zinc-500 focus:border-accent/40 focus:outline-none"
                  />
                  <button
                    type="button"
                    onClick={() => void handleSend()}
                    disabled={sending || !draft.trim()}
                    className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-hover disabled:opacity-50"
                  >
                    {sending ? "Sending…" : "Send"}
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
        )}
        {showContact && selectedKey && (
          <aside className="max-h-60 space-y-3 overflow-y-auto border-t border-border bg-surface p-3 text-sm xl:max-h-none xl:border-t-0 xl:border-l">
            <h2 className="font-semibold">Contact details</h2>
            <p className="break-words">{facebookActive ? facebookActive.pageName : `@${active?.contact.username ?? "unknown"}`}</p>
            <p>{!currentState?.assigneeId ? "Unassigned" : currentState.assigneeId === viewer ? "Assigned to you" : "Assigned to a teammate"}</p>
            <button className={actionClass} disabled={mutating || !viewer} onClick={() =>
              void updateThread(selectedKey, { assignToMe: currentState?.assigneeId !== viewer })}>
              {currentState?.assigneeId === viewer ? "Unassign" : "Assign to me"}
            </button>
            <h3 className="font-semibold">Internal notes</h3>
            {currentState?.notes.map((entry) => <p key={entry.id} className="whitespace-pre-wrap break-words rounded border border-border p-2">{entry.body}</p>)}
            <form className="grid gap-2" onSubmit={(event) => {
              event.preventDefault();
              void updateThread(selectedKey, { note }).then((saved) => { if (saved) setNote(""); });
            }}>
              <textarea aria-label="Internal note" placeholder="Add an internal note…" className="rounded border border-border bg-background p-2" value={note}
                onChange={(event) => setNote(event.target.value)} maxLength={4000} />
              <button className={actionClass} disabled={mutating || !note.trim()}>Add note</button>
            </form>
          </aside>
        )}
        </div>
      </div>
    </div>
  );
}
