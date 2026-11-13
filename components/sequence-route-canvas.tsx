"use client";

import { useRef, useState, type PointerEvent } from "react";
import {
  normalizeSequenceGraph,
  resolveSequenceRoute,
  validateSequenceGraph,
} from "@/lib/sequences/graph";

type Step = {
  id?: string;
  routes?: Record<string, string | null>;
  buttons?: { title: string; url: string }[];
  position?: { x: number; y: number };
  delayMinutes: number;
  message: string;
};

const control = "rounded-md border border-[#dce0e5] bg-white px-3 py-2 text-sm font-medium hover:bg-[#f7f9fb] disabled:opacity-50";
const card = "w-full rounded-2xl border border-[#e6e8eb] bg-white p-5 text-left shadow-sm";

export default function SequenceRouteCanvas({
  steps,
  selectedIndex,
  editable,
  onSelectStep,
  onMessagesChange,
  onAddMessage,
  onOpenTriggers,
}: {
  steps: Step[];
  selectedIndex: number;
  editable: boolean;
  onSelectStep: (index: number) => void;
  onMessagesChange: (steps: Step[]) => void;
  onAddMessage: () => void;
  onOpenTriggers: () => void;
}) {
  const [zoom, setZoom] = useState(1);
  const [selectedConnection, setSelectedConnection] = useState<number>();
  const [routeError, setRouteError] = useState("");
  const [addMenu, setAddMenu] = useState(false);
  const drag = useRef<{ index: number; x: number; y: number; pointerX: number; pointerY: number } | null>(null);
  const routeDrag = useRef<number | null>(null);
  const pan = useRef<{ x: number; y: number; scrollLeft: number; scrollTop: number } | null>(null);
  const positions = steps.map((step, index) => step.position ?? {
    x: index % 2 ? 710 : 365,
    y: 45 + Math.floor(index / 2) * 210 + (index % 2) * 95,
  });
  const canvasWidth = Math.max(1020, ...positions.map(({ x }) => x + 320));
  const canvasHeight = Math.max(380, ...positions.map(({ y }) => y + 180));
  const currentTarget = resolveSequenceRoute(steps, selectedIndex, "next");

  function changeRoute(sourceIndex: number, targetIndex: number | null) {
    try {
      const graph = normalizeSequenceGraph(steps);
      const changed = graph.map((step, index) => index === sourceIndex
        ? {
            ...step,
            routes: {
              ...step.routes,
              next: targetIndex === null ? null : graph[targetIndex]?.id ?? null,
            },
          }
        : step);
      validateSequenceGraph(changed);
      onMessagesChange(changed);
      setSelectedConnection(sourceIndex);
      setRouteError("");
    } catch (error) {
      setRouteError(error instanceof Error ? error.message : "Could not update this connection.");
    }
  }

  function beginCardDrag(event: PointerEvent<HTMLButtonElement>, index: number) {
    if (!editable || event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = {
      index,
      ...positions[index],
      pointerX: event.clientX,
      pointerY: event.clientY,
    };
    event.stopPropagation();
  }

  function moveCard(event: PointerEvent<HTMLButtonElement>) {
    const start = drag.current;
    if (!start) return;
    const position = {
      x: Math.min(100000, Math.max(0, Math.round(start.x + (event.clientX - start.pointerX) / zoom))),
      y: Math.min(100000, Math.max(0, Math.round(start.y + (event.clientY - start.pointerY) / zoom))),
    };
    onMessagesChange(steps.map((step, index) => index === start.index ? { ...step, position } : step));
  }

  function dropRoute(targetIndex: number) {
    const sourceIndex = routeDrag.current;
    if (sourceIndex === null) return;
    routeDrag.current = null;
    if (sourceIndex !== targetIndex) changeRoute(sourceIndex, targetIndex);
  }

  function beginPan(event: PointerEvent<HTMLDivElement>) {
    if (event.button !== 1 && !(event.button === 0 && event.shiftKey)) return;
    const viewport = event.currentTarget.parentElement;
    if (!viewport) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    pan.current = { x: event.clientX, y: event.clientY, scrollLeft: viewport.scrollLeft, scrollTop: viewport.scrollTop };
    event.preventDefault();
  }

  function movePan(event: PointerEvent<HTMLDivElement>) {
    const start = pan.current;
    const viewport = event.currentTarget.parentElement;
    if (!start || !viewport) return;
    viewport.scrollLeft = start.scrollLeft - (event.clientX - start.x);
    viewport.scrollTop = start.scrollTop - (event.clientY - start.y);
  }

  return (
    <div className="relative flex min-w-0 flex-1 flex-col overflow-auto p-5 lg:p-8" aria-label="Sequence canvas">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="relative">
          {editable && <button type="button" aria-label="Add step" aria-expanded={addMenu}
            className="grid size-12 place-items-center rounded-full bg-[#0069dc] text-3xl text-white shadow-md"
            onClick={() => setAddMenu((open) => !open)}>+</button>}
          {addMenu && editable && <div aria-label="Add a step" className="absolute left-0 top-14 z-20 max-h-[min(68dvh,620px)] w-[min(360px,75vw)] overflow-y-auto rounded-lg border border-[#dfe1e5] bg-white p-4 shadow-xl">
            <section className="mb-4"><h2 className="mb-2 text-sm font-semibold">Starting Step</h2>
              <button className={control + " w-full text-left"} onClick={() => { setAddMenu(false); onOpenTriggers(); }}>Trigger</button>
            </section>
            <section><h2 className="mb-2 text-sm font-semibold">Content</h2>
              <button className={control + " w-full text-left"} onClick={() => { setAddMenu(false); onAddMessage(); }}>Instagram Message</button>
              <button className={control + " mt-2 w-full text-left"} disabled>Messenger · Unavailable</button>
            </section>
            <section className="mt-4"><h2 className="mb-2 text-sm font-semibold">AI</h2><button className={control + " w-full text-left"} disabled>AI Step · Unavailable</button></section>
            <section className="mt-4"><h2 className="mb-2 text-sm font-semibold">Logic</h2>
              {["Actions", "Condition", "Randomizer", "Smart Delay"].map((name) =>
                <button key={name} className={control + " mb-2 w-full text-left"} disabled>{name} · Unavailable</button>)}
            </section>
          </div>}
        </div>
        <p className="mx-auto rounded bg-[#e9edf1] px-3 py-1 text-xs text-[#535d6c]">Select a step to edit</p>
        <label className="flex items-center gap-2 text-xs text-[#535d6c]">
          Select Existing Step
          <select className={control} aria-label="Select Existing Step" disabled={!editable}
            value={currentTarget === null ? "" : String(currentTarget)}
            onChange={(event) => changeRoute(selectedIndex, event.target.value === "" ? null : Number(event.target.value))}>
            <option value="">End flow</option>
            {steps.map((step, index) => index === selectedIndex ? null : (
              <option key={step.id ?? index} value={index}>Send Message{index ? ` #${index + 1}` : ""}</option>
            ))}
          </select>
        </label>
        {selectedConnection !== undefined && resolveSequenceRoute(steps, selectedConnection, "next") !== null && editable && (
          <button className={control} onClick={() => changeRoute(selectedConnection, null)}>Remove connection</button>
        )}
      </div>
      {routeError && <p role="alert" className="mb-3 text-sm text-red-700">{routeError}</p>}
      <div className="flex-1 overflow-auto rounded-lg" aria-label="Flow canvas viewport">
        <div style={{ width: canvasWidth * zoom, height: canvasHeight * zoom }}>
          <div
            className="relative"
            style={{ width: canvasWidth, height: canvasHeight, transform: `scale(${zoom})`, transformOrigin: "top left" }}
            onPointerDown={beginPan}
            onPointerMove={movePan}
            onPointerUp={() => { pan.current = null; routeDrag.current = null; }}
            onPointerCancel={() => { pan.current = null; routeDrag.current = null; }}
          >
            <svg className="absolute inset-0 overflow-visible" width={canvasWidth} height={canvasHeight} aria-label="Sequence connections">
              <defs><marker id="sequence-route-arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto">
                <path d="M0 0 L8 4 L0 8 Z" fill="#8794a5" />
              </marker></defs>
              <path
                d={`M275,110 C330,110 310,${positions[0]?.y ?? 110} ${positions[0]?.x ?? 365},${(positions[0]?.y ?? 58) + 52}`}
                stroke="#8794a5" strokeWidth="2" fill="none" markerEnd="url(#sequence-route-arrow)" pointerEvents="none"
              />
              {steps.map((step, index) => {
                const targetIndex = resolveSequenceRoute(steps, index, "next");
                if (targetIndex === null) return null;
                const source = positions[index];
                const target = positions[targetIndex];
                const selected = selectedConnection === index;
                const startX = source.x + 265;
                const startY = source.y + 70;
                return (
                  <path key={step.id ?? index}
                    d={`M${startX},${startY} C${startX + 85},${startY} ${target.x - 85},${target.y + 52} ${target.x},${target.y + 52}`}
                    stroke={selected ? "#0069dc" : "#8794a5"} strokeWidth={selected ? 3 : 2} fill="none"
                    markerEnd="url(#sequence-route-arrow)" pointerEvents="stroke" className="cursor-pointer"
                    aria-label={`Next Step from message ${index + 1} to message ${targetIndex + 1}`}
                    onClick={(event) => { event.stopPropagation(); setSelectedConnection(index); onSelectStep(index); }}
                  />
                );
              })}
            </svg>
            <div className={card + " absolute left-4 top-10 max-w-[260px]"}>
              <h2 className="text-lg font-semibold">⚡ When…</h2>
              <p className="mt-2 rounded-lg border border-[#a8ddc1] bg-[#eefaf3] p-2 text-sm">Sequence trigger</p>
            </div>
            {steps.map((step, index) => (
              <div key={step.id ?? index}
                className={card + " absolute max-w-[265px] !p-0" + (index === selectedIndex ? " ring-1 ring-green-500" : "")}
                style={{ left: positions[index].x, top: positions[index].y }}
                onPointerUp={() => dropRoute(index)}
              >
                {editable && <button type="button" aria-label={`Move message ${index + 1}`}
                  className="block w-full touch-none cursor-grab rounded-t-2xl bg-[#f6f0f8] px-4 py-2 text-left text-xs active:cursor-grabbing"
                  onPointerDown={(event) => beginCardDrag(event, index)}
                  onPointerMove={moveCard}
                  onPointerUp={() => { drag.current = null; }}
                  onLostPointerCapture={() => { drag.current = null; }}>
                  ⠿ Instagram
                </button>}
                <button className="block w-full p-4 text-left" aria-pressed={index === selectedIndex}
                  onClick={() => onSelectStep(index)}>
                  <span className="block font-semibold">Send Message{index ? ` #${index + 1}` : ""}</span>
                  <span className="mt-2 line-clamp-2 break-words rounded bg-[#f3f4f6] p-2 text-sm">{step.message || "Add a text"}</span>
                  {step.buttons?.map((button, buttonIndex) => <span key={buttonIndex}
                    className="mt-1 block rounded bg-[#f3f4f6] p-2 text-center text-xs text-[#0069dc]">{button.title || "Website button"}</span>)}
                </button>
                {editable && <button type="button" aria-label={`Connect Next Step from message ${index + 1}`}
                  className="absolute -right-2 top-1/2 grid size-5 -translate-y-1/2 place-items-center rounded-full border-2 border-white bg-[#0069dc] text-xs text-white shadow"
                  onPointerDown={(event) => { event.stopPropagation(); if (event.button === 0) routeDrag.current = index; }}
                  onPointerUp={(event) => event.stopPropagation()}
                  onClick={() => { setSelectedConnection(index); onSelectStep(index); }}>●</button>}
              </div>
            ))}
          </div>
        </div>
      </div>
      <div className="mt-auto flex justify-end gap-2 pt-6">
        {editable && <button className={control} onClick={() => onMessagesChange(steps.map((step) => ({ ...step, position: undefined })))}>
          Auto Arrange Steps
        </button>}
        <button className={control} aria-label="Zoom out" onClick={() => setZoom((value) => Math.max(0.65, value - 0.1))}>−</button>
        <button className={control} aria-label="Reset zoom" onClick={() => setZoom(1)}>{Math.round(zoom * 100)}%</button>
        <button className={control} aria-label="Zoom in" onClick={() => setZoom((value) => Math.min(1.25, value + 0.1))}>+</button>
      </div>
    </div>
  );
}
