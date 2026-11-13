"use client";

import { useEffect, useState } from "react";

type Account = { id: string; username: string };
type Post = { id: string; caption?: string; media_product_type?: string };
export type SavedSequenceTrigger = {
  id: string; name: string; sequenceId: string; isActive: boolean;
  dmTriggerEnabled: boolean; keywords: string[]; matchAnyWord: boolean;
};

export default function SequenceTriggerForm({ type, sequenceId, onAdd }: {
  type: "comment" | "dm"; sequenceId: string; onAdd: (trigger: SavedSequenceTrigger) => void;
}) {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [accountId, setAccountId] = useState("");
  const [posts, setPosts] = useState<Post[]>([]);
  const [postId, setPostId] = useState("");
  const [search, setSearch] = useState("");
  const [keywords, setKeywords] = useState("");
  const [openingMessage, setOpeningMessage] = useState("");
  const [reply, setReply] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let current = true;
    void fetch("/api/instagram/accounts").then(r => r.json()).then(data => {
      if (!data.success) throw new Error();
      if (current) {
        setAccounts(data.data.instagramAccounts);
        setAccountId(data.data.instagramAccounts[0]?.id ?? "");
      }
    }).catch(() => { if (current) setError("Could not load Instagram accounts."); });
    return () => { current = false; };
  }, []);
  useEffect(() => {
    if (!accountId || type !== "comment") return;
    let current = true;
    void fetch(`/api/instagram/posts?all=true&instagramAccountId=${encodeURIComponent(accountId)}`)
      .then(r => r.json()).then(data => {
        if (!data.success) throw new Error();
        if (current) setPosts(data.data);
      }).catch(() => { if (current) setError("Could not load posts and reels."); });
    return () => { current = false; };
  }, [accountId, type]);

  async function save() {
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/sequences/triggers", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sequenceId, accountId, type, postId: postId || undefined,
          keywords: keywords.split(",").map(word => word.trim()).filter(Boolean),
          openingMessage: openingMessage || undefined, reply }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      onAdd(data);
    } catch (error) {
      setError(error instanceof Error ? error.message : "Could not add trigger.");
    } finally { setBusy(false); }
  }
  const field = "w-full rounded border border-[#dce0e5] bg-white p-2 text-sm";
  return <form className="space-y-3" onSubmit={event => { event.preventDefault(); void save(); }}>
    <h3 className="font-semibold">{type === "comment" ? "Post or Reel Comments" : "Instagram Message"}</h3>
    <label className="block text-sm">Instagram account
      <select className={field} required value={accountId} onChange={event => {
        setPosts([]); setPostId(""); setAccountId(event.target.value);
      }}>
        {!accounts.length && <option value="">No Instagram accounts</option>}
        {accounts.map(account => <option key={account.id} value={account.id}>@{account.username}</option>)}
      </select>
    </label>
    {type === "comment" && <>
      <label className="block text-sm">Search posts and reels
        <input className={field} type="search" value={search} onChange={event => setSearch(event.target.value)} />
      </label>
      <label className="block text-sm">Specific Post or Reel
        <select className={field} required value={postId} onChange={event => setPostId(event.target.value)}>
          <option value="">Choose a post or reel</option>
          {posts.filter(post => post.id === postId || (post.caption ?? "").toLowerCase().includes(search.toLowerCase())).map(post =>
            <option key={post.id} value={post.id}>{post.media_product_type === "REELS" ? "Reel" : "Post"} · {post.caption?.slice(0, 110) || post.id}</option>)}
        </select>
      </label>
      <label className="block text-sm">Opening private reply
        <textarea className={field} required maxLength={1000} value={openingMessage} onChange={event => setOpeningMessage(event.target.value)} />
      </label>
      <p className="text-xs text-[#535d6c]">Contacts tap Continue to start the sequence.</p>
    </>}
    <label className="block text-sm">Keywords (comma-separated)
      <input className={field} required value={keywords} onChange={event => setKeywords(event.target.value)} />
    </label>
    <label className="block text-sm">First reply before the sequence
      <textarea className={field} required maxLength={1000} value={reply} onChange={event => setReply(event.target.value)} />
    </label>
    {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
    <button className="rounded bg-blue-600 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50" disabled={busy || !accountId}>Activate trigger</button>
  </form>;
}
