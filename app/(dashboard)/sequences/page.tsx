"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
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
type Sequence = { id: string; name: string; enabled: boolean; steps: Step[]; enrollments: Enrollment[] };
type Campaign = { id: string; name: string; sequenceId: string | null; isActive: boolean };
type SequenceData = { sequences: Sequence[]; campaigns: Campaign[]; editable: boolean };

const emptyStep: Step = { delayMinutes: 5, message: "" };
const field = "w-full rounded border border-border bg-surface px-3 py-2 text-sm";
const action = "rounded border border-border px-3 py-2 text-sm font-medium hover:bg-surface-hover disabled:opacity-50";
const primary = "rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50";

async function sequencesRequest(method = "GET", body?: unknown) {
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

export default function SequencesPage() {
  const [data, setData] = useState<SequenceData>();
  const [selected, setSelected] = useState<string>();
  const [error, setError] = useState("");
  const refresh = useCallback(async () => {
    try {
      setData(await sequencesRequest());
      setError("");
    } catch (error) {
      setError(error instanceof Error ? error.message : "Could not load sequences");
    }
  }, []);
  useEffect(() => {
    let current = true;
    void sequencesRequest().then(
      (result) => { if (current) setData(result); },
      (error) => { if (current) setError(error.message); }
    );
    return () => { current = false; };
  }, []);

  const current = data?.sequences.find((sequence) => sequence.id === selected);

  return (
    <main className="mx-auto max-w-6xl space-y-5 p-4 md:p-8">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">Sequences</h1>
        {data?.editable && <button className={primary} onClick={() => setSelected("new")}>New Sequence</button>}
      </header>
      {error && <p role="alert" className="text-sm text-red-500">{error}</p>}
      {!data && !error && <p className="text-sm text-muted">Loading sequences…</p>}
      {data && (
        <div className="grid gap-4 md:grid-cols-[16rem_1fr]">
          <div className="space-y-2">
            {data.sequences.map((sequence) => (
              <button key={sequence.id} onClick={() => setSelected(sequence.id)}
                aria-pressed={sequence.id === selected}
                className="w-full rounded border border-border bg-surface p-3 text-left aria-pressed:border-blue-500">
                <span className="block font-medium">{sequence.name}</span>
                <span className="text-xs text-muted">{sequence.enabled ? "Active" : "Paused"} · {sequence.steps.length} steps</span>
              </button>
            ))}
          </div>
          {selected ? (
            <SequenceEditor key={selected} sequence={current} data={data} refresh={refresh} select={setSelected} />
          ) : (
            <div className="rounded border border-border bg-surface p-6 text-sm text-muted">
              {data.sequences.length ? "Select a sequence to view its steps and contacts." : "Create a sequence to schedule multiple Instagram follow-ups from a campaign."}
            </div>
          )}
        </div>
      )}
    </main>
  );
}

function SequenceEditor({ sequence, data, refresh, select }: {
  sequence?: Sequence;
  data: SequenceData;
  refresh: () => Promise<void>;
  select: (id: string) => void;
}) {
  const [name, setName] = useState(sequence?.name ?? "");
  const [enabled, setEnabled] = useState(sequence?.enabled ?? false);
  const [steps, setSteps] = useState(sequence?.steps ?? [emptyStep]);
  const [campaignIds, setCampaignIds] = useState(
    data.campaigns.filter((campaign) => sequence && campaign.sequenceId === sequence.id).map((campaign) => campaign.id)
  );
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const totalDelay = steps.reduce((total, step) => total + step.delayMinutes, 0);

  function updateStep(index: number, update: Partial<Step>) {
    setSteps((current) => current.map((step, position) => position === index ? { ...step, ...update } : step));
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const saved = await sequencesRequest("POST", { id: sequence?.id, name, enabled, steps, campaignIds });
      await refresh();
      select(saved.id);
      setNotice("Sequence saved.");
    } catch (error) {
      setError(error instanceof Error ? error.message : "Could not save sequence");
    } finally {
      setBusy(false);
    }
  }

  async function cancel(enrollmentId: string) {
    setBusy(true);
    setError("");
    try {
      await sequencesRequest("PATCH", { sequenceId: sequence?.id, enrollmentId });
      await refresh();
    } catch (error) {
      setError(error instanceof Error ? error.message : "Could not stop contact");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-5">
      <form onSubmit={save} className="space-y-4 rounded border border-border bg-surface p-4">
        <fieldset disabled={!data.editable || busy} className="space-y-4">
          <label className="block space-y-1 text-sm font-medium">
            <span>Sequence name</span>
            <input className={field} value={name} onChange={(event) => setName(event.target.value)} required maxLength={100} />
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={enabled} onChange={(event) => setEnabled(event.target.checked)} />
            Enable sequence
          </label>
          {steps.map((step, index) => (
            <div key={index} className="space-y-2 rounded border border-border p-3">
              <div className="flex items-center justify-between gap-3">
                <h2 className="text-sm font-semibold">Step {index + 1}</h2>
                {steps.length > 1 && <button type="button" className={action} onClick={() =>
                  setSteps((current) => current.filter((_, position) => position !== index))
                }>Remove</button>}
              </div>
              <label className="block space-y-1 text-sm">
                <span>Minutes after {index ? "previous message" : "campaign link delivery"}</span>
                <input type="number" className={field} min={0} max={1439} required value={step.delayMinutes}
                  onChange={(event) => updateStep(index, { delayMinutes: Number(event.target.value) })} />
              </label>
              <label className="block space-y-1 text-sm">
                <span>Message</span>
                <textarea className={field} rows={3} required maxLength={1000} value={step.message}
                  onChange={(event) => updateStep(index, { message: event.target.value })} />
              </label>
            </div>
          ))}
          <button type="button" className={action} disabled={steps.length >= 20}
            onClick={() => setSteps((current) => [...current, emptyStep])}>Add step</button>
          <p className="text-sm text-muted">Total delay {totalDelay} minutes. Instagram follow-ups stop when the contact replies or their 24-hour messaging window closes.</p>
          <fieldset className="space-y-2">
            <legend className="text-sm font-semibold">Assigned campaigns</legend>
            {data.campaigns.map((campaign) => (
              <label key={campaign.id} className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={campaignIds.includes(campaign.id)}
                  disabled={Boolean(campaign.sequenceId && campaign.sequenceId !== sequence?.id)}
                  onChange={(event) => setCampaignIds((ids) => event.target.checked
                    ? [...ids, campaign.id] : ids.filter((id) => id !== campaign.id))} />
                {campaign.name}{!campaign.isActive && " (paused)"}
              </label>
            ))}
            <Link className="text-sm text-blue-500" href="/campaigns/new">Create campaign</Link>
          </fieldset>
        </fieldset>
        {data.editable && <button className={primary} disabled={busy || totalDelay >= 1440}>Save sequence</button>}
        {notice && <p role="status" className="text-sm text-muted">{notice}</p>}
        {error && <p role="alert" className="text-sm text-red-500">{error}</p>}
      </form>
      {sequence && (
        <section className="space-y-3 rounded border border-border bg-surface p-4">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold">Recent enrollments</h2>
            <button className={action} onClick={() => void refresh()}>Refresh</button>
          </div>
          {!sequence.enrollments.length && <p className="text-sm text-muted">No contacts enrolled yet.</p>}
          {sequence.enrollments.map((entry) => (
            <div key={entry.id} className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3 text-sm">
              <div>
                <p>{entry.recipientName || "Instagram contact"} · {entry.automation.name}</p>
                <p className="text-muted">{entry.status.toLowerCase()} · {entry.nextStep} sent
                  {entry.status === "PENDING" && ` · Next at ${new Date(entry.dueAt).toLocaleString()}`}
                  {entry.reason && ` · ${entry.reason}`}</p>
              </div>
              {data.editable && ["PENDING", "SENDING"].includes(entry.status) &&
                <button className={action} disabled={busy} onClick={() => void cancel(entry.id)}>Stop contact</button>}
            </div>
          ))}
        </section>
      )}
    </div>
  );
}
