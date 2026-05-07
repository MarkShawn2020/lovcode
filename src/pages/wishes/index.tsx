import { useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent, type ReactNode } from "react";
import { Bot, Check, Circle, FolderOpen, Link2, Pencil, Plus, RotateCcw, Save, SlidersHorizontal, Trash2, X } from "lucide-react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAppConfig } from "@/context";
import { useInvokeQuery, useSessionsCache } from "@/hooks";
import { useI18n, type Language } from "@/i18n";
import type { Project, Session } from "@/types";
import { resolveSessionLabel, useReadableText } from "@/views/Chat/utils";
import { LabLayout } from "@/views/Lab";

const STORAGE_KEY = "lovcode:wish-room:items";
const UNDO_TIMEOUT_MS = 3000;

type WishStatus = "all" | "open" | "done";

interface WishItem {
  id: string;
  title: string;
  note: string;
  project: string;
  session: string;
  aiEnabled: boolean;
  done: boolean;
  createdAt: number;
}

interface AutocompleteCandidate {
  key: string;
  value: string;
  label: string;
  meta?: string;
  projectPath?: string | null;
}

interface UndoCompletion {
  id: string;
  title: string;
  token: string;
}

const statusFilters: { key: WishStatus; labelKey: "wish.open" | "wish.all" | "wish.done" }[] = [
  { key: "open", labelKey: "wish.open" },
  { key: "all", labelKey: "wish.all" },
  { key: "done", labelKey: "wish.done" },
];

function createId() {
  return `wish-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function readStoredWishes(): WishItem[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is WishItem => (
      item &&
      typeof item.id === "string" &&
      typeof item.title === "string" &&
      typeof item.createdAt === "number"
    )).map((item) => ({
      id: item.id,
      title: item.title,
      note: typeof item.note === "string" ? item.note : "",
      project: typeof item.project === "string" ? item.project : "",
      session: typeof item.session === "string" ? item.session : "",
      aiEnabled: Boolean(item.aiEnabled),
      done: Boolean(item.done),
      createdAt: item.createdAt,
    }));
  } catch {
    return [];
  }
}

function formatDate(timestamp: number, locale: string) {
  return new Intl.DateTimeFormat(locale, {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
  }).format(timestamp);
}

async function pickProjectFolder(onPicked: (path: string) => void) {
  const picked = await openDialog({ directory: true, multiple: false });
  if (typeof picked === "string" && picked.length > 0) onPicked(picked);
}

function getPathName(path: string | null | undefined) {
  if (!path) return "Unknown project";
  return path.replace(/[/\\]+$/, "").split(/[\\/]/).filter(Boolean).pop() || path;
}

function normalizeSearch(value: string) {
  return value.trim().toLowerCase();
}

function findProject(projects: Project[], value: string) {
  const query = normalizeSearch(value);
  if (!query) return null;
  return projects.find((project) => {
    const name = getPathName(project.path).toLowerCase();
    return project.id.toLowerCase() === query || project.path.toLowerCase() === query || name === query;
  }) ?? null;
}

function useSessionCandidates(projects: Project[], projectValue: string, enabled = true) {
  const cachedSessions = useSessionsCache();
  const selectedProject = useMemo(
    () => findProject(projects, projectValue),
    [projectValue, projects],
  );
  const projectId = selectedProject?.id ?? "";
  const { data: projectSessions = [] } = useInvokeQuery<Session[]>(
    ["sessions", projectId || "wish-room-no-project"],
    "list_sessions",
    { projectId },
    { enabled: Boolean(projectId) && enabled },
  );

  const sessions = useMemo(() => {
    if (selectedProject) return enabled ? projectSessions : [];
    const query = normalizeSearch(projectValue);
    if (!query) return cachedSessions;
    return cachedSessions.filter((session) => {
      const path = session.project_path ?? "";
      return path.toLowerCase().includes(query) || getPathName(path).toLowerCase().includes(query);
    });
  }, [cachedSessions, enabled, projectSessions, projectValue, selectedProject]);

  return { selectedProject, sessions };
}

function buildProjectCandidates(projects: Project[], formatPath: (path: string) => string, language: Language): AutocompleteCandidate[] {
  return projects.map((project) => ({
    key: project.id,
    value: project.path,
    label: getPathName(project.path),
    meta: language === "zh"
      ? `${formatPath(project.path)} · ${project.session_count} 个会话`
      : `${formatPath(project.path)} · ${project.session_count} sessions`,
  }));
}

function buildSessionCandidates(
  sessions: Session[],
  selectedProject: Project | null,
  toReadable: (text: string | null | undefined) => string,
  formatPath: (path: string) => string,
  locale: string,
): AutocompleteCandidate[] {
  return sessions.map((session) => {
    const label = resolveSessionLabel(session, toReadable).text;
    const projectPath = session.project_path ?? selectedProject?.path ?? null;
    const date = new Date(session.last_modified * 1000).toLocaleDateString(locale, {
      month: "2-digit",
      day: "2-digit",
    });
    return {
      key: `${session.project_id}:${session.id}`,
      value: session.id,
      label,
      meta: `${projectPath ? formatPath(projectPath) : session.project_id} · ${date}`,
      projectPath,
    };
  });
}

export default function WishesPage() {
  const { formatPath } = useAppConfig();
  const { activeLanguage, locale, t } = useI18n();
  const toReadable = useReadableText();
  const { data: projects = [] } = useInvokeQuery<Project[]>(["projects"], "list_projects");
  const [wishes, setWishes] = useState<WishItem[]>(() => readStoredWishes());
  const [filter, setFilter] = useState<WishStatus>("open");
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [note, setNote] = useState("");
  const [project, setProject] = useState("");
  const [session, setSession] = useState("");
  const [aiEnabled, setAiEnabled] = useState(false);
  const [undoCompletion, setUndoCompletion] = useState<UndoCompletion | null>(null);
  const [undoHovered, setUndoHovered] = useState(false);

  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(wishes));
    } catch {
      // Keep the page usable even if localStorage is unavailable.
    }
  }, [wishes]);

  useEffect(() => {
    if (!undoCompletion) return;
    if (undoHovered) return;
    const timeout = window.setTimeout(() => {
      setUndoCompletion((current) => (
        current?.token === undoCompletion.token ? null : current
      ));
    }, UNDO_TIMEOUT_MS);
    return () => window.clearTimeout(timeout);
  }, [undoCompletion, undoHovered]);

  const visibleWishes = useMemo(() => {
    if (filter === "open") return wishes.filter((wish) => !wish.done);
    if (filter === "done") return wishes.filter((wish) => wish.done);
    return wishes;
  }, [filter, wishes]);

  const openCount = wishes.filter((wish) => !wish.done).length;
  const aiCount = wishes.filter((wish) => wish.aiEnabled).length;
  const projectCandidates = useMemo(
    () => buildProjectCandidates(projects, formatPath, activeLanguage),
    [activeLanguage, formatPath, projects],
  );
  const { selectedProject, sessions: sessionCandidatesSource } = useSessionCandidates(projects, project);
  const sessionCandidates = useMemo(
    () => buildSessionCandidates(sessionCandidatesSource, selectedProject, toReadable, formatPath, locale),
    [formatPath, locale, selectedProject, sessionCandidatesSource, toReadable],
  );

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    const trimmedTitle = title.trim();
    if (!trimmedTitle) return;

    setWishes((current) => [
      {
        id: createId(),
        title: trimmedTitle,
        note: note.trim(),
        project: project.trim(),
        session: session.trim(),
        aiEnabled,
        done: false,
        createdAt: Date.now(),
      },
      ...current,
    ]);
    setTitle("");
    setNote("");
    setProject("");
    setSession("");
    setAiEnabled(false);
    setFilter("open");
  };

  const updateWish = (id: string, patch: Partial<WishItem>) => {
    const target = wishes.find((wish) => wish.id === id);
    if (patch.done === true && target && !target.done) {
      setUndoHovered(false);
      setUndoCompletion({
        id,
        title: target.title,
        token: createId(),
      });
    }
    if (patch.done === false) {
      setUndoCompletion((current) => (current?.id === id ? null : current));
    }
    setWishes((current) => current.map((wish) => (
      wish.id === id ? { ...wish, ...patch } : wish
    )));
  };

  const deleteWish = (id: string) => {
    setUndoCompletion((current) => (current?.id === id ? null : current));
    setWishes((current) => current.filter((wish) => wish.id !== id));
  };

  const undoCompleteWish = () => {
    if (!undoCompletion) return;
    const { id } = undoCompletion;
    setUndoCompletion(null);
    setWishes((current) => current.map((wish) => (
      wish.id === id ? { ...wish, done: false } : wish
    )));
  };

  return (
    <LabLayout active="wish-room">
      <div className="h-full overflow-auto bg-background">
        <div className="mx-auto flex w-full max-w-4xl flex-col gap-4 px-4 py-5">
          {undoCompletion ? (
            <div
              className="pointer-events-none sticky top-3 z-20 flex justify-center px-2"
            >
              <div
                role="status"
                aria-live="polite"
                onMouseEnter={() => setUndoHovered(true)}
                onMouseLeave={() => {
                  setUndoHovered(false);
                  setUndoCompletion(null);
                }}
                className="pointer-events-auto inline-flex max-w-[min(100%,28rem)] items-center gap-2 rounded-xl border border-border bg-card/95 px-2.5 py-1.5 text-xs text-muted-foreground shadow-sm backdrop-blur"
              >
                <p className="min-w-0 truncate">
                  {t("wish.completedUndo", { title: undoCompletion.title })}
                </p>
                <button
                  type="button"
                  onClick={undoCompleteWish}
                  className="inline-flex h-7 shrink-0 items-center gap-1 rounded-lg px-2 text-xs font-medium text-primary hover:bg-primary/10"
                >
                  <RotateCcw className="h-3.5 w-3.5" />
                  {t("wish.undo")}
                </button>
              </div>
            </div>
          ) : null}
          <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <div className="mb-1.5 flex items-center gap-2 text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                <span className="h-px w-6 bg-border" />
                <span>{t("common.wishRoom")}</span>
              </div>
              <h1 className="font-serif text-2xl leading-tight text-foreground tracking-tight">
                {t("common.wishRoom")}
              </h1>
            </div>
            <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <span className="rounded-full border border-border bg-card px-2.5 py-1">
                {t("wish.openCount", { count: openCount })}
              </span>
              <span className="rounded-full border border-border bg-card px-2.5 py-1">
                {aiCount} AI
              </span>
            </div>
          </header>

        <form
          onSubmit={handleSubmit}
          className="rounded-2xl border border-border bg-card p-2"
        >
          <div className="flex items-center gap-2">
            <Input
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder={t("wish.placeholder")}
              className="h-11 border-transparent bg-background text-base focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-offset-0"
            />
            <button
              type="button"
              onClick={() => setDetailsOpen((open) => !open)}
              className={`inline-flex h-11 shrink-0 items-center gap-1.5 rounded-xl border px-3 text-sm transition-colors ${
                detailsOpen || note || project || session || aiEnabled
                  ? "border-primary/30 bg-primary/10 text-primary"
                  : "border-border bg-background text-muted-foreground hover:text-foreground"
              }`}
              title={t("wish.expandDetails")}
            >
              <SlidersHorizontal className="h-4 w-4" />
              {t("wish.details")}
            </button>
            <Button
              type="submit"
              size="icon"
              className="h-11 w-11 shrink-0 rounded-xl"
              disabled={!title.trim()}
              title={t("wish.add")}
            >
              <Plus className="h-4 w-4" />
            </Button>
          </div>

          {detailsOpen && (
            <div className="mt-2 grid gap-2 border-t border-border pt-2 md:grid-cols-[1fr_1fr_auto]">
              <textarea
                value={note}
                onChange={(event) => setNote(event.target.value)}
                rows={2}
                placeholder={t("wish.note")}
                className="md:col-span-3 min-h-16 w-full resize-none rounded-xl border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              />
              <AutocompleteField
                value={project}
                onChange={setProject}
                placeholder={t("wish.projectPlaceholder")}
                candidates={projectCandidates}
                onPickFolder={() => pickProjectFolder(setProject)}
              />
              <AutocompleteField
                value={session}
                onChange={setSession}
                placeholder={t("wish.sessionPlaceholder")}
                candidates={sessionCandidates}
                onSelect={(candidate) => {
                  setSession(candidate.value);
                  if (!project.trim() && candidate.projectPath) setProject(candidate.projectPath);
                }}
              />
              <label className="inline-flex h-9 items-center justify-center gap-2 rounded-xl border border-border bg-background px-3 text-sm text-muted-foreground">
                <input
                  type="checkbox"
                  checked={aiEnabled}
                  onChange={(event) => setAiEnabled(event.target.checked)}
                  className="h-3.5 w-3.5 rounded border-border accent-primary"
                />
                AI
              </label>
            </div>
          )}
        </form>

        <section className="overflow-hidden rounded-2xl border border-border bg-card">
          <div className="flex items-center justify-between gap-3 border-b border-border px-3 py-2">
            <div className="flex items-center gap-1 rounded-xl bg-background p-1">
              {statusFilters.map((item) => (
                <button
                  key={item.key}
                  type="button"
                  onClick={() => setFilter(item.key)}
                  className={`h-7 rounded-lg px-2.5 text-xs transition-colors ${
                    filter === item.key
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {t(item.labelKey)}
                </button>
              ))}
            </div>
            <span className="text-xs text-muted-foreground">
              {t("wish.itemCount", { count: visibleWishes.length })}
            </span>
          </div>

          {visibleWishes.length === 0 ? (
            <div className="flex min-h-48 flex-col items-center justify-center px-5 text-center">
              <div className="font-serif text-lg text-foreground">{t("wish.emptyTitle")}</div>
              <p className="mt-1 text-sm text-muted-foreground">
                {t("wish.emptyHint")}
              </p>
            </div>
          ) : (
            <div className="divide-y divide-border">
              {visibleWishes.map((wish) => (
                <WishRow
                  key={wish.id}
                  wish={wish}
                  projects={projects}
                  projectCandidates={projectCandidates}
                  formatPath={formatPath}
                  toReadable={toReadable}
                  onUpdate={(patch) => updateWish(wish.id, patch)}
                  onDelete={() => deleteWish(wish.id)}
                />
              ))}
            </div>
          )}
        </section>
        </div>
      </div>
    </LabLayout>
  );
}

function WishRow({
  wish,
  projects,
  projectCandidates,
  formatPath,
  toReadable,
  onUpdate,
  onDelete,
}: {
  wish: WishItem;
  projects: Project[];
  projectCandidates: AutocompleteCandidate[];
  formatPath: (path: string) => string;
  toReadable: (text: string | null | undefined) => string;
  onUpdate: (patch: Partial<WishItem>) => void;
  onDelete: () => void;
}) {
  const { locale, t } = useI18n();
  const [expanded, setExpanded] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draftTitle, setDraftTitle] = useState(wish.title);
  const [draftNote, setDraftNote] = useState(wish.note);
  const titleInputRef = useRef<HTMLInputElement | null>(null);
  const hasBinding = Boolean(wish.project || wish.session);
  const { selectedProject, sessions: sessionCandidatesSource } = useSessionCandidates(projects, wish.project, expanded);
  const sessionCandidates = useMemo(
    () => buildSessionCandidates(sessionCandidatesSource, selectedProject, toReadable, formatPath, locale),
    [formatPath, locale, selectedProject, sessionCandidatesSource, toReadable],
  );
  const canSaveEdit = draftTitle.trim().length > 0;

  useEffect(() => {
    if (editing) return;
    setDraftTitle(wish.title);
    setDraftNote(wish.note);
  }, [editing, wish.note, wish.title]);

  useEffect(() => {
    if (!editing) return;
    titleInputRef.current?.focus();
    titleInputRef.current?.select();
  }, [editing]);

  const startEditing = () => {
    setDraftTitle(wish.title);
    setDraftNote(wish.note);
    setExpanded(false);
    setEditing(true);
  };

  const cancelEditing = () => {
    setDraftTitle(wish.title);
    setDraftNote(wish.note);
    setEditing(false);
  };

  const saveEditing = () => {
    const title = draftTitle.trim();
    if (!title) return;
    onUpdate({ title, note: draftNote.trim() });
    setEditing(false);
  };

  const handleTitleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      cancelEditing();
    }
  };

  const handleNoteKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      cancelEditing();
      return;
    }
    if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
      event.preventDefault();
      saveEditing();
    }
  };

  return (
    <article className={wish.done ? "bg-muted/20" : "bg-card"}>
      <div className="flex items-start gap-2 px-3 py-2.5">
        <button
          type="button"
          onClick={() => onUpdate({ done: !wish.done })}
          className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-border text-muted-foreground hover:border-primary hover:text-primary"
          title={wish.done ? t("wish.markOpen") : t("wish.markDone")}
        >
          {wish.done ? <Check className="h-3.5 w-3.5" /> : <Circle className="h-3.5 w-3.5" />}
        </button>

        <div className="min-w-0 flex-1">
          {editing ? (
            <form
              className="grid gap-2"
              onSubmit={(event) => {
                event.preventDefault();
                saveEditing();
              }}
            >
              <Input
                ref={titleInputRef}
                value={draftTitle}
                onChange={(event) => setDraftTitle(event.target.value)}
                onKeyDown={handleTitleKeyDown}
                aria-label={t("wish.placeholder")}
                className="h-9 border-input bg-background text-sm font-medium focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-offset-0"
              />
              <textarea
                value={draftNote}
                onChange={(event) => setDraftNote(event.target.value)}
                onKeyDown={handleNoteKeyDown}
                rows={2}
                placeholder={t("wish.note")}
                aria-label={t("wish.note")}
                className="min-h-14 w-full resize-none rounded-xl border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              />
            </form>
          ) : (
            <>
              <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                <button
                  type="button"
                  onClick={startEditing}
                  className={`min-w-0 flex-1 truncate text-left text-sm font-medium text-foreground hover:text-primary ${wish.done ? "line-through decoration-primary/50" : ""}`}
                  title={t("common.edit")}
                >
                  {wish.title}
                </button>
                <span className="shrink-0 text-[11px] text-muted-foreground">{formatDate(wish.createdAt, locale)}</span>
              </div>
              <div className="mt-1 flex min-w-0 flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
                {wish.note ? <span className="max-w-full truncate">{wish.note}</span> : null}
                {wish.aiEnabled ? <MetaPill icon={<Bot className="h-3 w-3" />} label="AI" active /> : null}
                {hasBinding ? (
                  <MetaPill
                    icon={<Link2 className="h-3 w-3" />}
                    label={[wish.project, wish.session].filter(Boolean).join(" / ")}
                    active
                  />
                ) : null}
              </div>
            </>
          )}
        </div>

        {editing ? (
          <>
            <button
              type="button"
              onClick={saveEditing}
              disabled={!canSaveEdit}
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-accent hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
              title={t("common.save")}
            >
              <Save className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={cancelEditing}
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-accent hover:text-foreground"
              title={t("common.cancel")}
            >
              <X className="h-4 w-4" />
            </button>
          </>
        ) : (
          <>
            <button
              type="button"
              onClick={startEditing}
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-accent hover:text-foreground"
              title={t("common.edit")}
            >
              <Pencil className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={() => setExpanded((open) => !open)}
              className="h-7 shrink-0 rounded-lg px-2 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              {t("wish.bind")}
            </button>
            <button
              type="button"
              onClick={onDelete}
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-accent hover:text-foreground"
              title={t("common.delete")}
            >
              <Trash2 className="h-4 w-4" />
            </button>
          </>
        )}
      </div>

      {expanded && !editing && (
        <div className="grid gap-2 border-t border-border bg-background/60 px-3 py-3 md:grid-cols-[1fr_1fr_auto]">
          <textarea
            value={wish.note}
            onChange={(event) => onUpdate({ note: event.target.value })}
            rows={2}
            placeholder={t("wish.note")}
            className="md:col-span-3 min-h-14 w-full resize-none rounded-xl border border-input bg-card px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          />
          <AutocompleteField
            value={wish.project}
            placeholder={t("wish.bindProject")}
            candidates={projectCandidates}
            onChange={(value) => onUpdate({ project: value })}
            onPickFolder={() => pickProjectFolder((path) => onUpdate({ project: path }))}
          />
          <AutocompleteField
            value={wish.session}
            placeholder={t("wish.bindSession")}
            candidates={sessionCandidates}
            onChange={(value) => onUpdate({ session: value })}
            onSelect={(candidate) => onUpdate({
              session: candidate.value,
              project: wish.project.trim() ? wish.project : candidate.projectPath ?? wish.project,
            })}
          />
          <label className="inline-flex h-9 items-center justify-center gap-2 rounded-xl border border-border bg-card px-3 text-sm text-muted-foreground">
            <input
              type="checkbox"
              checked={wish.aiEnabled}
              onChange={(event) => onUpdate({ aiEnabled: event.target.checked })}
              className="h-3.5 w-3.5 rounded border-border accent-primary"
            />
            AI
          </label>
        </div>
      )}
    </article>
  );
}

function AutocompleteField({
  value,
  placeholder,
  candidates,
  onChange,
  onSelect,
  onPickFolder,
}: {
  value: string;
  placeholder: string;
  candidates: AutocompleteCandidate[];
  onChange: (value: string) => void;
  onSelect?: (candidate: AutocompleteCandidate) => void;
  onPickFolder?: () => void;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const menuCandidates = useMemo(() => {
    const query = normalizeSearch(value);
    const filtered = query
      ? candidates.filter((candidate) => (
          candidate.value.toLowerCase().includes(query) ||
          candidate.label.toLowerCase().includes(query) ||
          (candidate.meta?.toLowerCase().includes(query) ?? false)
        ))
      : candidates;
    return filtered.slice(0, 7);
  }, [candidates, value]);

  const selectCandidate = (candidate: AutocompleteCandidate) => {
    if (onSelect) onSelect(candidate);
    else onChange(candidate.value);
    setOpen(false);
  };

  return (
    <div className="relative min-w-0">
      <Input
        value={value}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onChange={(event) => {
          onChange(event.target.value);
          setOpen(true);
        }}
        placeholder={placeholder}
        className="h-9"
      />
      {open && (onPickFolder || menuCandidates.length > 0) && (
        <div className="absolute left-0 right-0 top-[calc(100%+0.25rem)] z-30 max-h-60 overflow-auto rounded-xl border border-border bg-popover p-1 shadow-lg">
          {onPickFolder && (
            <button
              type="button"
              onMouseDown={(event) => {
                event.preventDefault();
                onPickFolder();
                setOpen(false);
              }}
              className="flex w-full min-w-0 items-center gap-2 rounded-lg px-2.5 py-2 text-left hover:bg-accent"
            >
              <FolderOpen className="h-4 w-4 shrink-0 text-muted-foreground" />
              <span className="text-sm font-medium text-popover-foreground">
                {t("wish.chooseLocalFolder")}
              </span>
            </button>
          )}
          {onPickFolder && menuCandidates.length > 0 && (
            <div className="my-1 h-px bg-border" />
          )}
          {menuCandidates.map((candidate) => (
            <button
              key={candidate.key}
              type="button"
              onMouseDown={(event) => {
                event.preventDefault();
                selectCandidate(candidate);
              }}
              className="flex w-full min-w-0 flex-col rounded-lg px-2.5 py-2 text-left hover:bg-accent"
            >
              <span className="truncate text-sm font-medium text-popover-foreground">
                {candidate.label}
              </span>
              {candidate.meta ? (
                <span className="mt-0.5 truncate text-xs text-muted-foreground">
                  {candidate.meta}
                </span>
              ) : null}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function MetaPill({
  icon,
  label,
  active,
}: {
  icon: ReactNode;
  label: string;
  active?: boolean;
}) {
  return (
    <span className={`inline-flex min-w-0 items-center gap-1 rounded-full border px-2 py-0.5 ${
      active
        ? "border-primary/20 bg-primary/10 text-primary"
        : "border-border bg-background text-muted-foreground"
    }`}>
      {icon}
      <span className="truncate">{label}</span>
    </span>
  );
}
