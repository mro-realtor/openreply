"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import CampaignList from "@/components/campaign-list";
import AutomationTemplateChooser from "@/components/automation-template-chooser";
import AutomationTabs from "@/components/automation-tabs";

export default function AutomationWorkspace({
  initialChooserOpen = false,
}: {
  initialChooserOpen?: boolean;
}) {
  const router = useRouter();
  const [chooserOpen, setChooserOpen] = useState(initialChooserOpen);

  function closeChooser() {
    setChooserOpen(false);
    if (initialChooserOpen) router.replace("/automations");
  }

  return (
    <div className="automation-cms space-y-5 [--color-accent:#1682e8] [--color-accent-hover:#086dc9]">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-semibold">My Automations</h2>
          <p className="mt-1 text-sm text-muted">Create and manage your comment-to-DM workflows.</p>
        </div>
        <button
          type="button"
          onClick={() => setChooserOpen(true)}
          className="rounded-md bg-accent px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-accent-hover"
        >
          + New Automation
        </button>
      </header>
      <AutomationTabs active="automations" />
      <CampaignList workspaceMode />
      <AutomationTemplateChooser open={chooserOpen} onClose={closeChooser} />
    </div>
  );
}
