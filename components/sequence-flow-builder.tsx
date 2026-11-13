"use client";

import Link from "next/link";
import { useId, useRef, useState, type PointerEvent } from "react";

type Step = { position?: { x: number; y: number }; message: string; delayMinutes: number };

type Campaign = {
  id: string;
  name: string;
  dmTriggerEnabled: boolean;
  isActive: boolean;
  keywords: string[];
  matchAnyWord: boolean;
};

const control = "rounded-md border border-[#dce0e5] bg-white px-3 py-2 text-sm font-medium hover:bg-[#f7f9fb]";
const blue = "rounded-md bg-[#0069dc] px-4 py-2 text-sm font-semibold text-white hover:bg-[#005cbe] disabled:opacity-50";
const card = "w-full rounded-2xl border border-[#e6e8eb] bg-white p-5 text-left shadow-sm";

const triggerTypes = [
  { id: "comment", name: "Post or Reel Comments", description: "User comments on your Post or Reel" },
  { id: "dm", name: "Instagram Message", description: "User sends a message" },
  { id: "story", name: "Story Reply", description: "User replies to your Story with a matching message" },
] as const;
type Trigger = typeof triggerTypes[number]["id"];

export default function SequenceFlowBuilder({
  steps, initialIndex, campaigns, assignedIds, editable, onBack, onSave,
}: {
  steps: Step[];
  initialIndex: number;
  campaigns: Campaign[];
  assignedIds: string[];
  editable: boolean;
  onBack: () => void;
  onSave: (steps: Step[], campaignIds: string[]) => void;
}) {
  const [messages, setMessages] = useState(steps);
  const marker = useId();
  const drag = useRef<{ index: number; x: number; y: number; pointerX: number; pointerY: number }>(null);
  const positions = messages.map((step, index) => step.position ?? {
    x: index % 2 ? 710 : 365,
    y: 45 + Math.floor(index / 2) * 210 + (index % 2) * 95,
  });
  const canvasWidth = Math.max(1020, ...positions.map(({ x }) => x + 320));
  const canvasHeight = Math.max(380, ...positions.map(({ y }) => y + 180));

  function beginDrag(event: PointerEvent<HTMLButtonElement>, index: number) {
    if (event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { index, ...positions[index], pointerX: event.clientX, pointerY: event.clientY };
  }

  function moveCard(event: PointerEvent<HTMLButtonElement>) {
    const start = drag.current;
    if (!start) return;
    const position = {
      x: Math.min(100000, Math.max(0, Math.round(start.x + (event.clientX - start.pointerX) / zoom))),
      y: Math.min(100000, Math.max(0, Math.round(start.y + (event.clientY - start.pointerY) / zoom))),
    };
    setMessages((current) => current.map((step, index) => index === start.index ? { ...step, position } : step));
  }

  const [index, setIndex] = useState(initialIndex);
  const [addMenu, setAddMenu] = useState(false);
  const message = messages[index].message;
  const setMessage = (value: string) => setMessages((current) =>
    current.map((step, position) => position === index ? { ...step, message: value } : step)
  );
  function addMessage() {
    setMessages((current) => [...current, { message: "", delayMinutes: 0 }]);
    setIndex(messages.length);
    setAddMenu(false);
    setPanel("message");
  }
  const [ids, setIds] = useState(assignedIds);
  const [panel, setPanel] = useState<"triggers" | "message" | "preview" | undefined>("message");
  const [basic, setBasic] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [search, setSearch] = useState("");
  const [trigger, setTrigger] = useState<Trigger>();
  const selected = campaigns.filter((campaign) => ids.includes(campaign.id));
  const choices = campaigns.filter((campaign) => trigger === "comment" || campaign.dmTriggerEnabled);

  const openTriggers = () => {
    setSearch("");
    setTrigger(undefined);
    setPanel("triggers");
  };

  const composer = (
    <div className="space-y-3">
      <label className="block text-sm font-semibold" htmlFor="sequence-message-text">Send Message</label>
      <textarea id="sequence-message-text" placeholder="Enter your text…" rows={6}
        className="w-full rounded-lg border border-[#dce0e5] bg-[#f7f7f8] p-3 text-sm outline-offset-2"
        maxLength={1000} readOnly={!editable} value={message} onChange={(event) => setMessage(event.target.value)} />
      <div className="flex justify-between text-xs text-[#535d6c]">
        <button type="button" disabled={!editable || message.length > 990}
          className="font-medium text-[#0069dc] disabled:opacity-50" onClick={() => setMessage(message + "{username}")}>Insert username</button>
        <span>{message.length}/1000</span>
      </div>
    </div>
  );

  const preview = (
    <div className="mx-auto max-w-[260px] rounded-3xl border-4 border-[#30343a] bg-white p-4">
      <div className="border-b border-[#e5e7eb] pb-3 text-center text-sm font-semibold">Instagram</div>
      <p className="mt-4 whitespace-pre-wrap break-words rounded-2xl bg-[#f0f1f3] p-3 text-sm">
        {message.trim() || "Your message appears here."}
      </p>
    </div>
  );

  return (
    <section className="overflow-hidden rounded-lg border border-[#dfe1e5] bg-[#f3f3f4]">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-[#dfe1e5] bg-white px-5 py-3">
        <div className="flex items-center gap-3">
          <button className={control} onClick={onBack} aria-label="Back to sequence">←</button>
          <h1 className="text-lg font-semibold">Edit</h1>
        </div>
        <div className="flex flex-wrap gap-2">
          <button className={control} onClick={() => { setBasic(!basic); setPanel(undefined); }}>
            Go to {basic ? "Flow" : "Basic"} Builder
          </button>
          <button className={control} onClick={() => setPanel(panel === "preview" ? undefined : "preview")}>Preview</button>
          {editable && <button className={blue} disabled={messages.some((step) => !step.message.trim())} onClick={() => onSave(messages.map((step) => ({ ...step, message: step.message.trim() })), ids)}>Save Flow</button>}
        </div>
      </header>

      <div className="relative flex min-h-[calc(100dvh-12rem)] flex-col lg:flex-row">
        {panel && (
          <aside className="z-10 w-full shrink-0 border-r border-[#dfe1e5] bg-white lg:w-[340px]">
            <div className={`flex items-center justify-between gap-2 px-4 py-4 font-semibold ${panel === "triggers" ? "bg-[#ddf6e8]" : panel === "message" ? "bg-[#f1dbf4]" : "bg-[#e5f1ff]"}`}>
              {panel === "triggers" ? "Start automation when…" : panel === "message" ? "Send Message" : "Preview"}
              <button className="px-2" aria-label="Close panel" onClick={() => setPanel(undefined)}>×</button>
            </div>
            <div className="space-y-3 p-4">
              {panel === "message" && composer}
              {panel === "preview" && preview}
              {panel === "triggers" && (
                <>
                  {trigger ? (
                    <>
                      <button className="text-sm text-[#0069dc]" onClick={() => setTrigger(undefined)}>← Instagram triggers</button>
                      <p className="text-sm">Choose a campaign. Its trigger subscribes contacts to the entire sequence.</p>
                      {choices.map((campaign) => (
                        <label key={campaign.id} className="flex items-start gap-2 rounded-lg border border-[#e0e4e8] p-3 text-sm">
                          <input type="checkbox" disabled={!editable} checked={ids.includes(campaign.id)}
                            onChange={(event) => setIds((value) => event.target.checked
                              ? [...value, campaign.id] : value.filter((id) => id !== campaign.id))} />
                          <span>{campaign.name}{!campaign.isActive && " (paused)"}
                            <small className="block text-[#535d6c]">
                              {campaign.matchAnyWord ? "Any word" : campaign.keywords.join(", ")}
                            </small>
                          </span>
                        </label>
                      ))}
                      <Link href="/campaigns/new" className="text-sm font-semibold text-[#0069dc]">Create campaign</Link>
                    </>
                  ) : (
                    <>
                      <input type="search" aria-label="Search in Instagram" placeholder="Search in Instagram"
                        className="w-full rounded-md border border-[#dce0e5] p-2 text-sm"
                        value={search} onChange={(event) => setSearch(event.target.value)} />
                      <h2 className="text-sm font-semibold text-[#0069dc]">Instagram</h2>
                      {triggerTypes.filter((item) => `${item.name} ${item.description}`.toLowerCase().includes(search.toLowerCase())).map((item) => (
                        <button key={item.id} className="block w-full rounded-lg border border-[#e0e4e8] p-3 text-left hover:bg-[#f4f9ff]"
                          onClick={() => setTrigger(item.id)}>
                          <span className="block text-sm font-semibold">{item.name}</span>
                          <span className="text-xs text-[#535d6c]">{item.description}</span>
                        </button>
                      ))}
                    </>
                  )}
                </>
              )}
            </div>
          </aside>
        )}
        {basic ? (
          <div className="grid flex-1 gap-5 p-5 md:grid-cols-2">
            <div className={card}>
              <h2 className="mb-4 text-sm font-semibold">Starting Step</h2>
              <select aria-label="Message step" className={control + " mb-4"} value={index}
                onChange={(event) => setIndex(Number(event.target.value))}>
                {messages.map((_, position) => <option key={position} value={position}>Send Message {position + 1}</option>)}
              </select>
              {composer}
              <button className={control + " mt-4"} onClick={openTriggers}>+ New Trigger</button>
            </div>
            {preview}
          </div>
        ) : (
          <div className="relative flex min-w-0 flex-1 flex-col overflow-auto p-5 lg:p-8">
            <div className="mb-10 flex items-start justify-between gap-4">
              <p className="mx-auto rounded bg-[#e9edf1] px-3 py-1 text-xs text-[#535d6c]">Select a step to edit</p>
              {editable && (
                <div className="relative">
                  <button className="grid size-12 place-items-center rounded-full bg-[#0069dc] text-3xl text-white shadow-md"
                    aria-label="Add step" aria-expanded={addMenu} onClick={() => setAddMenu(!addMenu)}>+</button>
                  {addMenu && <div className="absolute right-0 z-20 mt-2 w-52 rounded-lg border border-[#dfe1e5] bg-white p-2 shadow-lg">
                    <button className="w-full rounded-md p-3 text-left text-sm hover:bg-[#f3f7fc]" onClick={addMessage}>Instagram · Send Message</button>
                  </div>}
                </div>
              )}
            </div>
            <div className="overflow-auto" aria-label="Sequence canvas">
              <div style={{ width: canvasWidth * zoom, height: canvasHeight * zoom }}>
                <div className="relative" style={{ width: canvasWidth, height: canvasHeight, transform: `scale(${zoom})`, transformOrigin: "top left" }}>
                  <svg className="pointer-events-none absolute inset-0" width={canvasWidth} height={canvasHeight} aria-hidden="true">
                    <defs><marker id={marker} markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto">
                      <path d="M0 0 L8 4 L0 8 Z" fill="#8794a5" />
                    </marker></defs>
                    {positions.map(({ x, y }, index) => {
                      const previous = positions[index - 1];
                      const startX = previous ? previous.x + 265 : 275;
                      const startY = previous ? previous.y + 70 : 110;
                      return <path key={index} d={`M${startX},${startY} C${startX + 85},${startY} ${x - 85},${y + 52} ${x},${y + 52}`}
                        stroke="#8794a5" strokeWidth="2" fill="none" markerEnd={`url(#${marker})`} />;
                    })}
                  </svg>
                  <div className={card + " absolute left-4 top-10 max-w-[260px]"}>
                    <h2 className="text-lg font-semibold">⚡ When…</h2>
                    {selected.map((campaign) => <button key={campaign.id} onClick={openTriggers}
                      className="mt-2 block w-full rounded-lg border border-[#a8ddc1] bg-[#eefaf3] p-2 text-left text-sm">{campaign.name}</button>)}
                    <button className="mt-3 w-full rounded-lg border border-dashed border-[#0069dc] p-3 text-sm font-semibold text-[#0069dc]"
                      onClick={openTriggers}>+ New Trigger</button>
                  </div>
                  {messages.map((step, position) => (
                    <div key={position} className={card + " absolute max-w-[265px] !p-0" + (position === index ? " ring-1 ring-green-500" : "")}
                      style={{ left: positions[position].x, top: positions[position].y }}>
                      {editable && <button type="button" aria-label={`Move message ${position + 1}`}
                        className="block w-full touch-none cursor-grab rounded-t-2xl bg-[#f6f0f8] px-4 py-2 text-left text-xs active:cursor-grabbing"
                        onPointerDown={(event) => beginDrag(event, position)} onPointerMove={moveCard}
                        onPointerUp={() => { drag.current = null; }} onLostPointerCapture={() => { drag.current = null; }}>
                        ⠿ Instagram
                      </button>}
                      <button className="block w-full p-4 text-left" aria-pressed={position === index}
                        onClick={() => { setIndex(position); setPanel("message"); }}>
                        <span className="block font-semibold">Send Message{position ? ` #${position + 1}` : ""}</span>
                        <span className="mt-2 line-clamp-2 break-words rounded bg-[#f3f4f6] p-2 text-sm">{step.message || "Add a text"}</span>
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            </div>
            <div className="mt-auto flex justify-end gap-2 pt-10">
              {editable && <button className={control} onClick={() => setMessages((items) =>
                items.map(({ message, delayMinutes }) => ({ message, delayMinutes }))
              )}>Auto Arrange Steps</button>}
              <button className={control} aria-label="Zoom out" onClick={() => setZoom((value) => Math.max(0.65, value - 0.1))}>−</button>
              <button className={control} aria-label="Reset zoom" onClick={() => setZoom(1)}>{Math.round(zoom * 100)}%</button>
              <button className={control} aria-label="Zoom in" onClick={() => setZoom((value) => Math.min(1.25, value + 0.1))}>+</button>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
