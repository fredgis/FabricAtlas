import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { MessagesSquare, Settings2 } from "lucide-react";
import { useAtlas } from "../store";
import { Card, SectionLabel, cn } from "../ui";
import { CommentsView } from "./Comments";
import { ConfigView } from "./Config";

type HubSection = "configuration" | "notes";

export function WorkspaceHubView() {
  const { data } = useAtlas();
  const [section, setSection] = useState<HubSection>("configuration");

  const tabs = [
    {
      id: "configuration" as const,
      label: "Configuration",
      detail: "Settings, schema and bindings",
      count: data.config.length,
      icon: Settings2,
    },
    {
      id: "notes" as const,
      label: "Team notes",
      detail: "Shared operational context",
      count: data.comments.length,
      icon: MessagesSquare,
    },
  ];

  return (
    <div className="atlas-content-frame flex flex-col gap-l p-xl lg:p-xxl">
      <Card className="overflow-hidden border-primary/25 bg-gradient-to-r from-primary/10 via-card to-lineage-downstream/5">
        <div className="flex flex-col gap-l p-l lg:flex-row lg:items-end lg:justify-between">
          <div>
            <SectionLabel>Operate / workspace context</SectionLabel>
            <h1 className="mt-xs font-heading text-600 font-bold leading-600">
              Workspace hub
            </h1>
            <p className="mt-xs text-300 leading-300 text-muted-foreground">
              Technical configuration and the team context that explains it, kept
              together in one operational workspace.
            </p>
          </div>

          <div
            role="tablist"
            aria-label="Workspace hub section"
            className="grid gap-s sm:grid-cols-2"
          >
            {tabs.map(({ id, label, detail, count, icon: Icon }) => (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={section === id}
                onClick={() => setSection(id)}
                className={cn(
                  "flex min-w-[230px] items-center gap-m rounded-xl border px-m py-s text-left transition-colors",
                  section === id
                    ? "border-primary/50 bg-primary/10 text-foreground"
                    : "border-border bg-background/55 text-muted-foreground hover:bg-accent hover:text-foreground",
                )}
              >
                <span
                  className={cn(
                    "flex icon-size-600 shrink-0 items-center justify-center rounded-lg",
                    section === id
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted text-muted-foreground",
                  )}
                >
                  <Icon className="icon-size-200" aria-hidden="true" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center justify-between gap-s">
                    <span className="text-300 font-semibold">{label}</span>
                    <span className="rounded-full bg-card px-s py-xxs font-numeric text-200 font-semibold">
                      {count}
                    </span>
                  </span>
                  <span className="mt-xxs block text-200">{detail}</span>
                </span>
              </button>
            ))}
          </div>
        </div>
      </Card>

      <AnimatePresence mode="wait">
        <motion.div
          key={section}
          role="tabpanel"
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -6 }}
          transition={{ duration: 0.16, ease: "easeOut" }}
        >
          {section === "configuration" ? (
            <ConfigView embedded />
          ) : (
            <CommentsView embedded />
          )}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}
