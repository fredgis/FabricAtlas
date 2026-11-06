import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import {
  Activity,
  AlertTriangle,
  ArrowUpRight,
  BadgeCheck,
  Check,
  Code2,
  Copy,
  Database,
  Eye,
  Globe,
  Loader2,
  Lock,
  RotateCcw,
  Send,
  Sparkles,
  Square,
  UserRound,
  type LucideIcon,
} from "lucide-react";
import { ATLAS_CONFIG } from "../config";
import { acquireScoutToken } from "../live-sync";
import {
  createScoutClient,
  isScoutConfigured,
  ScoutError,
  type ScoutClient,
  type ScoutEvidence,
  type ScoutPhase,
} from "../scout";
import {
  classifyScoutCell,
  parseScoutInline,
  parseScoutMarkdown,
  tokenizeSql,
  type ScoutBlock,
  type ScoutTone,
} from "../scout-markdown";
import { useAtlas } from "../store";
import { Card, cn } from "../ui";

interface Suggestion {
  pillar: string;
  icon: LucideIcon;
  tone: string;
  title: string;
  question: string;
}

const SUGGESTIONS: Suggestion[] = [
  {
    pillar: "Scorecard",
    icon: Sparkles,
    tone: "text-fabric-purple bg-fabric-purple/10",
    title: "Governance scorecard",
    question: "Give me the governance scorecard of each workspace with the top 3 priority findings.",
  },
  {
    pillar: "Health",
    icon: Activity,
    tone: "text-status-failing bg-status-failing/10",
    title: "Failures and blast radius",
    question: "Which items are failing and what lineage do they break downstream?",
  },
  {
    pillar: "Protect",
    icon: Globe,
    tone: "text-status-warning bg-status-warning/10",
    title: "External exposure",
    question: "Which items are shared with external users or guests?",
  },
  {
    pillar: "Protect",
    icon: Lock,
    tone: "text-fabric-blue bg-fabric-blue/10",
    title: "Label coverage",
    question: "What is the sensitivity label and endorsement coverage per workspace?",
  },
  {
    pillar: "Trust",
    icon: BadgeCheck,
    tone: "text-status-healthy bg-status-healthy/10",
    title: "Endorsement gaps",
    question: "Which semantic models and reports are used most but are not endorsed?",
  },
  {
    pillar: "Ownership",
    icon: UserRound,
    tone: "text-fabric-teal bg-fabric-teal/10",
    title: "Orphan items",
    question: "Which items have no owner or no description?",
  },
];

const PHASES: { id: ScoutPhase; label: string }[] = [
  { id: "connecting", label: "Opening a secure session" },
  { id: "thinking", label: "Understanding the question" },
  { id: "querying", label: "Querying the Atlas store" },
  { id: "writing", label: "Writing the answer" },
];

const TONE_PILL: Record<ScoutTone, string> = {
  healthy: "border-status-healthy/30 bg-status-healthy/10 text-status-healthy",
  warning: "border-status-warning/30 bg-status-warning/10 text-status-warning",
  failing: "border-status-failing/30 bg-status-failing/10 text-status-failing",
};

interface ChatTurn {
  id: number;
  question: string;
  phase: ScoutPhase;
  startedAt: number;
  answer?: string;
  evidence?: ScoutEvidence;
  error?: string;
  durationMs?: number;
}

function ScoutOrb({ size, busy = false }: { size: number; busy?: boolean }) {
  return (
    <div className="atlas-scout-orb" style={{ width: size, height: size }} aria-hidden="true">
      <div className={cn("atlas-scout-sweep", busy && "atlas-scout-sweep-fast")} />
      <svg viewBox="0 0 100 100" className="absolute inset-0 h-full w-full">
        <circle cx="50" cy="50" r="46" fill="none" stroke="currentColor" className="text-border" strokeWidth="0.6" />
        <circle
          cx="50" cy="50" r="36" fill="none" stroke="currentColor" strokeWidth="0.8" strokeDasharray="3 5"
          className="atlas-scout-ring text-fabric-teal"
        />
        <circle
          cx="50" cy="50" r="24" fill="none" stroke="currentColor" strokeWidth="0.8" strokeDasharray="10 6"
          className="atlas-scout-ring atlas-scout-ring-reverse text-fabric-purple"
        />
        {[
          [22, 30, 0],
          [76, 26, 0.6],
          [80, 68, 1.2],
          [28, 74, 1.8],
          [50, 12, 0.9],
        ].map(([cx, cy, delay]) => (
          <circle
            key={`${cx}-${cy}`}
            cx={cx} cy={cy} r="2.4"
            className="atlas-scout-node fill-fabric-blue"
            style={{ animationDelay: `${delay}s` }}
          />
        ))}
      </svg>
      <div className="absolute inset-0 flex items-center justify-center">
        <Sparkles className="text-primary" style={{ width: size * 0.26, height: size * 0.26 }} />
      </div>
    </div>
  );
}

function Inline({ text }: { text: string }) {
  return (
    <>
      {parseScoutInline(text).map((part, index) =>
        part.kind === "strong" ? (
          <strong key={index} className="font-semibold text-foreground">{part.text}</strong>
        ) : part.kind === "code" ? (
          <code key={index} className="rounded-sm bg-muted px-xxs font-mono text-[0.92em]">{part.text}</code>
        ) : (
          <Fragment key={index}>{part.text}</Fragment>
        ),
      )}
    </>
  );
}

function SqlCode({ sql }: { sql: string }) {
  return (
    <code>
      {tokenizeSql(sql).map((token, index) =>
        token.kind === "text" ? (
          <Fragment key={index}>{token.text}</Fragment>
        ) : (
          <span key={index} className={`atlas-scout-sql-${token.kind}`}>{token.text}</span>
        ),
      )}
    </code>
  );
}

function Cell({ value }: { value: string }) {
  const cell = classifyScoutCell(value);
  if (cell.kind === "percent") {
    const tone = cell.value >= 80 ? "bg-status-healthy" : cell.value >= 50 ? "bg-status-warning" : "bg-status-failing";
    return (
      <div className="flex min-w-[110px] items-center gap-s">
        <div className="h-[6px] flex-1 overflow-hidden rounded-full bg-muted">
          <motion.div
            className={cn("h-full rounded-full", tone)}
            initial={{ width: 0 }}
            animate={{ width: `${cell.value}%` }}
            transition={{ duration: 0.8, ease: "easeOut" }}
          />
        </div>
        <span className="w-[44px] text-right font-semibold tabular-nums">{cell.text}</span>
      </div>
    );
  }
  if (cell.kind === "status") {
    return (
      <span className={cn("inline-flex rounded-full border px-s py-[1px] text-100 font-semibold", TONE_PILL[cell.tone])}>
        {cell.text}
      </span>
    );
  }
  if (cell.kind === "number") return <span className="block text-right font-semibold tabular-nums">{cell.text}</span>;
  return <Inline text={cell.text} />;
}

function Block({ block }: { block: ScoutBlock }): ReactNode {
  switch (block.kind) {
    case "heading":
      return (
        <div className={cn("flex items-center gap-s font-semibold", block.level <= 2 ? "text-400" : "text-300")}>
          <span className="h-[14px] w-[3px] rounded-full bg-gradient-to-b from-fabric-purple to-fabric-teal" aria-hidden="true" />
          <Inline text={block.text} />
        </div>
      );
    case "list":
      return (
        <ol className="flex flex-col gap-xs">
          {block.items.map((item, index) => (
            <li key={index} className="flex gap-s">
              <span
                className={cn(
                  "mt-[3px] flex h-[18px] min-w-[18px] items-center justify-center rounded-full text-[10px] font-bold",
                  block.ordered ? "bg-primary/10 text-primary" : "bg-transparent",
                )}
                aria-hidden="true"
              >
                {block.ordered ? index + 1 : <span className="h-[6px] w-[6px] rounded-full bg-fabric-teal" />}
              </span>
              <span><Inline text={item} /></span>
            </li>
          ))}
        </ol>
      );
    case "table":
      return (
        <div className="max-w-full overflow-x-auto rounded-lg border border-border bg-background/60">
          <table className="w-full border-collapse text-200">
            <thead>
              <tr className="bg-muted/60">
                {block.header.map((cell, index) => (
                  <th key={index} scope="col" className="whitespace-nowrap px-m py-s text-left text-100 font-semibold uppercase tracking-wide text-muted-foreground">
                    <Inline text={cell} />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {block.rows.map((row, rowIndex) => (
                <motion.tr
                  key={rowIndex}
                  initial={{ opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: Math.min(rowIndex, 12) * 0.035 }}
                  className="border-t border-border transition-colors hover:bg-accent/50"
                >
                  {row.map((cell, index) => (
                    <td key={index} className="px-m py-s align-middle"><Cell value={cell} /></td>
                  ))}
                </motion.tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    case "code":
      return (
        <pre className="max-w-full overflow-x-auto rounded-lg border border-border bg-muted/40 p-m font-mono text-100 leading-200">
          {block.language.toLowerCase() === "sql" ? <SqlCode sql={block.text} /> : block.text}
        </pre>
      );
    default:
      return <p><Inline text={block.text} /></p>;
  }
}

function ScoutAnswerText({ text }: { text: string }) {
  const blocks = useMemo(() => parseScoutMarkdown(text), [text]);
  return (
    <div className="flex flex-col gap-m text-300 leading-400 text-foreground/90">
      {blocks.map((block, index) => (
        <motion.div
          key={index}
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: Math.min(index, 10) * 0.06, duration: 0.3 }}
        >
          <Block block={block} />
        </motion.div>
      ))}
    </div>
  );
}

function Evidence({ evidence }: { evidence: ScoutEvidence }) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState<number | null>(null);
  if (!evidence.sql.length && !evidence.results.length) return null;
  const copy = (sql: string, index: number) => {
    void navigator.clipboard?.writeText(sql).then(() => {
      setCopied(index);
      window.setTimeout(() => setCopied(null), 1500);
    });
  };
  return (
    <div className="rounded-lg border border-border bg-muted/20">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className="flex w-full items-center gap-s px-m py-s text-left text-200 font-semibold text-muted-foreground transition-colors hover:text-foreground"
      >
        <Code2 className="icon-size-100 text-fabric-purple" aria-hidden="true" />
        Evidence
        <span className="rounded-full bg-fabric-purple/10 px-s text-100 text-fabric-purple">
          {evidence.sql.length} SQL
        </span>
        {evidence.results.length > 0 && (
          <span className="rounded-full bg-fabric-teal/10 px-s text-100 text-fabric-teal">
            {evidence.results.length} result{evidence.results.length > 1 ? "s" : ""}
          </span>
        )}
        <motion.span className="ml-auto" animate={{ rotate: open ? 90 : 0 }} aria-hidden="true">
          <ArrowUpRight className="icon-size-100" />
        </motion.span>
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.25 }}
            className="overflow-hidden"
          >
            <div className="flex flex-col gap-m border-t border-border p-m">
              {evidence.sql.map((sql, index) => (
                <div key={`sql-${index}`} className="relative">
                  <button
                    type="button"
                    onClick={() => copy(sql, index)}
                    className="absolute right-s top-s inline-flex items-center gap-xxs rounded-md border border-border bg-card px-s py-[2px] text-100 hover:bg-accent"
                  >
                    {copied === index ? <Check className="icon-size-100 text-status-healthy" /> : <Copy className="icon-size-100" />}
                    {copied === index ? "Copied" : "Copy"}
                  </button>
                  <pre className="max-w-full overflow-x-auto rounded-md border border-border bg-background p-m pr-[84px] font-mono text-100 leading-200">
                    <SqlCode sql={sql} />
                  </pre>
                </div>
              ))}
              {evidence.results.map((table, index) => (
                <ScoutAnswerText key={`result-${index}`} text={table} />
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function Thinking({ phase, startedAt }: { phase: ScoutPhase; startedAt: number }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(timer);
  }, []);
  const current = PHASES.findIndex((item) => item.id === phase);
  return (
    <Card className="relative flex flex-col gap-s overflow-hidden p-l">
      <div className="atlas-scout-shimmer absolute inset-x-0 top-0 h-[2px]" aria-hidden="true" />
      {PHASES.map((item, index) => {
        const done = index < current;
        const active = index === current;
        return (
          <motion.div
            key={item.id}
            initial={{ opacity: 0, x: -8 }}
            animate={{ opacity: done || active ? 1 : 0.4, x: 0 }}
            transition={{ delay: index * 0.05 }}
            className="flex items-center gap-s text-200"
          >
            <span
              className={cn(
                "flex h-[20px] w-[20px] items-center justify-center rounded-full border",
                done && "border-status-healthy bg-status-healthy text-white",
                active && "border-primary text-primary",
                !done && !active && "border-border",
              )}
            >
              {done ? <Check className="h-[12px] w-[12px]" /> : active ? <Loader2 className="h-[12px] w-[12px] animate-spin" /> : null}
            </span>
            <span className={cn(active && "font-semibold")}>{item.label}</span>
            {active && (
              <span className="ml-auto tabular-nums text-100 text-muted-foreground">
                {Math.max(0, Math.round((now - startedAt) / 1000))}s
              </span>
            )}
          </motion.div>
        );
      })}
    </Card>
  );
}

function NotConfigured({ reason }: { reason: string }) {
  return (
    <Card className="flex flex-col gap-s p-l">
      <div className="flex items-center gap-s text-300 font-semibold">
        <AlertTriangle className="icon-size-200 text-status-warning" aria-hidden="true" />
        Atlas Scout is not available
      </div>
      <p className="text-200 leading-300 text-muted-foreground">{reason}</p>
      <ol className="list-decimal pl-l text-200 leading-300 text-muted-foreground">
        <li>Run <code className="font-mono">fabric/data-agent/atlas-scout/provision.py</code> to create and publish the Data Agent on the Atlas SQL database.</li>
        <li>Set <code className="font-mono">RAYFIN_PUBLIC_ATLAS_SCOUT_AGENT_ID</code> in <code className="font-mono">rayfin/.env</code> and redeploy with <code className="font-mono">rayfin up</code>.</li>
      </ol>
    </Card>
  );
}

const clockNow = () => Date.now();

export function ScoutView() {
  const { currentUser, isPreview } = useAtlas();
  const reduceMotion = useReducedMotion();
  const configured = isScoutConfigured({ workspaceId: ATLAS_CONFIG.scoutWorkspaceId, agentId: ATLAS_CONFIG.scoutAgentId });
  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const threadRef = useRef<string | undefined>(undefined);
  const abortRef = useRef<AbortController | null>(null);
  const nextId = useRef(1);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const started = turns.length > 0;

  // The provider may pass a fresh currentUser object on every render; key the client on the
  // identity values so re-renders never abort an in-flight question.
  const { id: userId, name: userName, email: userEmail } = currentUser;
  const client = useMemo<ScoutClient | null>(
    () =>
      configured && !isPreview
        ? createScoutClient({
            endpoint: { workspaceId: ATLAS_CONFIG.scoutWorkspaceId, agentId: ATLAS_CONFIG.scoutAgentId },
            getToken: (signal) => acquireScoutToken({ id: userId, name: userName, email: userEmail }, signal),
          })
        : null,
    [configured, isPreview, userId, userName, userEmail],
  );

  useEffect(
    () => () => {
      abortRef.current?.abort();
      if (threadRef.current) void client?.endThread(threadRef.current);
    },
    [client],
  );

  useEffect(() => {
    bottomRef.current?.scrollIntoView?.({ block: "end", behavior: reduceMotion ? "auto" : "smooth" });
  }, [turns, busy, reduceMotion]);

  const update = (id: number, patch: Partial<ChatTurn>) =>
    setTurns((current) => current.map((turn) => (turn.id === id ? { ...turn, ...patch } : turn)));

  const ask = async (question: string) => {
    const text = question.trim();
    if (!client || !text || busy) return;
    const id = nextId.current++;
    const startedAt = clockNow();
    setTurns((current) => [...current, { id, question: text, phase: "connecting", startedAt }]);
    setDraft("");
    setBusy(true);
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const answer = await client.ask(text, threadRef.current, controller.signal, (phase) => update(id, { phase }));
      threadRef.current = answer.threadId;
      update(id, { answer: answer.text, evidence: answer.evidence, durationMs: clockNow() - startedAt });
    } catch (error) {
      const message = controller.signal.aborted
        ? "Stopped."
        : error instanceof ScoutError
          ? error.message
          : error instanceof Error && /consent|AADSTS65001|interaction_required|popup/i.test(error.message)
            ? "Consent to DataAgent.Execute.All is required. Allow pop-ups for Atlas and retry, or ask an Entra admin to grant tenant-wide consent."
            : error instanceof Error
              ? error.message
              : "Atlas Scout failed.";
      update(id, { error: message });
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
      setBusy(false);
      inputRef.current?.focus();
    }
  };

  const reset = () => {
    abortRef.current?.abort();
    if (threadRef.current) void client?.endThread(threadRef.current);
    threadRef.current = undefined;
    setTurns([]);
    setBusy(false);
  };

  const enter = reduceMotion ? { opacity: 0 } : { opacity: 0, y: 16 };

  return (
    <div className="atlas-content-frame flex min-h-full flex-col gap-l p-l sm:p-xxl">
      <motion.section
        layout
        initial={reduceMotion ? { opacity: 0 } : { opacity: 0, scale: 0.98, y: 12 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
        className="atlas-scout-hero relative overflow-hidden rounded-2xl border border-border shadow-fabric-4"
      >
        <div className="atlas-sync-grid pointer-events-none absolute inset-0 opacity-40" aria-hidden="true" />
        <motion.div
          layout
          className={cn("relative flex items-center", started ? "gap-m p-m sm:px-l" : "flex-col gap-l p-xl text-center sm:flex-row sm:p-xxl sm:text-left")}
        >
          <motion.div
            layout
            initial={reduceMotion ? false : { scale: 0.4, rotate: -40, opacity: 0 }}
            animate={{ scale: 1, rotate: 0, opacity: 1 }}
            transition={{ type: "spring", stiffness: 140, damping: 16, delay: 0.1 }}
          >
            <ScoutOrb size={started ? 48 : 148} busy={busy} />
          </motion.div>
          <motion.div layout className="flex min-w-0 flex-1 flex-col gap-xs">
            <motion.div
              initial={enter}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.25 }}
              className={cn("flex flex-wrap items-center gap-s", !started && "justify-center sm:justify-start")}
            >
              <h1 className={cn("font-semibold tracking-tight", started ? "text-500" : "text-[2.25rem] leading-tight")}>
                <span className="bg-gradient-to-r from-fabric-purple via-fabric-blue to-fabric-teal bg-clip-text text-transparent">Atlas Scout</span>
              </h1>
              <span className="inline-flex items-center gap-xxs rounded-full border border-status-healthy/30 bg-status-healthy/10 px-s py-[2px] text-100 font-semibold text-status-healthy">
                <Database className="h-[12px] w-[12px]" aria-hidden="true" />
                Fabric Data Agent · read-only
              </span>
            </motion.div>
            {!started && (
              <motion.p
                initial={enter}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.38 }}
                className="max-w-[640px] text-300 leading-400 text-muted-foreground"
              >
                Ask governance questions in plain language. Scout queries the Atlas store, explains what it
                found across Health, Protect and Trust, and shows the SQL behind every answer.
              </motion.p>
            )}
          </motion.div>
          {started && (
            <motion.button
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              type="button"
              onClick={reset}
              className="inline-flex items-center gap-xs rounded-md border border-border bg-background px-m py-xs text-200 font-semibold transition-colors hover:bg-accent"
            >
              <RotateCcw className="icon-size-100" aria-hidden="true" />
              New conversation
            </motion.button>
          )}
        </motion.div>
      </motion.section>

      {isPreview ? (
        <NotConfigured reason="Atlas Scout queries the live Atlas SQL database and is not available in preview mode." />
      ) : !configured ? (
        <NotConfigured reason="No Data Agent is configured for this deployment." />
      ) : (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.5 }}
            className="flex items-center gap-s text-100 text-muted-foreground"
          >
            <Eye className="icon-size-100 shrink-0 text-status-warning" aria-hidden="true" />
            v1 sees every synchronized workspace in the Atlas store, regardless of your workspace roles.
          </motion.div>

          <AnimatePresence>
            {!started && (
              <motion.div
                key="suggestions"
                exit={{ opacity: 0, y: -8, transition: { duration: 0.2 } }}
                className="grid gap-m sm:grid-cols-2 xl:grid-cols-3"
              >
                {SUGGESTIONS.map((suggestion, index) => {
                  const Icon = suggestion.icon;
                  return (
                    <motion.button
                      key={suggestion.title}
                      type="button"
                      initial={enter}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: 0.45 + index * 0.07, duration: 0.35 }}
                      whileHover={reduceMotion ? undefined : { y: -3 }}
                      whileTap={{ scale: 0.98 }}
                      onClick={() => void ask(suggestion.question)}
                      className="group flex flex-col gap-s rounded-xl border border-border bg-card p-l text-left shadow-fabric-2 transition-colors hover:border-primary/40 hover:shadow-fabric-4"
                    >
                      <div className="flex items-center gap-s">
                        <span className={cn("flex h-[32px] w-[32px] items-center justify-center rounded-lg", suggestion.tone)}>
                          <Icon className="icon-size-200" aria-hidden="true" />
                        </span>
                        <span className="text-100 font-semibold uppercase tracking-wide text-muted-foreground">{suggestion.pillar}</span>
                        <ArrowUpRight className="icon-size-100 ml-auto text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" aria-hidden="true" />
                      </div>
                      <span className="text-300 font-semibold">{suggestion.title}</span>
                      <span className="text-200 leading-300 text-muted-foreground">{suggestion.question}</span>
                    </motion.button>
                  );
                })}
              </motion.div>
            )}
          </AnimatePresence>

          <div className="flex flex-col gap-l" aria-live="polite">
            <AnimatePresence initial={false}>
              {turns.map((turn) => (
                <motion.div key={turn.id} layout initial={enter} animate={{ opacity: 1, y: 0 }} className="flex flex-col gap-m">
                  <motion.div
                    initial={reduceMotion ? false : { opacity: 0, x: 24 }}
                    animate={{ opacity: 1, x: 0 }}
                    className="max-w-[85%] self-end rounded-2xl rounded-br-sm bg-gradient-to-br from-primary to-fabric-blue px-l py-s text-300 text-primary-foreground shadow-fabric-2"
                  >
                    {turn.question}
                  </motion.div>
                  <div className="flex items-start gap-m">
                    <ScoutOrb size={36} busy={turn.answer === undefined && !turn.error} />
                    <div className="min-w-0 flex-1">
                      {turn.answer !== undefined ? (
                        <Card className="flex flex-col gap-m p-l">
                          <ScoutAnswerText text={turn.answer} />
                          {turn.evidence && <Evidence evidence={turn.evidence} />}
                          {turn.durationMs !== undefined && (
                            <span className="text-100 text-muted-foreground">
                              Answered in {(turn.durationMs / 1000).toFixed(1)}s from the Atlas store
                            </span>
                          )}
                        </Card>
                      ) : turn.error ? (
                        <motion.div
                          role="alert"
                          initial={reduceMotion ? false : { x: -6 }}
                          animate={{ x: [-6, 6, -3, 0] }}
                          className="flex items-start gap-s rounded-lg border border-status-failing/30 bg-status-failing/10 px-m py-s text-200 leading-300"
                        >
                          <AlertTriangle className="icon-size-200 mt-[2px] shrink-0 text-status-failing" aria-hidden="true" />
                          {turn.error}
                        </motion.div>
                      ) : (
                        <Thinking phase={turn.phase} startedAt={turn.startedAt} />
                      )}
                    </div>
                  </div>
                </motion.div>
              ))}
            </AnimatePresence>
            <div ref={bottomRef} />
          </div>

          <motion.form
            initial={enter}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.6 }}
            className="atlas-scout-composer sticky bottom-0 mt-auto flex items-end gap-s rounded-2xl border border-border bg-card p-s shadow-fabric-4"
            onSubmit={(event) => {
              event.preventDefault();
              void ask(draft);
            }}
          >
            <label htmlFor="atlas-scout-question" className="sr-only">Ask Atlas Scout</label>
            <Sparkles className="icon-size-200 mb-[11px] ml-s shrink-0 text-fabric-purple" aria-hidden="true" />
            <textarea
              ref={inputRef}
              id="atlas-scout-question"
              value={draft}
              rows={2}
              maxLength={2000}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  void ask(draft);
                }
              }}
              placeholder="Ask about health, access, labels, lineage…"
              className="min-h-[44px] flex-1 resize-none bg-transparent px-xs py-xs text-300 outline-none placeholder:text-muted-foreground"
            />
            {busy ? (
              <button
                type="button"
                onClick={() => abortRef.current?.abort()}
                aria-label="Stop"
                className="inline-flex h-[40px] w-[40px] items-center justify-center rounded-xl border border-border bg-background transition-colors hover:bg-accent"
              >
                <Square className="icon-size-100 fill-current" aria-hidden="true" />
              </button>
            ) : (
              <motion.button
                type="submit"
                disabled={!draft.trim()}
                whileTap={{ scale: 0.9 }}
                aria-label="Send question"
                className="inline-flex h-[40px] w-[40px] items-center justify-center rounded-xl bg-gradient-to-br from-fabric-purple to-fabric-blue text-white shadow-fabric-2 transition-opacity disabled:opacity-35"
              >
                <Send className="icon-size-200" aria-hidden="true" />
              </motion.button>
            )}
          </motion.form>
        </>
      )}
    </div>
  );
}
