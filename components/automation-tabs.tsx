import Link from "next/link";

const tabs = [
  { label: "My Automations", href: "/automations", id: "automations" },
  { label: "Basic", href: "/automations/basic", id: "basic" },
  { label: "Sequences", href: "/sequences", id: "sequences" },
] as const;

export default function AutomationTabs({ active }: { active: (typeof tabs)[number]["id"] }) {
  return (
    <nav aria-label="Automation sections" className="mb-6 flex gap-1 overflow-x-auto border-b border-border">
      {tabs.map((tab) => (
        <Link
          key={tab.id}
          href={tab.href}
          aria-current={active === tab.id ? "page" : undefined}
          className={`shrink-0 border-b-2 px-4 py-3 text-sm font-medium transition-colors ${
            active === tab.id
              ? "border-accent text-foreground"
              : "border-transparent text-muted hover:text-foreground"
          }`}
        >
          {tab.label}
        </Link>
      ))}
    </nav>
  );
}
