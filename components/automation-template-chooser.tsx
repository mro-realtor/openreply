"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  canStartAutomationFromScratch,
  filterAutomationTemplates,
  getTemplateDestination,
  type AutomationChannel,
} from "@/lib/automation-catalog";

const goals = [
  { id: "all", label: "All templates" },
  { id: "growth", label: "Grow your followers" },
  { id: "engage", label: "Engage your audience" },
  { id: "traffic", label: "Drive traffic" },
] as const;

const triggers = [
  { id: "all", label: "Any trigger" },
  { id: "comment", label: "Post or Reel comment" },
  { id: "dm", label: "DM" },
  { id: "story", label: "Story reply" },
  { id: "live", label: "Live comment" },
] as const;

export default function AutomationTemplateChooser({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const [channel, setChannel] = useState<AutomationChannel>("instagram");
  const [goal, setGoal] = useState<(typeof goals)[number]["id"]>("all");
  const [trigger, setTrigger] = useState<(typeof triggers)[number]["id"]>("all");
  const [search, setSearch] = useState("");
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  const filtered = useMemo(
    () => filterAutomationTemplates({ channel, goal, search, trigger }),
    [channel, goal, search, trigger]
  );

  if (!open) return null;

  return (
    <dialog
      ref={dialogRef}
      onClose={onClose}
      onClick={(event) => {
        if (event.target === event.currentTarget) dialogRef.current?.close();
      }}
      className="m-0 flex h-dvh w-screen max-h-none max-w-none items-start justify-center overflow-y-auto border-0 bg-transparent p-3 backdrop:bg-black/35 sm:p-6"
    >
      <section
        aria-labelledby="automation-template-title"
        className="my-auto flex max-h-[min(90dvh,900px)] w-full max-w-6xl flex-col overflow-hidden rounded-xl border border-border bg-background shadow-2xl"
      >
        <header className="flex items-center justify-between border-b border-border px-5 py-4 sm:px-7">
          <h2 id="automation-template-title" className="text-lg font-semibold">Templates</h2>
          <div className="flex items-center gap-3">
            {canStartAutomationFromScratch(channel) ? (
              <Link
                href="/campaigns/new"
                className="hidden rounded-md border border-[#dce2e8] px-3 py-2 text-sm font-medium hover:bg-[#f5f8fb] sm:inline-flex"
              >
                + Start From Scratch
              </Link>
            ) : (
              <button type="button" disabled title="The Facebook automation builder is not available yet"
                className="hidden rounded-md border border-border px-3 py-2 text-sm font-medium text-muted opacity-60 sm:inline-flex">
                Start From Scratch · unavailable
              </button>
            )}
            <button type="button" aria-label="Close templates" onClick={() => dialogRef.current?.close()} className="grid size-9 place-items-center rounded-md text-xl text-muted hover:bg-surface-hover hover:text-foreground">
              ×
            </button>
          </div>
        </header>

        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 sm:px-7">
          <div role="tablist" aria-label="Automation channel" className="flex gap-5">
            {(["instagram", "facebook"] as const).map((item) => (
              <button
                key={item}
                type="button"
                role="tab"
                aria-selected={channel === item}
                onClick={() => setChannel(item)}
                className={`border-b-2 px-1 py-3 text-sm font-medium capitalize ${channel === item ? "border-[#1682e8] text-foreground" : "border-transparent text-muted hover:text-foreground"}`}
              >
                {item === "instagram" ? "◎ Instagram" : "◉ Facebook"}
              </button>
            ))}
          </div>
          <input
            aria-label="Search templates"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder={`Search ${channel} templates`}
            className="my-2 w-full rounded-md border border-border bg-background px-3 py-2 text-sm sm:w-64"
          />
        </div>

        <div className="grid min-h-0 flex-1 md:grid-cols-[190px_minmax(0,1fr)]">
          <aside className="flex gap-5 overflow-x-auto border-b border-border p-4 md:block md:overflow-y-auto md:border-b-0 md:border-r md:p-5">
            <div className="shrink-0">
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">By goal</h3>
              <div className="flex gap-1 md:flex-col">
                {goals.map((item) => (
                  <button key={item.id} type="button" onClick={() => setGoal(item.id)} aria-pressed={goal === item.id}
                    className={`whitespace-nowrap rounded-md px-2.5 py-2 text-left text-sm ${goal === item.id ? "bg-surface-hover font-medium text-foreground" : "text-muted hover:text-foreground"}`}>
                    {item.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="shrink-0 md:mt-6">
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">By trigger</h3>
              <div className="flex gap-1 md:flex-col">
                {triggers.map((item) => (
                  <button key={item.id} type="button" onClick={() => setTrigger(item.id)} aria-pressed={trigger === item.id}
                    className={`whitespace-nowrap rounded-md px-2.5 py-2 text-left text-sm ${trigger === item.id ? "bg-surface-hover font-medium text-foreground" : "text-muted hover:text-foreground"}`}>
                    {item.label}
                  </button>
                ))}
              </div>
            </div>
          </aside>

          <div className="min-h-0 overflow-y-auto p-5 sm:p-7">
            <h3 className="mb-4 text-lg font-semibold">Recommended</h3>
            {filtered.length ? (
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                {filtered.map((template) => {
                  const destination = getTemplateDestination(template);
                  const content = (
                    <>
                      <span className="text-xs font-medium text-muted">{template.builder}</span>
                      <h4 className="mt-5 text-base font-semibold">{template.name}</h4>
                      <p className="mt-2 min-h-12 text-sm leading-5 text-muted">{template.description}</p>
                      {template.unavailableReason && (
                        <p className="mt-4 rounded-md bg-surface px-3 py-2 text-xs text-muted">{template.unavailableReason}</p>
                      )}
                    </>
                  );
                  return destination ? (
                    <Link key={template.id} href={destination}
                      className="min-h-48 rounded-lg border border-border p-4 transition-colors hover:border-accent/50 hover:bg-surface">
                      {content}
                    </Link>
                  ) : (
                    <article key={template.id} className="min-h-48 rounded-lg border border-border bg-surface/50 p-4 opacity-75">
                      {content}
                    </article>
                  );
                })}
              </div>
            ) : (
              <p className="rounded-lg border border-dashed border-border p-8 text-center text-sm text-muted">No templates match these filters.</p>
            )}
          </div>
        </div>
        <footer className="flex items-center justify-between border-t border-border px-5 py-3 sm:hidden">
          {canStartAutomationFromScratch(channel) ? (
            <>
              <span className="text-xs text-muted">Start a supported Instagram comment automation</span>
              <Link href="/campaigns/new" className="rounded-md bg-accent px-3 py-2 text-sm font-semibold text-white">Start</Link>
            </>
          ) : (
            <span className="text-xs text-muted">Facebook automation setup is not available yet.</span>
          )}
        </footer>
      </section>
    </dialog>
  );
}
