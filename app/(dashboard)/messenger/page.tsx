"use client";

import { useEffect, useState } from "react";

type Event = { eventId: string; recipientId: string; receivedAt: string; text: string | null; kind: string };
type Page = { id: string; name: string; events: Event[] };
type Data = { pages: Page[]; editable: boolean };
const button = "rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50";
const field = "rounded border border-border bg-surface p-2 text-sm";

async function api(method = "GET", body?: unknown) {
  const response = await fetch("/api/messenger", {
    method, cache: "no-store",
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error);
  return data;
}

export default function MessengerPage() {
  const [data, setData] = useState<Data>();
  const [token, setToken] = useState("");
  const [selected, setSelected] = useState<{ pageId: string; recipientId: string }>();
  const [text, setText] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    void api().then(setData, (error: Error) => setNotice(error.message));
  }, []);

  async function run(operation: () => Promise<void>) {
    setBusy(true);
    setNotice("");
    try { await operation(); } catch (error) {
      setNotice(error instanceof Error ? error.message : "Request failed");
    } finally { setBusy(false); }
  }

  return (
    <section className="space-y-5">
      <header className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Facebook Messenger</h1>
        <div className="flex items-center gap-2">
          <button className={button} disabled={busy} onClick={() => void run(async () => setData(await api()))}>Refresh</button>
          {data?.editable && <a className="rounded border border-border px-4 py-2 text-sm font-medium" href="/api/messenger/connect">Refresh Facebook connection</a>}
        </div>
      </header>
      {notice && <p role="status">{notice}</p>}
      {data?.editable && (
        <div className="space-y-3">
        <a className={`${button} inline-block`} href="/api/messenger/connect">Connect with Facebook</a>
        <p className="text-sm text-muted">Sign in with Facebook to discover every Page you manage, then connect them together.</p>
        <form className="flex flex-wrap items-end gap-2" onSubmit={(event) => {
          event.preventDefault();
          void run(async () => {
            const page = await api("POST", { token, discover: true });
            setToken("");
            setData(await api());
            setNotice(page.pages.length ? `${page.pages.length} Facebook Page${page.pages.length === 1 ? "" : "s"} connected. Verify webhook subscriptions in Meta.` : "No Facebook Pages were found for this token.");
          });
        }}>
          <label className="grid gap-1 text-sm">Meta user token (discover all Pages)
            <input className={field} type="password" autoComplete="off" value={token}
              onChange={(event) => setToken(event.target.value)} required />
          </label>
          <button className={button} disabled={busy || !token.trim()}>Discover & Connect Pages</button>
        </form>
        <p className="text-sm text-muted">Use the User Token option in Graph API Explorer. It lets OpenReply list every Facebook Page you manage across your business portfolios.</p>
        <form className="flex flex-wrap items-end gap-2" onSubmit={(event) => {
          event.preventDefault();
          void run(async () => {
            const page = await api("POST", { token, discover: false });
            setToken("");
            setData(await api());
            setNotice(`${page.name} connected. Verify its webhook subscription in Meta.`);
          });
        }}>
          <label className="grid gap-1 text-sm">Or connect one Page token
            <input className={field} type="password" autoComplete="off" value={token}
              onChange={(event) => setToken(event.target.value)} required />
          </label>
          <button className={button} disabled={busy || !token.trim()}>Connect One Page</button>
        </form>
        </div>
      )}
      {data && data.pages.length > 0 && <p className="text-sm text-muted">{data.pages.length} Facebook Page{data.pages.length === 1 ? "" : "s"} connected. Use “Refresh Facebook connection” to rediscover Pages from Meta.</p>}
      {data && !data.pages.length && <p>No Facebook Pages connected.</p>}
      {data?.pages.map((page) => (
        <article key={page.id} className="space-y-3 rounded border border-border p-4">
          <h2 className="font-semibold">{page.name}</h2>
          {!page.events.length && <p className="text-sm text-muted">Waiting for the first Messenger event.</p>}
          {page.events.map((entry) => (
            <div key={entry.eventId} className="flex items-center justify-between gap-3 border-t border-border pt-2 text-sm">
              <div><p className="break-all">{entry.text ?? "Attachment or other message"}</p>
                <p className="text-xs text-muted">{entry.kind} · {new Date(entry.receivedAt).toLocaleString()}</p></div>
              {data.editable && entry.kind === "MESSAGE" && <button className={button}
                onClick={() => { setText(""); setSelected({ pageId: page.id, recipientId: entry.recipientId }); }}>Reply</button>}
            </div>
          ))}
        </article>
      ))}
      {selected && (
        <form className="space-y-2" onSubmit={(event) => {
          event.preventDefault();
          void run(async () => {
            await api("PATCH", { ...selected, text });
            setSelected(undefined);
            setNotice("Messenger reply accepted by Meta.");
          });
        }}>
          <label className="grid gap-1">Messenger reply
            <textarea className={field} maxLength={2000} required value={text} onChange={(event) => setText(event.target.value)} />
          </label>
          <button className={button} disabled={busy || !text.trim()}>Send reply</button>
          <button type="button" className="ml-3 text-sm" onClick={() => setSelected(undefined)}>Cancel</button>
        </form>
      )}
    </section>
  );
}
