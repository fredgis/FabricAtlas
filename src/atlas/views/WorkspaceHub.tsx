import { useEffect, useState } from "react";
import * as Tabs from "@radix-ui/react-tabs";
import { Settings } from "lucide-react";
import {
  DEFAULT_WORKSPACE_SECTION,
  isWorkspaceSection,
  type AtlasFocusRequest,
  type AtlasNavigation,
  type WorkspaceSection,
} from "../navigation";
import { WorkspaceOverviewPanel } from "../components/WorkspaceOverviewPanel";
import { WorkspaceSynchronizationPanel } from "../components/WorkspaceSynchronizationPanel";
import { CommentsView } from "./Comments";
import { ConfigView } from "./Config";

const HUB_TABS: { id: WorkspaceSection; label: string }[] = [
  { id: "workspace", label: "Workspace" },
  { id: "synchronization", label: "Synchronization" },
  { id: "configuration", label: "Configuration" },
  { id: "notes", label: "Team notes" },
];

const PANEL_CLASS =
  "rounded-xl focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring";

export function WorkspaceHubView({
  focus,
  section: initialSection,
  onStateChange,
}: {
  focus?: AtlasFocusRequest;
  /** Last section reported by this view, restored after a workspace switch remounts it. */
  section?: WorkspaceSection;
  onStateChange?: (navigation: AtlasNavigation) => void;
} = {}) {
  const [section, setSection] = useState<WorkspaceSection>(
    initialSection ?? focus?.workspaceSection ?? DEFAULT_WORKSPACE_SECTION,
  );
  const [itemId, setItemId] = useState(focus?.itemId ?? "");
  const commentId = focus?.commentId;

  useEffect(() => {
    onStateChange?.({
      tab: "workspace",
      focus: {
        requestId: "workspace-view-state",
        workspaceSection: section,
        itemId: itemId || undefined,
        commentId,
      },
    });
  }, [commentId, itemId, onStateChange, section]);

  return (
    <Tabs.Root
      value={section}
      onValueChange={(value) => {
        if (isWorkspaceSection(value)) setSection(value);
      }}
      asChild
    >
      <div className="atlas-content-frame flex flex-col gap-l p-xl lg:p-xxl">
        <header className="flex items-center gap-l">
          <span
            aria-hidden="true"
            className="flex icon-size-700 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-fabric-2"
          >
            <Settings className="icon-size-400" />
          </span>
          <div className="min-w-0">
            <h1 className="font-heading text-600 font-bold leading-600">
              Workspace Hub
            </h1>
            <p className="mt-xxs text-300 leading-300 text-muted-foreground">
              Manage workspace scope and synchronization.
            </p>
          </div>
        </header>

        <Tabs.List
          aria-label="Workspace Hub sections"
          className="-mx-xs flex overflow-x-auto border-b border-border px-xs"
        >
          {HUB_TABS.map(({ id, label }) => (
            <Tabs.Trigger
              key={id}
              value={id}
              className="relative flex min-h-[var(--atlas-touch-target)] shrink-0 items-center whitespace-nowrap px-l text-300 text-muted-foreground transition-colors hover:text-foreground focus-visible:ring-inset focus-visible:ring-offset-0 data-[state=active]:font-semibold data-[state=active]:text-brand-foreground data-[state=active]:after:absolute data-[state=active]:after:inset-x-s data-[state=active]:after:bottom-0 data-[state=active]:after:h-xxs data-[state=active]:after:rounded-full data-[state=active]:after:bg-primary dark:data-[state=active]:after:bg-brand-foreground"
            >
              {label}
            </Tabs.Trigger>
          ))}
        </Tabs.List>

        <Tabs.Content value="workspace" className={PANEL_CLASS}>
          <WorkspaceOverviewPanel />
        </Tabs.Content>
        <Tabs.Content value="synchronization" className={PANEL_CLASS}>
          <WorkspaceSynchronizationPanel />
        </Tabs.Content>
        <Tabs.Content value="configuration" className={PANEL_CLASS}>
          <ConfigView
            embedded
            focus={{
              ...focus,
              requestId: focus?.requestId ?? "workspace-local",
              itemId,
            }}
            onSelectedItemChange={setItemId}
          />
        </Tabs.Content>
        <Tabs.Content value="notes" className={PANEL_CLASS}>
          <CommentsView
            embedded
            focus={{
              ...focus,
              requestId: focus?.requestId ?? "workspace-local",
              itemId,
              commentId,
            }}
            onTargetChange={setItemId}
          />
        </Tabs.Content>
      </div>
    </Tabs.Root>
  );
}
