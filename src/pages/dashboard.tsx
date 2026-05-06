import { useMemo, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import {
  Activity,
  Archive,
  ArrowUpRight,
  Bot,
  BookOpen,
  CalendarDays,
  CheckCircle2,
  CircleAlert,
  Command,
  FolderOpen,
  History,
  Loader2,
  Play,
  Terminal,
  type LucideIcon,
} from "lucide-react";
import { ActivityHeatmap } from "@/components/home";
import { useInvokeQuery, useStreamedSessions } from "@/hooks";
import { useI18n, type Language } from "@/i18n";
import type {
  AgentSession,
  AgentWorkspaceState,
  DistillDocument,
  LocalCommand,
  Project,
  Session,
} from "@/types";

interface ActivityStats {
  daily: Record<string, number>;
  hourly: Record<string, number>;
  detailed: Record<string, number>;
}

const EMPTY_ACTIVITY_STATS: ActivityStats = {
  daily: {},
  hourly: {},
  detailed: {},
};

function formatNumber(value: number, locale: string) {
  return value.toLocaleString(locale);
}

function formatRelativeSeconds(timestamp: number | null | undefined, language: Language, locale: string) {
  if (!timestamp) return language === "zh" ? "暂无活动" : "No activity";
  const diff = Math.max(0, Math.floor(Date.now() / 1000 - timestamp));
  if (diff < 60) return language === "zh" ? "刚刚" : "Just now";
  if (diff < 3600) return language === "zh" ? `${Math.floor(diff / 60)}分钟前` : `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return language === "zh" ? `${Math.floor(diff / 3600)}小时前` : `${Math.floor(diff / 3600)}h ago`;
  if (diff < 604800) return language === "zh" ? `${Math.floor(diff / 86400)}天前` : `${Math.floor(diff / 86400)}d ago`;
  return new Date(timestamp * 1000).toLocaleDateString(locale, {
    month: "short",
    day: "numeric",
  });
}

function formatRelativeMs(timestamp: number | null | undefined, language: Language, locale: string) {
  return timestamp ? formatRelativeSeconds(Math.floor(timestamp / 1000), language, locale) : formatRelativeSeconds(null, language, locale);
}

function projectName(path: string | null | undefined) {
  if (!path) return "Unknown project";
  const clean = path.replace(/\/$/, "");
  return clean.split("/").filter(Boolean).pop() || path;
}

function sessionTitle(session: Session, fallback: string) {
  return session.title || session.summary || session.last_prompt || fallback;
}

function isAgentRunning(session: AgentSession) {
  return session.status === "running" || session.workState === "working";
}

export default function DashboardPage() {
  const navigate = useNavigate();
  const { activeLanguage, locale, t } = useI18n();
  const { sessions, initialLoading, streaming } = useStreamedSessions();
  const { data: projects = [] } = useInvokeQuery<Project[]>(["projects"], "list_projects");
  const { data: activityStats = EMPTY_ACTIVITY_STATS } = useInvokeQuery<ActivityStats>(
    ["activityStats"],
    "get_activity_stats",
  );
  const { data: commands = [] } = useInvokeQuery<LocalCommand[]>(["commands"], "list_local_commands");
  const { data: documents = [] } = useInvokeQuery<DistillDocument[]>(
    ["distillDocuments"],
    "list_distill_documents",
  );
  const { data: agentState } = useInvokeQuery<AgentWorkspaceState>(
    ["agentWorkspaceState"],
    "get_agent_workspace_state",
  );

  const todayKey = new Date().toISOString().slice(0, 10);

  const totals = useMemo(() => {
    const rounds = sessions.reduce((sum, session) => sum + session.rounds, 0);
    const messages = sessions.reduce((sum, session) => sum + session.message_count, 0);
    const projectIds = new Set(sessions.map((session) => session.project_id));
    return { rounds, messages, projects: projectIds.size };
  }, [sessions]);

  const recentSessions = useMemo(
    () => [...sessions].sort((a, b) => b.last_modified - a.last_modified).slice(0, 6),
    [sessions],
  );

  const topProjects = useMemo(() => {
    const knownProjects = new Map(projects.map((project) => [project.id, project]));
    const byProject = new Map<string, { id: string; path: string; count: number; lastActive: number }>();

    for (const session of sessions) {
      const known = knownProjects.get(session.project_id);
      const existing = byProject.get(session.project_id);
      const path = session.project_path || known?.path || session.project_id;
      if (!existing) {
        byProject.set(session.project_id, {
          id: session.project_id,
          path,
          count: 1,
          lastActive: session.last_modified,
        });
      } else {
        existing.count += 1;
        existing.lastActive = Math.max(existing.lastActive, session.last_modified);
      }
    }

    return [...byProject.values()]
      .sort((a, b) => b.lastActive - a.lastActive || b.count - a.count)
      .slice(0, 5);
  }, [projects, sessions]);

  const agentSessions = agentState?.sessions ?? [];
  const activeAgentSessions = agentSessions.filter((session) => !session.archived);
  const runningAgents = activeAgentSessions.filter(isAgentRunning);
  const unreadAgents = activeAgentSessions.filter((session) => session.unread);
  const reviewAgents = activeAgentSessions.filter((session) => session.status === "needs-review");
  const latestAgent = [...activeAgentSessions].sort(
    (a, b) => (b.lastActivityAt || b.updatedAt) - (a.lastActivityAt || a.updatedAt),
  )[0];

  const activeCommands = commands.filter((command) => command.status === "active");
  const deprecatedCommands = commands.filter((command) => command.status === "deprecated");
  const archivedCommands = commands.filter((command) => command.status === "archived");
  const latestDocument = [...documents].sort((a, b) => b.date.localeCompare(a.date))[0];

  const openSession = (session: Session) => {
    navigate(`/history/${encodeURIComponent(session.project_id)}/${encodeURIComponent(session.id)}`);
  };

  const number = (value: number) => formatNumber(value, locale);
  const relativeSeconds = (timestamp: number | null | undefined) => formatRelativeSeconds(timestamp, activeLanguage, locale);
  const relativeMs = (timestamp: number | null | undefined) => formatRelativeMs(timestamp, activeLanguage, locale);
  const sessionStreamLabel = initialLoading
    ? t("dashboard.status.loading")
    : streaming
      ? t("dashboard.status.streaming")
      : t("dashboard.status.ready");

  return (
    <div className="h-full overflow-auto bg-canvas">
      <div className="mx-auto max-w-7xl px-6 py-8 lg:px-8">
        <header className="flex flex-col gap-5 border-b border-border pb-7 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <div className="mb-3 flex items-center gap-3 text-[11px] uppercase tracking-[0.22em] text-muted-foreground">
              <span className="h-px w-8 bg-border" />
              <span>Lovcode</span>
              <span className="h-1 w-1 rounded-full bg-primary/60" />
              <span>{t("dashboard.overview")}</span>
            </div>
            <h1 className="font-serif text-4xl leading-tight text-foreground lg:text-5xl">
              {t("common.dashboard")}
            </h1>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-muted-foreground">
              {t("dashboard.subtitle")}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={() => navigate("/workbench")}
              className="inline-flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 text-sm font-medium text-foreground hover:bg-card-alt"
            >
              <History className="h-4 w-4 text-muted-foreground" />
              {t("common.workbench")}
            </button>
            <button
              onClick={() => navigate("/workbench")}
              className="inline-flex items-center gap-2 rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
            >
              <Play className="h-4 w-4" />
              {t("dashboard.newAgentSession")}
            </button>
          </div>
        </header>

        <section className="mt-7 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-5">
          <MetricCard
            icon={History}
            label={t("dashboard.history")}
            value={number(sessions.length)}
            detail={`${t("dashboard.rounds", { count: number(totals.rounds) })} · ${sessionStreamLabel}`}
          />
          <MetricCard
            icon={Activity}
            label={t("dashboard.today")}
            value={number(activityStats.daily[todayKey] ?? 0)}
            detail={t("dashboard.transcriptMessages", { count: number(totals.messages) })}
          />
          <MetricCard
            icon={Bot}
            label={t("dashboard.agents")}
            value={number(runningAgents.length)}
            detail={t("dashboard.activeUnread", {
              active: number(activeAgentSessions.length),
              unread: number(unreadAgents.length),
            })}
            busy={runningAgents.length > 0}
          />
          <MetricCard
            icon={Command}
            label={t("dashboard.commands")}
            value={number(activeCommands.length)}
            detail={t("dashboard.deprecatedArchived", {
              deprecated: number(deprecatedCommands.length),
              archived: number(archivedCommands.length),
            })}
          />
          <MetricCard
            icon={BookOpen}
            label={t("common.knowledge")}
            value={number(documents.length)}
            detail={latestDocument ? latestDocument.title : t("dashboard.noDistillDocuments")}
          />
        </section>

        <section className="mt-6 grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1.65fr)_minmax(320px,0.85fr)]">
          <Panel
            title={t("dashboard.activity")}
            subtitle={t("dashboard.workspacesRounds", {
              workspaces: number(projects.length || totals.projects),
              rounds: number(totals.rounds),
            })}
            actionLabel={t("dashboard.openWorkbench")}
            onAction={() => navigate("/workbench")}
          >
            <ActivityHeatmap daily={activityStats.daily} detailed={activityStats.detailed} />
          </Panel>

          <Panel title={t("dashboard.modulePulse")} subtitle={t("dashboard.modulePulseSubtitle")}>
            <div className="space-y-2">
              <ModuleRow
                icon={Bot}
                label={t("dashboard.workbenchAgents")}
                value={t("dashboard.runningCount", { count: number(runningAgents.length) })}
                detail={t("dashboard.unreadReview", {
                  unread: number(unreadAgents.length),
                  review: number(reviewAgents.length),
                })}
                status={runningAgents.length > 0 ? t("dashboard.status.running") : reviewAgents.length > 0 ? t("dashboard.status.review") : t("dashboard.status.idle")}
                statusTone={reviewAgents.length > 0 ? "warning" : runningAgents.length > 0 ? "active" : "muted"}
                onClick={() => navigate("/workbench")}
              />
              <ModuleRow
                icon={History}
                label={t("dashboard.history")}
                value={t("dashboard.sessionsCount", { count: number(sessions.length) })}
                detail={t("dashboard.activeProjectViews", { count: number(topProjects.length) })}
                status={sessionStreamLabel}
                statusTone={streaming ? "active" : "ok"}
                onClick={() => navigate("/workbench")}
              />
              <ModuleRow
                icon={Terminal}
                label={t("dashboard.commands")}
                value={t("dashboard.activeCount", { count: number(activeCommands.length) })}
                detail={t("dashboard.localCommandFiles", { count: number(commands.length) })}
                status={deprecatedCommands.length > 0 ? t("dashboard.status.review") : t("dashboard.status.ready")}
                statusTone={deprecatedCommands.length > 0 ? "warning" : "ok"}
                onClick={() => navigate("/commands")}
              />
              <ModuleRow
                icon={BookOpen}
                label={t("common.knowledge")}
                value={t("dashboard.distillsCount", { count: number(documents.length) })}
                detail={latestDocument ? t("dashboard.latest", { title: latestDocument.title }) : t("dashboard.noCapturedDistills")}
                status={documents.length > 0 ? t("dashboard.status.ready") : t("dashboard.status.empty")}
                statusTone={documents.length > 0 ? "ok" : "muted"}
                onClick={() => navigate("/knowledge/distill")}
              />
            </div>
          </Panel>
        </section>

        <section className="mt-5 grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1.15fr)_minmax(360px,0.85fr)]">
          <Panel title={t("dashboard.recentSessions")} subtitle={t("dashboard.recentSessionsSubtitle")}>
            {recentSessions.length > 0 ? (
              <div className="divide-y divide-border">
                {recentSessions.map((session) => (
                  <button
                    key={`${session.project_id}:${session.id}`}
                    onClick={() => openSession(session)}
                    className="group grid w-full grid-cols-[1fr_auto] items-center gap-4 py-3 text-left hover:bg-card-alt"
                  >
                    <div className="min-w-0">
                      <div className="flex min-w-0 items-center gap-2">
                        <MessageDot source={session.source} />
                        <span className="truncate text-sm font-medium text-foreground">
                          {sessionTitle(session, t("dashboard.untitledSession"))}
                        </span>
                      </div>
                      <div className="mt-1 flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
                        <FolderOpen className="h-3.5 w-3.5 shrink-0" />
                        <span className="truncate">{projectName(session.project_path || session.project_id)}</span>
                        <span className="shrink-0">·</span>
                        <span className="shrink-0">{relativeSeconds(session.last_modified)}</span>
                      </div>
                    </div>
                    <ArrowUpRight className="h-4 w-4 text-muted-foreground/50 group-hover:text-primary" />
                  </button>
                ))}
              </div>
            ) : (
              <EmptyPanel icon={History} label={initialLoading ? t("dashboard.loadingSessions") : t("dashboard.noSessionsYet")} />
            )}
          </Panel>

          <Panel
            title={t("dashboard.workbenchAgents")}
            subtitle={latestAgent
              ? t("dashboard.latestActivity", { time: relativeMs(latestAgent.lastActivityAt || latestAgent.updatedAt) })
              : t("dashboard.noActiveAgentSessions")}
            actionLabel={t("dashboard.openWorkbench")}
            onAction={() => navigate("/workbench")}
          >
            <div className="space-y-3">
              <div className="grid grid-cols-3 border-y border-border py-3">
                <CompactStat label={t("dashboard.status.running")} value={runningAgents.length} />
                <CompactStat label={t("dashboard.unread")} value={unreadAgents.length} />
                <CompactStat label={t("dashboard.status.review")} value={reviewAgents.length} />
              </div>
              {latestAgent ? (
                <button
                  onClick={() => navigate("/workbench")}
                  className="group flex w-full items-center gap-3 rounded-lg px-2 py-3 text-left hover:bg-card-alt"
                >
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                    {isAgentRunning(latestAgent) ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Bot className="h-4 w-4" />
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium text-foreground">
                      {latestAgent.title}
                    </div>
                    <div className="mt-1 truncate text-xs text-muted-foreground">
                      {projectName(latestAgent.cwd)} · {latestAgent.provider}
                    </div>
                  </div>
                  <StatusBadge
                    label={latestAgent.status === "needs-review" ? t("dashboard.status.review") : isAgentRunning(latestAgent) ? t("dashboard.status.running") : t("dashboard.status.idle")}
                    tone={latestAgent.status === "needs-review" ? "warning" : isAgentRunning(latestAgent) ? "active" : "muted"}
                  />
                </button>
              ) : (
                <EmptyPanel icon={Bot} label={t("dashboard.createAgentSession")} />
              )}
            </div>
          </Panel>
        </section>

        <section className="mt-5 grid grid-cols-1 gap-4 lg:grid-cols-3">
          <ModuleCard
            icon={Terminal}
            title={t("dashboard.commandLibrary")}
            description={t("dashboard.commandLibraryDescription", {
              commands: number(commands.length),
              deprecated: number(deprecatedCommands.length),
            })}
            action={t("dashboard.manageCommands")}
            onClick={() => navigate("/commands")}
          />
          <ModuleCard
            icon={Archive}
            title={t("dashboard.knowledgeDistill")}
            description={latestDocument ? t("dashboard.latestCapture", { title: latestDocument.title }) : t("dashboard.noDistilledNotes")}
            action={t("dashboard.openKnowledge")}
            onClick={() => navigate("/knowledge/distill")}
          />
          <ModuleCard
            icon={CalendarDays}
            title={t("common.events")}
            description={t("dashboard.eventsDescription")}
            action={t("dashboard.openEvents")}
            onClick={() => navigate("/events")}
          />
        </section>
      </div>
    </div>
  );
}

function MetricCard({
  icon: Icon,
  label,
  value,
  detail,
  busy = false,
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  detail: string;
  busy?: boolean;
}) {
  return (
    <div className="rounded-xl border border-border bg-card px-4 py-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">
            {label}
          </div>
          <div className="mt-3 font-serif text-3xl leading-none text-foreground tabular-nums">
            {value}
          </div>
        </div>
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Icon className="h-4 w-4" />}
        </div>
      </div>
      <div className="mt-3 truncate text-xs text-muted-foreground">{detail}</div>
    </div>
  );
}

function Panel({
  title,
  subtitle,
  actionLabel,
  onAction,
  children,
}: {
  title: string;
  subtitle?: string;
  actionLabel?: string;
  onAction?: () => void;
  children: ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-border bg-card p-5">
      <div className="mb-4 flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h2 className="font-serif text-lg text-foreground">{title}</h2>
          {subtitle ? <p className="mt-1 truncate text-sm text-muted-foreground">{subtitle}</p> : null}
        </div>
        {actionLabel && onAction ? (
          <button
            onClick={onAction}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-border bg-card px-2.5 py-1.5 text-xs font-medium text-foreground hover:bg-card-alt"
          >
            {actionLabel}
            <ArrowUpRight className="h-3.5 w-3.5 text-muted-foreground" />
          </button>
        ) : null}
      </div>
      {children}
    </section>
  );
}

function ModuleRow({
  icon: Icon,
  label,
  value,
  detail,
  status,
  statusTone,
  onClick,
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  detail: string;
  status: string;
  statusTone: StatusTone;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="group grid w-full grid-cols-[2.25rem_minmax(0,1fr)_auto] items-center gap-3 rounded-lg px-2 py-3 text-left hover:bg-card-alt"
    >
      <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
        <Icon className="h-4 w-4" />
      </div>
      <div className="min-w-0">
        <div className="flex min-w-0 items-center gap-2">
          <span className="truncate text-sm font-medium text-foreground">{label}</span>
          <span className="shrink-0 text-xs text-muted-foreground">{value}</span>
        </div>
        <div className="mt-1 truncate text-xs text-muted-foreground">{detail}</div>
      </div>
      <StatusBadge label={status} tone={statusTone} />
    </button>
  );
}

type StatusTone = "active" | "warning" | "ok" | "muted";

function StatusBadge({ label, tone }: { label: string; tone: StatusTone }) {
  const toneClass = {
    active: "bg-primary/10 text-primary",
    warning: "bg-destructive/10 text-destructive",
    ok: "bg-card-alt text-foreground",
    muted: "bg-muted text-muted-foreground",
  }[tone];

  return (
    <span className={`inline-flex min-w-[4.75rem] items-center justify-center rounded-full px-2 py-1 text-xs font-medium ${toneClass}`}>
      {label}
    </span>
  );
}

function CompactStat({ label, value }: { label: string; value: number }) {
  return (
    <div className="border-l border-border px-3 first:border-l-0">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 font-serif text-2xl text-foreground tabular-nums">{value}</div>
    </div>
  );
}

function EmptyPanel({ icon: Icon, label }: { icon: LucideIcon; label: string }) {
  return (
    <div className="flex min-h-28 flex-col items-center justify-center rounded-xl border border-dashed border-border bg-card-alt px-4 py-6 text-center">
      <Icon className="h-5 w-5 text-muted-foreground" />
      <div className="mt-2 text-sm text-muted-foreground">{label}</div>
    </div>
  );
}

function ModuleCard({
  icon: Icon,
  title,
  description,
  action,
  onClick,
}: {
  icon: LucideIcon;
  title: string;
  description: string;
  action: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="group flex min-h-36 flex-col justify-between rounded-2xl border border-border bg-card p-5 text-left hover:border-primary/40 hover:bg-card-alt"
    >
      <div>
        <div className="mb-4 flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <Icon className="h-4 w-4" />
        </div>
        <h3 className="font-serif text-lg text-foreground">{title}</h3>
        <p className="mt-2 line-clamp-2 text-sm leading-6 text-muted-foreground">{description}</p>
      </div>
      <div className="mt-5 flex items-center gap-1.5 text-xs font-medium text-primary">
        {action}
        <ArrowUpRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
      </div>
    </button>
  );
}

function MessageDot({ source }: { source: Session["source"] }) {
  const icon = source === "codex" ? Bot : source === "cli" ? CheckCircle2 : source === "app-code" ? Command : source === "app-web" ? Activity : CircleAlert;
  const Icon = icon;

  return (
    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
      <Icon className="h-3.5 w-3.5" />
    </span>
  );
}
