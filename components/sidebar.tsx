"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";

const primaryItems = [
  { label: "Home", href: "/dashboard", icon: "⌂" },
  { label: "Automation", href: "/automations", icon: "✳" },
  { label: "Inbox", href: "/inbox", icon: "▤" },
  { label: "Settings", href: "/settings", icon: "⚙" },
] as const;

const unavailableItems = [
  { label: "Contacts", icon: "♙" },
  { label: "AI Automation", icon: "AI" },
  { label: "Broadcasts", icon: "➤" },
] as const;

const utilityItems = [
  { label: "Overview", href: "/overview", icon: "◷" },
  { label: "Campaigns", href: "/campaigns", icon: "▦" },
  { label: "Sequences", href: "/sequences", icon: "⇢" },
  { label: "DM Logs", href: "/logs", icon: "≡" },
  { label: "Diagnostics", href: "/diagnostics", icon: "ⓘ" },
] as const;

interface SidebarProps {
  isOpen: boolean;
  onClose: () => void;
  workspaceName: string;
}

export default function Sidebar({ isOpen, onClose, workspaceName }: SidebarProps) {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);
  const textClass = collapsed ? "lg:sr-only" : "";

  function navClass(active: boolean) {
    return `flex min-h-11 items-center gap-3 rounded-lg px-2.5 text-sm transition-colors ${
      active
        ? "bg-surface-hover font-medium text-foreground"
        : "text-muted hover:bg-surface-hover hover:text-foreground"
    }`;
  }

  return (
    <>
      {isOpen && <div className="fixed inset-0 z-40 bg-black/45 lg:hidden" onClick={onClose} />}
      <aside
        aria-label="Main navigation"
        className={`fixed left-0 top-0 z-50 flex h-dvh max-w-[85vw] shrink-0 flex-col border-r border-border bg-surface transition-all duration-200 ease-out lg:static lg:z-auto ${collapsed ? "lg:w-16" : "lg:w-64"} ${
          isOpen ? "w-64 translate-x-0" : "w-16 -translate-x-full lg:translate-x-0"
        }`}
      >
        <div className={`flex h-16 shrink-0 items-center border-b border-border ${collapsed ? "justify-center" : "px-5"}`}>
          <Link href="/dashboard" onClick={onClose} aria-label="OpenReply home" title="OpenReply"
            className="grid size-9 place-items-center rounded-lg bg-foreground text-sm font-bold text-background">O</Link>
          {!collapsed && <span className="ml-3 text-base font-semibold">OpenReply</span>}
          <button type="button" className="ml-auto hidden rounded-md px-2 py-1 text-sm text-muted hover:bg-surface-hover lg:block" aria-label={collapsed ? "Expand navigation" : "Collapse navigation"} onClick={() => setCollapsed(value => !value)}>{collapsed ? "→" : "←"}</button>
        </div>

        <nav className="flex-1 space-y-1 overflow-y-auto p-2" aria-label="Workspace">
          {primaryItems.slice(0, 1).map((item) => {
            const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
            return <Link key={item.href} href={item.href} onClick={onClose} aria-label={item.label} title={item.label}
              aria-current={active ? "page" : undefined} className={navClass(active)}>
              <span aria-hidden="true" className="grid size-9 shrink-0 place-items-center text-lg">{item.icon}</span><span className={textClass}>{item.label}</span>
            </Link>;
          })}
          {unavailableItems.slice(0, 1).map((item) => (
            <div key={item.label} role="note" aria-label={`${item.label} unavailable`} title={`${item.label} — coming later`}
              className="flex min-h-11 cursor-not-allowed items-center gap-3 rounded-lg px-2.5 text-sm text-muted/60">
              <span aria-hidden="true" className="grid size-9 shrink-0 place-items-center text-lg">{item.icon}</span>
              <span className={textClass}>{item.label}<small className="ml-2 text-xs">Coming later</small></span>
            </div>
          ))}
          {primaryItems.slice(1, 2).map((item) => {
            const active = pathname.startsWith("/automations") || pathname.startsWith("/campaigns") || pathname.startsWith("/sequences");
            return <Link key={item.href} href={item.href} onClick={onClose} aria-label={item.label} title={item.label}
              aria-current={active ? "page" : undefined} className={navClass(active)}>
              <span aria-hidden="true" className="grid size-9 shrink-0 place-items-center text-lg">{item.icon}</span><span className={textClass}>{item.label}</span>
            </Link>;
          })}
          {unavailableItems.slice(1).map((item) => (
            <div key={item.label} role="note" aria-label={`${item.label} unavailable`} title={`${item.label} — coming later`}
              className="flex min-h-11 cursor-not-allowed items-center gap-3 rounded-lg px-2.5 text-sm text-muted/60">
              <span aria-hidden="true" className="grid size-9 shrink-0 place-items-center text-sm font-semibold">{item.icon}</span>
              <span className={textClass}>{item.label}<small className="ml-2 text-xs">Coming later</small></span>
            </div>
          ))}
          {primaryItems.slice(2).map((item) => {
            const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
            return <Link key={item.href} href={item.href} onClick={onClose} aria-label={item.label} title={item.label}
              aria-current={active ? "page" : undefined} className={navClass(active)}>
              <span aria-hidden="true" className="grid size-9 shrink-0 place-items-center text-lg">{item.icon}</span><span className={textClass}>{item.label}</span>
            </Link>;
          })}
        </nav>

        <nav aria-label="OpenReply tools" className="space-y-1 border-t border-border p-2">
          {utilityItems.map((item) => {
            const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
            return <Link key={item.href} href={item.href} onClick={onClose} aria-label={item.label} title={item.label}
              aria-current={active ? "page" : undefined} className={navClass(active)}>
              <span aria-hidden="true" className="grid size-9 shrink-0 place-items-center text-lg">{item.icon}</span><span className={textClass}>{item.label}</span>
            </Link>;
          })}
          <div className={`flex items-center gap-3 px-2.5 py-2 ${collapsed ? "justify-center" : ""}`} title={workspaceName}>
            <span aria-hidden="true" className="grid size-9 shrink-0 place-items-center rounded-full bg-surface-hover text-xs font-semibold text-muted">
              {workspaceName.slice(0, 2).toUpperCase()}
            </span>
            {!collapsed && <span className="truncate text-xs text-muted">{workspaceName}</span>}
          </div>
        </nav>
      </aside>
    </>
  );
}
