"use client";

import SequenceTriggerForm, { type SavedSequenceTrigger } from "@/components/sequence-trigger-form";
import SequenceRouteCanvas from "@/components/sequence-route-canvas";
import { normalizeSequenceGraph, traceSequencePath } from "@/lib/sequences/graph";
import { useState } from "react";

type Step = { id?: string; routes?: Record<string, string | null>; buttons?: { title: string; url: string }[]; position?: { x: number; y: number }; message: string; delayMinutes: number };

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
  { id: "story", name: "Story Reply via DM keyword", description: "User replies to your Story with a matching message" },
] as const;
type Trigger = typeof triggerTypes[number]["id"];

export default function SequenceFlowBuilder({
  steps, initialIndex, campaigns, assignedIds, editable, onBack, onSave, sequenceId, onTriggerAdded,
}: {
  sequenceId: string;
  onTriggerAdded: (trigger: SavedSequenceTrigger) => void;
  steps: Step[];
  initialIndex: number;
  campaigns: Campaign[];
  assignedIds: string[];
  editable: boolean;
  onBack: () => void;
  onSave: (steps: Step[], campaignIds: string[]) => void;
}) {
  const [messages, setMessages] = useState(steps);


  const [index, setIndex] = useState(initialIndex);
  const [moreBlocks, setMoreBlocks] = useState(false);
  const message = messages[index].message;
  const setMessage = (value: string) => setMessages((current) =>
    current.map((step, position) => position === index ? { ...step, message: value } : step)
  );
  function addMessage() {
    const newId = globalThis.crypto.randomUUID();
    setMessages((current) => {
      const identified = current.map((step) => ({ ...step, id: step.id ?? globalThis.crypto.randomUUID() }));
      return [
        ...identified.map((step, position) => position === index
          ? { ...step, routes: { ...step.routes, next: newId } }
          : step),
        { id: newId, routes: { next: null }, message: "", delayMinutes: 0 },
      ];
    });
    setIndex(messages.length);
    setPanel("message");
  }
  const [ids, setIds] = useState(assignedIds);
  const [panel, setPanel] = useState<"triggers" | "message" | "preview" | undefined>("message");
  const [basic, setBasic] = useState(false);
  const [search, setSearch] = useState("");
  const [trigger, setTrigger] = useState<Trigger>();
  const choices = campaigns.filter((campaign) => trigger === "comment" || campaign.dmTriggerEnabled);

  const openTriggers = () => {
    setSearch("");
    setTrigger(undefined);
    setPanel("triggers");
  };

  const buttons = messages[index].buttons ?? [];
  function setButtons(buttons: NonNullable<Step["buttons"]>) {
    setMessages(current => current.map((step, position) => position === index ? { ...step, buttons } : step));
  }
  function updateButton(index: number, value: Partial<NonNullable<Step["buttons"]>[number]>) {
    setButtons(buttons.map((button, position) => position === index ? { ...button, ...value } : button));
  }
  const invalidMessage = messages.some(step => !step.message.trim() || Boolean(step.buttons?.length && (
    step.message.trim().length > 640 || step.buttons.some(button => {
      try { return !button.title.trim() || !["http:", "https:"].includes(new URL(button.url).protocol); }
      catch { return true; }
    })
  )));

  const composer = (
    <div className="space-y-3">
      <p className="border-b border-[#e5e7eb] pb-4 text-sm">Send <span className="font-medium text-[#0069dc]">within 24 hour window</span></p>
      <label className="sr-only" htmlFor="sequence-message-text">Send Message</label>
      <textarea id="sequence-message-text" placeholder="Enter your text…" rows={6}
        className="w-full rounded-lg border border-[#dce0e5] bg-[#f7f7f8] p-3 text-sm outline-offset-2"
        maxLength={1000} readOnly={!editable} value={message} onChange={(event) => setMessage(event.target.value)} />
      <div className="flex justify-between text-xs text-[#535d6c]">
        <button type="button" disabled={!editable || message.length > 990}
          className="font-medium text-[#0069dc] disabled:opacity-50" onClick={() => setMessage(message + "{username}")}>Insert username</button>
        <span>{message.length}/1000</span>
      </div>
      {buttons.map((button, position) => <div key={position} className="grid gap-2 rounded border border-[#dce0e5] p-3 text-sm">
        <label>Button title<input className={control + " w-full"} value={button.title} maxLength={20} readOnly={!editable}
          onChange={event => updateButton(position, { title: event.target.value })} /></label>
        <label>Website URL<input className={control + " w-full"} type="url" value={button.url} readOnly={!editable}
          onChange={event => updateButton(position, { url: event.target.value })} /></label>
        {editable && <button type="button" className={control} onClick={() => setButtons(buttons.filter((_, item) => item !== position))}>Remove button</button>}
      </div>)}
      {editable && buttons.length < 3 && <button type="button" className={control + " w-full"}
        onClick={() => setButtons([...buttons, { title: "", url: "" }])}>+ Add Button</button>}
      {buttons.length > 0 && <p className="text-xs text-[#535d6c]">Website buttons require a title, an HTTP or HTTPS URL, and a message of up to 640 characters.</p>}
      <div className="space-y-2 border-t border-[#e5e7eb] pt-4">
        <p className="text-xs text-[#535d6c]">Content blocks</p>
        <button type="button" className="w-full rounded-lg border border-dashed border-[#cbd1d8] p-3 text-left text-sm"
          onClick={() => document.getElementById("sequence-message-text")?.focus()}>Text</button>
        {["Image", "PDF", "Delay", "Data Collection", ...(moreBlocks ? ["Audio", "Video", "Card", "Gallery", "Dynamic Content"] : [])].map((name) =>
          <button key={name} type="button" disabled className="flex w-full justify-between rounded-lg border border-dashed border-[#cbd1d8] p-3 text-left text-sm text-[#535d6c]">
            <span>{name}</span><span className="text-xs">Unavailable</span>
          </button>)}
        <button type="button" className={control + " w-full text-left"} aria-expanded={moreBlocks}
          onClick={() => setMoreBlocks(!moreBlocks)}>{moreBlocks ? "Show less" : "More"}</button>
      </div>
    </div>
  );

  const preview = (
    <div className="space-y-3">
      <div className="mx-auto max-w-[280px] rounded-3xl border-4 border-[#30343a] bg-white p-4">
        <div className="border-b border-[#e5e7eb] pb-3 text-center text-sm font-semibold">Instagram preview</div>
        {traceSequencePath(messages).map((stepIndex, pathIndex) => (
          <div key={messages[stepIndex].id ?? stepIndex} className="mt-3">
            {pathIndex > 0 && <p className="mb-1 text-center text-xs text-[#697586]">Next Step</p>}
            <p className="whitespace-pre-wrap break-words rounded-2xl bg-[#f0f1f3] p-3 text-sm">
              {messages[stepIndex].message.trim() || "Your message appears here."}
            </p>
            {messages[stepIndex].buttons?.map((button, buttonIndex) => (
              <p key={buttonIndex} className="mt-1 rounded-lg border border-[#dce0e5] p-2 text-center text-sm text-[#0069dc]">
                {button.title || "Website button"}
              </p>
            ))}
          </div>
        ))}
      </div>
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
          {editable && <button className={blue} disabled={invalidMessage} onClick={() => onSave(normalizeSequenceGraph(messages.map((step) => ({ ...step, message: step.message.trim() }))), ids)}>Save Flow</button>}
        </div>
      </header>

      <div className="relative flex min-h-[calc(100dvh-12rem)] flex-col lg:flex-row">
        {panel && (
          <aside className="z-10 max-h-[calc(100dvh-10rem)] w-full shrink-0 overflow-y-auto border-r border-[#dfe1e5] bg-white lg:w-[340px]">
            <div className={`flex items-center justify-between gap-2 px-4 py-4 font-semibold ${panel === "triggers" ? "bg-[#ddf6e8]" : panel === "message" ? "bg-[#f1dbf4]" : "bg-[#e5f1ff]"}`}>
              {panel === "triggers" ? "Start automation when…" : panel === "message" ? `Send Message${index ? ` #${index + 1}` : ""}` : "Preview"}
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
                      {editable && <SequenceTriggerForm key={trigger} sequenceId={sequenceId}
                        type={trigger === "comment" ? "comment" : "dm"} onAdd={(saved) => {
                          setIds((current) => [...current, saved.id]);
                          onTriggerAdded(saved);
                          setTrigger(undefined);
                          setPanel(undefined);
                        }} />}
                      {choices.length > 0 && <p className="text-sm font-medium">Use an existing campaign</p>}
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
          <SequenceRouteCanvas
            steps={messages}
            selectedIndex={index}
            editable={editable}
            onSelectStep={(selectedIndex) => { setIndex(selectedIndex); setPanel("message"); }}
            onMessagesChange={setMessages}
            onAddMessage={addMessage}
            onOpenTriggers={openTriggers}
          />
        )}
      </div>
    </section>
  );
}
