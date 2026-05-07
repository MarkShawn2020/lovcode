import { useCallback, useEffect, useMemo, useState } from "react";
import { invoke } from "@/lib/tauri";
import { openUrl } from "@tauri-apps/plugin-opener";
import {
  BadgeCheck,
  CheckCircle2,
  Clock,
  Copy,
  ExternalLink,
  Github,
  ListTodo,
  Loader2,
  PanelRightClose,
  PanelRightOpen,
  RefreshCw,
  TimerReset,
  XCircle,
} from "lucide-react";
import { useI18n } from "@/i18n";
import { cn } from "@/lib/utils";
import { Button } from "./ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog";
import { Label } from "./ui/label";
import { toast } from "./ui/toast";

type ReviewAction = "complete" | "close" | "defer";

interface FeedbackGithubIssueLink {
  repo: string;
  number: number;
  url: string;
  title?: string | null;
  body?: string | null;
  createdAt?: string | null;
  createdBy?: string | null;
  state?: string | null;
  stateReason?: string | null;
  updatedAt?: string | null;
  comments?: number | null;
  lastCommentedAt?: string | null;
  closedAt?: string | null;
  closedBy?: string | null;
}

interface FeedbackReviewDefer {
  status?: string | null;
  deferredAt?: string | null;
  deferredBy?: string | null;
  comment?: string | null;
}

interface FeedbackMetadata {
  tags?: unknown;
  tagLabels?: unknown;
  githubIssue?: unknown;
  reviewDefer?: unknown;
  [key: string]: unknown;
}

interface FeedbackTicket {
  id: string;
  source?: string | null;
  category?: string | null;
  message?: string | null;
  appVersion?: string | null;
  path?: string | null;
  locale?: string | null;
  timezone?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
  metadata?: FeedbackMetadata | null;
  submitterEmail?: string | null;
  lastAdminActionBy?: string | null;
  lastAdminActionAt?: string | null;
}

interface FeedbackGithubIssueResult {
  feedback: FeedbackTicket;
  issue: FeedbackGithubIssueLink;
  created: boolean;
}

interface FeedbackGithubIssueActionResult {
  feedback: FeedbackTicket;
  issue: FeedbackGithubIssueLink;
}

interface FeedbackAdminDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function isGithubIssueLink(value: unknown): value is FeedbackGithubIssueLink {
  if (!value || typeof value !== "object") return false;
  const issue = value as Partial<FeedbackGithubIssueLink>;
  return (
    typeof issue.repo === "string"
    && typeof issue.number === "number"
    && issue.number > 0
    && typeof issue.url === "string"
    && issue.url.length > 0
  );
}

function getGithubIssue(ticket: FeedbackTicket) {
  const issue = ticket.metadata?.githubIssue;
  return isGithubIssueLink(issue) ? issue : null;
}

function isReviewDefer(value: unknown): value is FeedbackReviewDefer {
  if (!value || typeof value !== "object") return false;
  const reviewDefer = value as Partial<FeedbackReviewDefer>;
  return reviewDefer.status === "deferred" && typeof reviewDefer.deferredAt === "string";
}

function getReviewDefer(ticket: FeedbackTicket) {
  const reviewDefer = ticket.metadata?.reviewDefer;
  return isReviewDefer(reviewDefer) ? reviewDefer : null;
}

function getMetadataStringList(value: unknown) {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    : [];
}

function getTicketTags(ticket: FeedbackTicket) {
  const labels = getMetadataStringList(ticket.metadata?.tagLabels);
  return labels.length > 0 ? labels : getMetadataStringList(ticket.metadata?.tags);
}

function getCategoryLabel(ticket: FeedbackTicket, t: ReturnType<typeof useI18n>["t"]) {
  switch (ticket.category) {
    case "bug":
      return t("feedback.bug");
    case "contact":
      return t("feedback.contact");
    case "idea":
      return t("feedback.idea");
    default:
      return ticket.category || t("feedback.idea");
  }
}

function formatIssueNumber(issue: FeedbackGithubIssueLink) {
  return `${issue.repo}#${issue.number}`;
}

function compactIssueText(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function truncateIssueText(value: string, maxChars: number) {
  const chars = Array.from(value);
  return chars.length > maxChars ? `${chars.slice(0, maxChars).join("")}...` : value;
}

function feedbackIssueCategoryLabel(category?: string | null) {
  switch (category) {
    case "bug":
      return "Issue";
    case "contact":
      return "Integration";
    case "idea":
      return "Suggestion";
    default:
      return "Feedback";
  }
}

function buildTargetIssueTitle(ticket: FeedbackTicket) {
  const category = feedbackIssueCategoryLabel(ticket.category);
  const summary = ticket.message
    ? truncateIssueText(compactIssueText(ticket.message), 80)
    : ticket.id;
  return `[Lovcode feedback] ${category}: ${summary || ticket.id}`;
}

function appendIssueContextLine(lines: string[], label: string, value?: string | null) {
  const trimmed = value?.trim();
  if (trimmed) {
    lines.push(`- ${label}: ${trimmed}`);
  }
}

function buildTargetIssueBody(ticket: FeedbackTicket) {
  const feedback = ticket.message?.trim() || "_No message provided._";
  const context = [`- Lovcode feedback ID: ${ticket.id}`];
  appendIssueContextLine(context, "Category", ticket.category);
  appendIssueContextLine(context, "App version", ticket.appVersion);
  appendIssueContextLine(context, "Path", ticket.path);
  appendIssueContextLine(context, "Locale", ticket.locale);
  appendIssueContextLine(context, "Timezone", ticket.timezone);
  appendIssueContextLine(context, "Created at", ticket.createdAt);

  const tags = getTicketTags(ticket);
  if (tags.length > 0) {
    context.push(`- Tags: ${tags.join(", ")}`);
  }

  return [
    "## Feedback",
    "",
    feedback,
    "",
    "## Context",
    "",
    context.join("\n"),
    "",
    "---",
    "Imported from Lovcode feedback.",
  ].join("\n");
}

function getTargetIssueTitle(ticket: FeedbackTicket, issue: FeedbackGithubIssueLink | null) {
  return issue?.title?.trim() || buildTargetIssueTitle(ticket);
}

function getTargetIssueBody(ticket: FeedbackTicket, issue: FeedbackGithubIssueLink | null) {
  return issue?.body?.trim() || buildTargetIssueBody(ticket);
}

function isIssueClosed(issue: FeedbackGithubIssueLink | null) {
  return issue?.state === "closed";
}

function isFeedbackReviewQueueItem(ticket: FeedbackTicket) {
  const issue = getGithubIssue(ticket);
  return !issue || !isIssueClosed(issue);
}

function isConsumedQueueItem(ticket: FeedbackTicket) {
  return isIssueClosed(getGithubIssue(ticket));
}

function isDeferredReviewQueueItem(ticket: FeedbackTicket) {
  return isFeedbackReviewQueueItem(ticket) && Boolean(getReviewDefer(ticket));
}

function isActiveReviewQueueItem(ticket: FeedbackTicket) {
  return isFeedbackReviewQueueItem(ticket) && !getReviewDefer(ticket);
}

function compareFeedbackQueueOrder(left: FeedbackTicket, right: FeedbackTicket) {
  const leftDefer = getReviewDefer(left);
  const rightDefer = getReviewDefer(right);
  if (Boolean(leftDefer) !== Boolean(rightDefer)) return leftDefer ? 1 : -1;
  if (leftDefer && rightDefer) {
    const leftTime = Date.parse(leftDefer.deferredAt ?? "");
    const rightTime = Date.parse(rightDefer.deferredAt ?? "");
    return (Number.isFinite(leftTime) ? leftTime : 0) - (Number.isFinite(rightTime) ? rightTime : 0);
  }
  return 0;
}

function getIssueStateLabel(issue: FeedbackGithubIssueLink | null, t: ReturnType<typeof useI18n>["t"]) {
  if (!issue) return t("feedback.githubIssueUnlinked");
  if (!isIssueClosed(issue)) return t("feedback.githubIssueOpenState");
  switch (issue.stateReason) {
    case "completed":
      return t("feedback.githubIssueCompletedState");
    case "not_planned":
      return t("feedback.githubIssueNotPlannedState");
    case "duplicate":
      return t("feedback.githubIssueDuplicateState");
    default:
      return t("feedback.githubIssueClosedState");
  }
}

export function FeedbackAdminDialog({ open, onOpenChange }: FeedbackAdminDialogProps) {
  const { locale, t } = useI18n();
  const [tickets, setTickets] = useState<FeedbackTicket[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [loading, setLoading] = useState(false);
  const [reviewAction, setReviewAction] = useState<ReviewAction | "">("");
  const [reviewComment, setReviewComment] = useState("");
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [error, setError] = useState("");

  const formatDate = useCallback((value?: string | null) => {
    if (!value) return "";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;

    return new Intl.DateTimeFormat(locale, {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(date);
  }, [locale]);

  const visibleTickets = useMemo(() => {
    const filtered = tickets.filter((ticket) => isFeedbackReviewQueueItem(ticket));
    return [...filtered].sort(compareFeedbackQueueOrder);
  }, [tickets]);

  const selectedTicket = useMemo(
    () => tickets.find((ticket) => ticket.id === selectedId) ?? null,
    [selectedId, tickets],
  );
  const selectedIssue = selectedTicket ? getGithubIssue(selectedTicket) : null;
  const activeReviewCount = useMemo(
    () => tickets.filter((ticket) => isActiveReviewQueueItem(ticket)).length,
    [tickets],
  );
  const deferredReviewCount = useMemo(
    () => tickets.filter((ticket) => isDeferredReviewQueueItem(ticket)).length,
    [tickets],
  );
  const reviewedCount = useMemo(
    () => tickets.filter((ticket) => isConsumedQueueItem(ticket)).length,
    [tickets],
  );

  const loadTickets = useCallback(async (options?: { syncGithub?: boolean }) => {
    setLoading(true);
    setError("");
    try {
      let result = await invoke<FeedbackTicket[]>("list_lovstudio_feedback", {
        status: "all",
        limit: 100,
      });
      if (options?.syncGithub) {
        const linkedTickets = result.filter((ticket) => getGithubIssue(ticket));
        if (linkedTickets.length > 0) {
          const settled = await Promise.allSettled(
            linkedTickets.map((ticket) => invoke<FeedbackGithubIssueActionResult>("sync_lovstudio_feedback_github_issue", {
              payload: { id: ticket.id },
            })),
          );
          const updatedById = new Map<string, FeedbackTicket>();
          let syncError = "";
          for (const item of settled) {
            if (item.status === "fulfilled") {
              updatedById.set(item.value.feedback.id, item.value.feedback);
            } else if (!syncError) {
              syncError = item.reason instanceof Error ? item.reason.message : String(item.reason);
            }
          }
          if (updatedById.size > 0) {
            result = result.map((ticket) => updatedById.get(ticket.id) ?? ticket);
          }
          if (syncError) {
            setError(syncError);
            toast.error(t("feedback.githubIssueSyncFailed", { message: syncError }));
          }
        }
      }
      setTickets(result);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
      toast.error(t("feedback.adminLoadFailed", { message }));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    if (open) {
      void loadTickets();
    }
  }, [loadTickets, open]);

  useEffect(() => {
    if (!open) return;
    if (selectedId && visibleTickets.some((ticket) => ticket.id === selectedId)) return;
    setSelectedId(visibleTickets[0]?.id ?? "");
  }, [open, selectedId, visibleTickets]);

  useEffect(() => {
    setReviewComment("");
    setDetailsOpen(false);
  }, [selectedId]);

  const findNextVisibleTicketId = useCallback((ticketId: string, excludedIds = new Set<string>()) => {
    if (visibleTickets.length === 0) return "";
    const currentIndex = visibleTickets.findIndex((ticket) => ticket.id === ticketId);
    const startIndex = currentIndex >= 0 ? currentIndex + 1 : 0;

    for (let offset = 0; offset < visibleTickets.length; offset += 1) {
      const candidate = visibleTickets[(startIndex + offset) % visibleTickets.length];
      if (candidate.id !== ticketId && !excludedIds.has(candidate.id)) {
        return candidate.id;
      }
    }

    return "";
  }, [visibleTickets]);

  const ticketStaysInCurrentView = useCallback((ticket: FeedbackTicket) => {
    return isFeedbackReviewQueueItem(ticket);
  }, []);

  const applyUpdatedTicket = useCallback((updated: FeedbackTicket, options?: { advance?: boolean }) => {
    setTickets((current) => current.map((ticket) => (
      ticket.id === updated.id ? updated : ticket
    )));
    setSelectedId(options?.advance && !ticketStaysInCurrentView(updated)
      ? findNextVisibleTicketId(updated.id)
      : updated.id);
  }, [findNextVisibleTicketId, ticketStaysInCurrentView]);

  const ensureGithubIssue = useCallback(async (ticket: FeedbackTicket) => {
    const issue = getGithubIssue(ticket);
    if (issue) return { feedback: ticket, issue };

    const result = await invoke<FeedbackGithubIssueResult>("create_lovstudio_feedback_github_issue", {
      payload: { id: ticket.id },
    });
    return { feedback: result.feedback, issue: result.issue };
  }, []);

  const handleReviewStateAction = async (
    action: Exclude<ReviewAction, "defer">,
    stateReason: "completed" | "not_planned",
    successKey: "feedback.githubIssueCompleted" | "feedback.githubIssueClosed",
  ) => {
    if (!selectedTicket) return;
    setReviewAction(action);
    setError("");

    try {
      const hadIssue = Boolean(getGithubIssue(selectedTicket));
      const ensured = await ensureGithubIssue(selectedTicket);
      if (!hadIssue) {
        applyUpdatedTicket(ensured.feedback);
      }
      const comment = reviewComment.trim();
      if (comment) {
        await invoke<FeedbackGithubIssueActionResult>("comment_lovstudio_feedback_github_issue", {
          payload: { id: ensured.feedback.id, body: comment },
        });
      }
      const result = await invoke<FeedbackGithubIssueActionResult>("update_lovstudio_feedback_github_issue_state", {
        payload: { id: ensured.feedback.id, state: "closed", stateReason },
      });
      applyUpdatedTicket(result.feedback, { advance: true });
      setReviewComment("");
      toast.success(t(successKey, { issue: formatIssueNumber(result.issue) }));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
      toast.error(t("feedback.reviewActionFailed", { message }));
    } finally {
      setReviewAction("");
    }
  };

  const handleDeferTicket = async () => {
    if (!selectedTicket) return;
    const ticketId = selectedTicket.id;
    const nextId = findNextVisibleTicketId(ticketId);
    setReviewAction("defer");
    setError("");

    try {
      const updated = await invoke<FeedbackTicket>("defer_lovstudio_feedback_review", {
        payload: {
          id: ticketId,
          comment: reviewComment.trim() || null,
        },
      });
      setTickets((current) => current.map((ticket) => (
        ticket.id === updated.id ? updated : ticket
      )));
      setSelectedId(nextId || updated.id);
      setReviewComment("");
      toast.success(t("feedback.reviewDeferred"));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
      toast.error(t("feedback.reviewActionFailed", { message }));
    } finally {
      setReviewAction("");
    }
  };

  const handleOpenIssue = async (issue: FeedbackGithubIssueLink) => {
    try {
      await openUrl(issue.url);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      toast.error(t("feedback.openGithubIssueFailed", { message }));
    }
  };

  const handleCopyTargetIssueBody = async () => {
    try {
      await invoke("copy_to_clipboard", { text: targetIssueBody });
      toast.success(t("feedback.githubIssueBodyCopied"));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      toast.error(t("feedback.copyFailed", { message }));
    }
  };

  const currentCategoryLabel = selectedTicket ? getCategoryLabel(selectedTicket, t) : "";
  const currentTags = selectedTicket ? getTicketTags(selectedTicket) : [];
  const currentDefer = selectedTicket ? getReviewDefer(selectedTicket) : null;
  const targetIssueTitle = selectedTicket ? getTargetIssueTitle(selectedTicket, selectedIssue) : "";
  const targetIssueBody = selectedTicket ? getTargetIssueBody(selectedTicket, selectedIssue) : "";
  const isClosedTicket = isIssueClosed(selectedIssue);
  const isBusy = Boolean(reviewAction) || loading;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="grid h-[calc(100dvh-2rem)] grid-rows-[auto_minmax(0,1fr)] gap-0 overflow-hidden p-0 sm:max-w-[880px] sm:rounded-2xl lg:h-[740px]">
        <DialogHeader className="border-b border-border px-4 py-2.5 pr-12 text-left sm:px-5">
          <div className="flex min-w-0 items-center justify-between gap-3">
            <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
              <DialogTitle className="flex min-w-0 items-center gap-2 font-serif text-lg leading-tight">
                <Github className="h-5 w-5 text-primary" />
                <span className="min-w-0 truncate">{t("feedback.githubReviewQueueTitle")}</span>
              </DialogTitle>
              <div className="flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground">
                <span
                  aria-label={`${t("feedback.reviewStatusReviewing")}: ${activeReviewCount}`}
                  title={`${t("feedback.reviewStatusReviewing")}: ${activeReviewCount}`}
                  className="inline-flex h-6 items-center gap-1 rounded-lg border border-border bg-background px-1.5"
                >
                  <ListTodo className="h-3.5 w-3.5 text-primary" />
                  <span className="tabular-nums text-foreground">{activeReviewCount}</span>
                </span>
                <span
                  aria-label={`${t("feedback.reviewStatusDeferred")}: ${deferredReviewCount}`}
                  title={`${t("feedback.reviewStatusDeferred")}: ${deferredReviewCount}`}
                  className="inline-flex h-6 items-center gap-1 rounded-lg border border-border bg-background px-1.5"
                >
                  <TimerReset className="h-3.5 w-3.5 text-muted-foreground" />
                  <span className="tabular-nums text-foreground">{deferredReviewCount}</span>
                </span>
                <span
                  aria-label={`${t("feedback.reviewStatusReviewed")}: ${reviewedCount}`}
                  title={`${t("feedback.reviewStatusReviewed")}: ${reviewedCount}`}
                  className="inline-flex h-6 items-center gap-1 rounded-lg border border-border bg-background px-1.5"
                >
                  <BadgeCheck className="h-3.5 w-3.5 text-primary" />
                  <span className="tabular-nums text-foreground">{reviewedCount}</span>
                </span>
              </div>
            </div>
            <Button
              type="button"
              size="icon"
              variant="outline"
              aria-label={t("common.refresh")}
              onClick={() => void loadTickets({ syncGithub: true })}
              disabled={loading}
              className="h-8 w-8 shrink-0 rounded-lg"
            >
              {loading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <RefreshCw className="h-4 w-4" />
              )}
            </Button>
          </div>
        </DialogHeader>

        <div className="min-h-0 overflow-y-auto bg-card-alt/30 px-3 py-3 sm:px-5">
          {error && (
            <p className="mx-auto mb-4 max-w-3xl rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
              {error}
            </p>
          )}

          {loading && tickets.length === 0 ? (
            <div className="flex h-full min-h-72 items-center justify-center text-sm text-muted-foreground">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              {t("common.loading")}
            </div>
          ) : !selectedTicket ? (
            <div className="mx-auto flex min-h-72 max-w-3xl items-center justify-center rounded-2xl border border-dashed border-border bg-card px-4 text-center text-sm text-muted-foreground">
              {t("feedback.reviewQueueEmpty")}
            </div>
          ) : (
            <article className="mx-auto max-w-4xl rounded-xl border border-border bg-card shadow-sm">
              <div className="border-b border-border px-4 py-2">
                <div className="flex min-w-0 items-center justify-between gap-2">
                  <h2
                    className="min-w-0 truncate font-serif text-sm font-semibold leading-5 text-foreground"
                    title={targetIssueTitle}
                  >
                    {targetIssueTitle}
                  </h2>

                  <div className="flex shrink-0 items-center gap-1">
                    {selectedIssue ? (
                      <button
                        type="button"
                        aria-label={t("feedback.openGithubIssue")}
                        onClick={() => void handleOpenIssue(selectedIssue)}
                        className={cn(
                          "inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border transition-colors",
                          isIssueClosed(selectedIssue)
                            ? "border-border bg-muted text-muted-foreground hover:bg-card-alt hover:text-foreground"
                            : "border-primary/30 bg-primary/10 text-primary hover:bg-primary/15",
                        )}
                      >
                        <ExternalLink className="h-3.5 w-3.5" />
                      </button>
                    ) : null}
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      className="h-7 w-7 rounded-lg"
                      onClick={() => setDetailsOpen((value) => !value)}
                      aria-label={t(detailsOpen ? "feedback.hideBasicInfo" : "feedback.showBasicInfo")}
                      aria-expanded={detailsOpen}
                    >
                      {detailsOpen ? (
                        <PanelRightClose className="h-3.5 w-3.5" />
                      ) : (
                        <PanelRightOpen className="h-3.5 w-3.5" />
                      )}
                    </Button>
                  </div>
                </div>
              </div>

              <div className={cn(
                "grid gap-3 px-4 py-3",
                detailsOpen && "lg:grid-cols-[minmax(0,1fr)_260px]",
              )}>
                <div className="min-w-0 space-y-3">
                  <div className="relative">
                    <p className="max-h-[240px] min-h-28 overflow-y-auto whitespace-pre-wrap rounded-lg border border-border bg-background px-3 py-3 pr-11 text-sm leading-6 text-foreground">
                      {targetIssueBody}
                    </p>
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      className="absolute right-2 top-2 h-7 w-7 rounded-lg bg-background/95"
                      aria-label={t("feedback.copyGithubIssueBody")}
                      title={t("feedback.copyGithubIssueBody")}
                      onClick={() => void handleCopyTargetIssueBody()}
                    >
                      <Copy className="h-3.5 w-3.5" />
                    </Button>
                  </div>

                  <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                    <span className="rounded-full border border-border bg-background px-2 py-0.5">
                      {currentCategoryLabel}
                    </span>
                    {currentDefer && (
                      <span className="rounded-full border border-primary/30 bg-primary/10 px-2 py-0.5 text-primary">
                        {t("feedback.reviewDeferredBadge")}
                      </span>
                    )}
                    {currentTags.map((tag) => (
                      <span key={tag} className="rounded-full border border-border bg-muted/40 px-2 py-0.5">
                        {tag}
                      </span>
                    ))}
                  </div>

                  <div role="separator" className="h-px bg-border" />

                  <div>
                    <textarea
                      id="feedback-review-comment"
                      value={reviewComment}
                      onChange={(event) => setReviewComment(event.target.value)}
                      placeholder={t("feedback.reviewCommentPlaceholder")}
                      aria-label={t("feedback.reviewComment")}
                      className="min-h-20 w-full resize-none rounded-lg border border-input bg-background px-3 py-2 text-sm leading-5 text-foreground outline-none placeholder:text-muted-foreground focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-ring"
                    />
                  </div>

                  <div className="grid gap-2 sm:grid-cols-[1fr_1fr_1.25fr]">
                    <Button
                      type="button"
                      variant="outline"
                      className="h-9 rounded-lg"
                      onClick={handleDeferTicket}
                      disabled={isBusy}
                    >
                      {reviewAction === "defer" ? (
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      ) : (
                        <Clock className="mr-2 h-4 w-4" />
                      )}
                      {t("feedback.deferFeedback")}
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      className="h-9 rounded-lg text-muted-foreground hover:text-foreground"
                      onClick={() => void handleReviewStateAction("close", "not_planned", "feedback.githubIssueClosed")}
                      disabled={isBusy || isClosedTicket}
                    >
                      {reviewAction === "close" ? (
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      ) : (
                        <XCircle className="mr-2 h-4 w-4" />
                      )}
                      {t("feedback.closeGithubIssue")}
                    </Button>
                    <Button
                      type="button"
                      className="h-9 rounded-lg"
                      onClick={() => void handleReviewStateAction("complete", "completed", "feedback.githubIssueCompleted")}
                      disabled={isBusy || isClosedTicket}
                    >
                      {reviewAction === "complete" ? (
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      ) : (
                        <CheckCircle2 className="mr-2 h-4 w-4" />
                      )}
                      {t("feedback.completeGithubIssue")}
                    </Button>
                  </div>
                </div>

                {detailsOpen && (
                  <aside className="space-y-3 lg:border-l lg:border-border lg:pl-3">
                    <div className="rounded-lg border border-border bg-background p-3">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="text-xs font-medium text-foreground">{t("feedback.githubIssue")}</div>
                          <div className="mt-1 truncate text-xs text-muted-foreground">
                            {getIssueStateLabel(selectedIssue, t)}
                          </div>
                        </div>
                        <span
                          className={cn(
                            "shrink-0 rounded-full border px-2 py-0.5 text-xs",
                            selectedIssue && !isIssueClosed(selectedIssue)
                              ? "border-primary/30 bg-primary/10 text-primary"
                              : "border-border bg-muted text-muted-foreground",
                          )}
                        >
                          {selectedIssue ? `#${selectedIssue.number}` : "-"}
                        </span>
                      </div>
                      {selectedIssue && (selectedIssue.updatedAt || typeof selectedIssue.comments === "number") && (
                        <div className="mt-2 space-y-1 text-xs text-muted-foreground">
                          {selectedIssue.updatedAt && (
                            <div>{t("feedback.githubIssueUpdatedAt", { time: formatDate(selectedIssue.updatedAt) })}</div>
                          )}
                          {typeof selectedIssue.comments === "number" && (
                            <div>{t("feedback.githubIssueComments", { count: selectedIssue.comments })}</div>
                          )}
                        </div>
                      )}
                    </div>

                    <div className="rounded-lg border border-border bg-background px-3 py-2">
                      <FeedbackDetailRow label={t("feedback.submitter")} value={selectedTicket.submitterEmail || t("feedback.anonymousSubmitter")} />
                      <FeedbackDetailRow label={t("feedback.appVersion")} value={selectedTicket.appVersion} />
                      <FeedbackDetailRow label={t("feedback.source")} value={selectedTicket.source} />
                      <FeedbackDetailRow label={t("feedback.updatedAt")} value={formatDate(selectedTicket.updatedAt)} />
                      {currentDefer && (
                        <>
                          <FeedbackDetailRow label={t("feedback.reviewDeferredAt")} value={formatDate(currentDefer.deferredAt)} />
                          {currentDefer.comment && (
                            <FeedbackDetailRow label={t("feedback.reviewDeferredComment")} value={currentDefer.comment} />
                          )}
                        </>
                      )}
                      {selectedTicket.path && (
                        <FeedbackDetailRow label={t("feedback.path")} value={selectedTicket.path} mono />
                      )}
                    </div>
                  </aside>
                )}
              </div>
            </article>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function FeedbackDetailRow({ label, value, mono = false }: { label: string; value?: string | null; mono?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-3 border-b border-border py-1.5 last:border-b-0">
      <Label className="shrink-0 text-xs text-muted-foreground">{label}</Label>
      <div className={cn(
        "min-w-0 break-words text-right text-xs text-foreground",
        mono && "font-mono",
      )}>
        {value || "-"}
      </div>
    </div>
  );
}
