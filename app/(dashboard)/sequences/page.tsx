"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";

type Step = { delayMinutes: number; message: string };
type Enrollment = {
  id: string;
  recipientName: string | null;
  status: string;
  nextStep: number;
  reason: string | null;
  dueAt: string;
  automation: { name: string };
};
type Sequence = {
  id: string;
  name: string;
  enabled: boolean;
  steps: Step[];
  enrollments: Enrollment[];
  _count: { enrollments: number };
};
type Campaign = { id: string; name: string; sequenceId: string | null; isActive: boolean };
type SequenceData = { sequences: Sequence[]; campaigns: Campaign[]; editable: boolean };

const button = "rounded-md border border-[#d8dde5] bg-white px-3 py-2 text-sm font-semibold hover:bg-[#f6f8fa] disabled:opacity-50";
const primary = "rounded-md bg-[#0069dc] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#005cc4] disabled:opacity-50";
const input = "w-full rounded-md border border-[#d8dde5] bg-white px-3 py-2 text-sm outline-offset-2";
const panel = "rounded-lg border border-[#dfe1e5] bg-white";
const table = "w-full min-w-[580px] border-collapse text-left text-sm [&_th]:px-5 [&_th]:py-3 [&_th]:font-medium [&_td]:border-t [&_td]:border-[#eceef1] [&_td]:px-5 [&_td]:py-3";
const tableHead = "bg-[#f8f9fb] text-[#535d6c]";

async function request<T>(method = "GET", body?: unknown): Promise<T> {
  const response = await fetch("/api/sequences", {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
    cache: "no-store",
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Could not load sequences");
  return data;
}

function Dialog({ title, onClose, children }: {
  title: string; onClose: () => void; children: ReactNode;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { dialog.current?.showModal(); }, []);
  return (
    <dialog ref={dialog} aria-label={title} onCancel={onClose}
      className="m-auto w-[calc(100%-2rem)] max-w-md rounded-lg border border-[#dfe1e5] bg-white p-6 text-[#20242a] shadow-xl backdrop:bg-black/30">
      <h2 className="mb-4 text-lg font-semibold">{title}</h2>
      {children}
    </dialog>
  );
}

export default function SequencesPage() {
  const [data, setData] = useState<SequenceData>();
  const [selected, setSelected] = useState<string>();
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const refresh = async () => setData(await request<SequenceData>());

  useEffect(() => {
    let current = true;
    void request<SequenceData>().then(
      (result) => { if (current) setData(result); },
      (error: Error) => { if (current) setError(error.message); }
    );
    return () => { current = false; };
  }, []);

  const current = data?.sequences.find((sequence) => sequence.id === selected);
  const openNew = () => { setName(""); setError(""); setCreating(true); };

  async function create() {
    setBusy(true);
    setError("");
    try {
      const saved = await request<{ id: string }>("POST", { name, steps: [], enabled: false });
      await refresh();
      setSelected(saved.id);
      setCreating(false);
    } catch (error) {
      setError(error instanceof Error ? error.message : "Could not create sequence");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="min-h-full bg-[#f4f4f5] text-[#20242a] [color-scheme:light]">
      <div className="border-b border-[#dfe1e5] px-5 py-4 text-xl font-semibold md:px-8">Automation</div>
      <div className="mx-auto max-w-[1260px] px-4 py-7 md:px-8">
        {!creating && error && <p role="alert" className="mb-4 text-sm text-red-700">{error}</p>}
        {!data && !error && <p className="text-sm text-[#535d6c]">Loading sequences…</p>}
        {data && current && (
          <SequenceEditor key={current.id} sequence={current} data={data} refresh={refresh}
            onBack={() => setSelected(undefined)} />
        )}
        {data && !current && (
          <>
            <header className="mb-5 flex items-center justify-between gap-3">
              <h1 className="text-2xl font-semibold">Sequences</h1>
              {data.editable && <button className={primary} onClick={openNew}>＋ New Sequence</button>}
            </header>
            {data.sequences.length ? (
              <div className={panel + " overflow-x-auto"}>
                <table className={table}>
                  <thead className={tableHead}><tr><th>Name</th><th>Subscribers</th><th>Messages</th><th>Status</th></tr></thead>
                  <tbody>
                    {data.sequences.map((sequence) => (
                      <tr key={sequence.id} className="hover:bg-[#f7faff]">
                        <td><button className="text-left font-semibold text-[#0061cb] hover:underline"
                          onClick={() => setSelected(sequence.id)}>{sequence.name}</button></td>
                        <td>{sequence._count.enrollments}</td>
                        <td>{sequence.steps.length}</td>
                        <td><span className={sequence.enabled ? "text-green-700" : "text-[#535d6c]"}>
                          {sequence.enabled ? "Active" : "Paused"}</span></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className={panel + " flex min-h-96 flex-col items-center justify-center gap-4 px-6 text-center"}>
                <div aria-hidden="true" className="grid size-16 place-items-center rounded-full bg-[#e5f2ff] text-3xl text-[#0069dc]">↪</div>
                <h2 className="text-2xl font-semibold">Create your first Sequence</h2>
                <p className="max-w-sm text-sm text-[#535d6c]">Schedule a series of automatic Instagram messages for contacts who engage with your campaigns.</p>
                {data.editable && <button className={primary} onClick={openNew}>＋ New Sequence</button>}
              </div>
            )}
          </>
        )}
      </div>
      {creating && (
        <Dialog title="Create a New Sequence" onClose={() => setCreating(false)}>
          <form className="space-y-4" onSubmit={(event) => { event.preventDefault(); void create(); }}>
            <input autoFocus aria-label="Sequence name" placeholder="Enter sequence name" className={input}
              value={name} onChange={(event) => setName(event.target.value)} maxLength={100} required />
            {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
            <div className="flex justify-end gap-2">
              <button type="button" className={button} onClick={() => setCreating(false)}>Cancel</button>
              <button className={primary} disabled={busy || !name.trim()}>Create</button>
            </div>
          </form>
        </Dialog>
      )}
    </main>
  );
}

function delayLabel(minutes: number) {
  if (!minutes) return "Immediately";
  if (minutes % 60 === 0) {
    const hours = minutes / 60;
    return `After ${hours} ${hours === 1 ? "hour" : "hours"}`;
  }
  return `After ${minutes} ${minutes === 1 ? "minute" : "minutes"}`;
}

function ScheduleEditor({ minutes, onSave, onClose }: {
  minutes: number; onSave: (minutes: number) => void; onClose: () => void;
}) {
  const [unit, setUnit] = useState(minutes === 0 ? "immediate" : minutes % 60 === 0 ? "hours" : "minutes");
  const [amount, setAmount] = useState(minutes === 0 ? 1 : unit === "hours" ? minutes / 60 : minutes);
  const delay = unit === "immediate" ? 0 : amount * (unit === "hours" ? 60 : 1);

  return (
    <Dialog title="Schedule message" onClose={onClose}>
      <form className="space-y-4" onSubmit={(event) => { event.preventDefault(); onSave(delay); }}>
        <p className="text-sm">This message will be sent at least</p>
        <div className="flex gap-2">
          {unit !== "immediate" && <input autoFocus type="number" min={1} required aria-label="Delay time"
            className={input} value={amount} onChange={(event) => setAmount(Number(event.target.value))} />}
          <select aria-label="Delay unit" className={input} value={unit} onChange={(event) => setUnit(event.target.value)}>
            <option value="immediate">Immediately</option><option value="minutes">Minutes</option><option value="hours">Hours</option>
          </select>
        </div>
        <p className="text-sm text-[#535d6c]">Delays count from enrollment for the first message and from the previous send for later messages.</p>
        <div className="flex justify-end gap-2">
          <button type="button" className={button} onClick={onClose}>Cancel</button>
          <button className={primary} disabled={delay >= 1440}>Save Schedule</button>
        </div>
      </form>
    </Dialog>
  );
}

function SequenceEditor({ sequence, data, refresh, onBack }: {
  sequence: Sequence; data: SequenceData; refresh: () => Promise<void>; onBack: () => void;
}) {
  const [name, setName] = useState(sequence.name);
  const [enabled, setEnabled] = useState(sequence.enabled);
  const [steps, setSteps] = useState(sequence.steps);
  const [campaignIds, setCampaignIds] = useState(
    data.campaigns.filter((campaign) => campaign.sequenceId === sequence.id).map((campaign) => campaign.id)
  );
  const [edit, setEdit] = useState<{ index: number; kind: "schedule" | "message" }>();
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const totalDelay = steps.reduce((total, step) => total + step.delayMinutes, 0);
  const invalid = !name.trim() || steps.some((step) => !step.message.trim()) || totalDelay >= 1440 || (enabled && !steps.length);
  const dirty = name !== sequence.name || enabled !== sequence.enabled ||
    JSON.stringify(steps) !== JSON.stringify(sequence.steps) ||
    data.campaigns.some((campaign) => campaignIds.includes(campaign.id) !== (campaign.sequenceId === sequence.id));

  function updateStep(index: number, update: Partial<Step>) {
    setSteps((current) => current.map((step, position) => position === index ? { ...step, ...update } : step));
    setNotice("");
    setEdit(undefined);
  }

  async function run(operation: () => Promise<unknown>, success: string) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await operation();
      await refresh();
      setNotice(success);
    } catch (error) {
      setError(error instanceof Error ? error.message : "Could not update sequence");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-5">
      <nav aria-label="Breadcrumb" className="text-sm text-[#535d6c]">
        <Link href="/campaigns" className="hover:underline">Automation</Link>
        <span aria-hidden="true"> / </span>
        <button onClick={onBack} className="text-[#0061cb] hover:underline">Sequences</button>
      </nav>
      <header className="flex flex-wrap items-center justify-between gap-3">
        <input aria-label="Sequence name" className="min-w-0 flex-1 rounded border border-transparent bg-transparent px-1 py-1 text-2xl font-semibold hover:border-[#d8dde5] focus:bg-white"
          value={name} readOnly={!data.editable} maxLength={100} onChange={(event) => setName(event.target.value)} />
        {data.editable && (
          <div className="flex items-center gap-3">
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" role="switch" checked={enabled} onChange={(event) => setEnabled(event.target.checked)} />
              Active
            </label>
            <button className={primary} disabled={busy || invalid || !dirty} onClick={() => void run(
              () => request("POST", { id: sequence.id, name, enabled, steps, campaignIds }), "Sequence saved."
            )}>Save Sequence</button>
          </div>
        )}
      </header>
      {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
      {notice && <p role="status" className="text-sm text-green-700">{notice}</p>}
      <section aria-label="Messages" className={panel + " overflow-x-auto"}>
        {steps.length ? (
          <table className={table}>
            <thead className={tableHead}><tr><th>Schedule</th><th>Message</th><th aria-label="Actions" /></tr></thead>
            <tbody>
              {steps.map((step, index) => (
                <tr key={index}>
                  <td className="w-48"><button className={button} disabled={!data.editable || busy}
                    aria-label={`Schedule message ${index + 1}: ${delayLabel(step.delayMinutes)}`}
                    onClick={() => setEdit({ index, kind: "schedule" })}>{delayLabel(step.delayMinutes)} ⌄</button></td>
                  <td><button className="max-w-lg truncate text-left font-semibold text-[#0061cb] hover:underline"
                    disabled={!data.editable || busy}
                    onClick={() => { setMessage(step.message); setEdit({ index, kind: "message" }); }}>
                    {step.message || "Create New Reply"}</button></td>
                  <td><button className={button} disabled={!data.editable || busy}
                    aria-label={`Remove message ${index + 1}`}
                    onClick={() => setSteps((items) => items.filter((_, position) => position !== index))}>Remove</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : <p className="px-5 pt-5 text-sm text-[#535d6c]">You have no messages.</p>}
        {data.editable && <div className="p-5"><button className={button} disabled={busy || steps.length >= 20}
          onClick={() => setSteps((items) => [...items, { delayMinutes: 5, message: "" }])}>+ Message</button></div>}
      </section>
      <p className={`text-sm ${totalDelay >= 1440 ? "text-red-700" : "text-[#535d6c]"}`}>
        Instagram sequences must fit inside 24 hours. Pending messages stop when a contact replies.
      </p>
      <details className={panel + " px-5 py-4"}>
        <summary className="cursor-pointer font-semibold">Assigned campaigns ({campaignIds.length})</summary>
        <fieldset disabled={!data.editable || busy} className="mt-3 space-y-2">
          {data.campaigns.map((campaign) => (
            <label key={campaign.id} className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={campaignIds.includes(campaign.id)}
                disabled={Boolean(campaign.sequenceId && campaign.sequenceId !== sequence.id)}
                onChange={(event) => setCampaignIds((ids) => event.target.checked
                  ? [...ids, campaign.id] : ids.filter((id) => id !== campaign.id))} />
              {campaign.name}{!campaign.isActive && " (paused)"}
            </label>
          ))}
          <Link className="text-sm text-[#0061cb] hover:underline" href="/campaigns/new">Create campaign</Link>
        </fieldset>
      </details>
      <section className={panel + " space-y-3 p-5"}>
        <div className="flex items-center justify-between">
          <h2 className="font-semibold">Recent enrollments</h2>
          <button className={button} disabled={busy} onClick={() => void run(refresh, "Enrollments refreshed.")}>Refresh</button>
        </div>
        {!sequence.enrollments.length && <p className="text-sm text-[#535d6c]">No contacts enrolled yet.</p>}
        {sequence.enrollments.map((entry) => (
          <div key={entry.id} className="flex flex-wrap items-center justify-between gap-2 border-t border-[#eceef1] pt-3 text-sm">
            <div>
              <p>{entry.recipientName || "Instagram contact"} · {entry.automation.name}</p>
              <p className="text-[#535d6c]">{entry.status.toLowerCase()} · {entry.nextStep} sent
                {entry.status === "PENDING" && ` · Next at ${new Date(entry.dueAt).toLocaleString()}`}
                {entry.reason && ` · ${entry.reason}`}</p>
            </div>
            {data.editable && ["PENDING", "SENDING"].includes(entry.status) &&
              <button className={button} disabled={busy} onClick={() => void run(
                () => request("PATCH", { sequenceId: sequence.id, enrollmentId: entry.id }), "Contact stopped."
              )}>Stop contact</button>}
          </div>
        ))}
      </section>
      {edit?.kind === "schedule" && <ScheduleEditor minutes={steps[edit.index].delayMinutes}
        onClose={() => setEdit(undefined)} onSave={(delayMinutes) => updateStep(edit.index, { delayMinutes })} />}
      {edit?.kind === "message" && (
        <Dialog title="Edit message" onClose={() => setEdit(undefined)}>
          <form className="space-y-4" onSubmit={(event) => { event.preventDefault(); updateStep(edit.index, { message: message.trim() }); }}>
            <textarea autoFocus aria-label="Message" className={input} rows={5} maxLength={1000} required
              value={message} onChange={(event) => setMessage(event.target.value)} />
            <div className="flex justify-end gap-2">
              <button type="button" className={button} onClick={() => setEdit(undefined)}>Cancel</button>
              <button className={primary} disabled={!message.trim()}>Save Message</button>
            </div>
          </form>
        </Dialog>
      )}
    </div>
  );
}
