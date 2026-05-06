import { FormEvent, KeyboardEvent, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import { CheckCircle2, Copy, ExternalLink, Loader2, LogIn, Mail, Send } from "lucide-react";
import { version as APP_VERSION } from "../../package.json";
import { useLovstudioAuth } from "@/hooks/useLovstudioAuth";
import { useI18n } from "@/i18n";
import { cn } from "@/lib/utils";
import { Button } from "./ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog";
import { Label } from "./ui/label";
import { toast } from "./ui/toast";

const FEEDBACK_EMAIL = "mark@lovstudio.ai";
const MIN_MESSAGE_CHARS = 4;
const MAX_TAGS = 6;
const MAX_TAG_CHARS = 20;
const TICKETS_URL = "https://lovstudio.ai/account/tickets";

const categoryOptions = [
  { value: "bug", label: "问题" },
  { value: "idea", label: "建议" },
  { value: "contact", label: "对接" },
] as const;

type FeedbackCategory = (typeof categoryOptions)[number]["value"];

interface FeedbackSubmitResult {
  feedbackId: string;
  endpoint: string;
  recipientEmail: string;
  submitterEmail?: string | null;
  authenticated?: boolean;
}

function getCurrentPath() {
  return `${window.location.pathname}${window.location.search}`;
}

function getTimezone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    return undefined;
  }
}

function charCount(value: string) {
  return Array.from(value).length;
}

function normalizeTag(value: string) {
  return value
    .trim()
    .replace(/^#+/, "")
    .replace(/[#,，]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_TAG_CHARS);
}

function formatTag(value: string) {
  return `#${value}`;
}

function getCategoryFromTags(tags: string[]): FeedbackCategory {
  return categoryOptions.find((item) => tags.includes(item.label))?.value ?? "idea";
}

interface FeedbackButtonProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function FeedbackButton({ open, onOpenChange }: FeedbackButtonProps) {
  const { t, translate } = useI18n();
  const [message, setMessage] = useState("");
  const [selectedTags, setSelectedTags] = useState<string[]>(["建议"]);
  const [customTags, setCustomTags] = useState<string[]>([]);
  const [customTagInput, setCustomTagInput] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [submittedTicket, setSubmittedTicket] = useState<FeedbackSubmitResult | null>(null);
  const {
    authState,
    authLoading,
    loginFlow,
    loginPolling,
    startLogin,
  } = useLovstudioAuth();

  const trimmedMessage = message.trim();
  const messageLength = charCount(trimmedMessage);
  const isMessageTooShort = messageLength > 0 && messageLength < MIN_MESSAGE_CHARS;
  const canSubmit = Boolean(authState) && messageLength >= MIN_MESSAGE_CHARS && !submitting;
  const selectedCategory = useMemo(() => getCategoryFromTags(selectedTags), [selectedTags]);
  const localizeTag = (tag: string) => {
    const category = categoryOptions.find((item) => item.label === tag);
    return category ? translate(category.label) : tag;
  };
  const selectedTagText = useMemo(() => selectedTags.map((tag) => formatTag(localizeTag(tag))).join(" "), [selectedTags, translate]);

  const selectedCategoryLabel = useMemo(
    () => translate(categoryOptions.find((item) => item.value === selectedCategory)?.label ?? "建议"),
    [selectedCategory, translate],
  );

  const resetForm = () => {
    setMessage("");
    setSelectedTags(["建议"]);
    setCustomTags([]);
    setCustomTagInput("");
    setError("");
    setSubmittedTicket(null);
  };

  const handleOpenChange = (nextOpen: boolean) => {
    onOpenChange(nextOpen);
    if (nextOpen) {
      setError("");
    } else {
      resetForm();
    }
  };

  const buildMailtoUrl = () => {
    const subject = t("feedback.mailSubject", { category: selectedCategoryLabel });
    const body = [
      "Lovcode Feedback",
      `Category: ${selectedCategoryLabel}`,
      selectedTagText ? `Tags: ${selectedTagText}` : "",
      `Page: ${getCurrentPath()}`,
      `App Version: ${APP_VERSION}`,
      "",
      trimmedMessage || t("feedback.mailEmptyMessage"),
    ].filter(Boolean).join("\n");

    return `mailto:${FEEDBACK_EMAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  };

  const handleOpenMail = async () => {
    try {
      await openUrl(buildMailtoUrl());
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      toast.error(t("feedback.openMailFailed", { message }));
    }
  };

  const handleCopyTicketId = async () => {
    if (!submittedTicket?.feedbackId) return;

    try {
      await navigator.clipboard.writeText(submittedTicket.feedbackId);
      toast.success(t("feedback.ticketCopied"));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      toast.error(t("feedback.copyFailed", { message }));
    }
  };

  const handleOpenTickets = async () => {
    try {
      await openUrl(TICKETS_URL);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      toast.error(t("feedback.openAccountFailed", { message }));
    }
  };

  const handleStartLogin = async () => {
    await startLogin(APP_VERSION);
  };

  const toggleTag = (tag: string) => {
    if (!selectedTags.includes(tag) && selectedTags.length >= MAX_TAGS) {
      toast.error(t("feedback.maxTags", { count: MAX_TAGS }));
      return;
    }

    setSelectedTags((current) => (
      current.includes(tag)
        ? current.filter((item) => item !== tag)
        : [...current, tag]
    ));
  };

  const addCustomTag = () => {
    const tag = normalizeTag(customTagInput);
    if (!tag) {
      setCustomTagInput("");
      return;
    }

    if (!selectedTags.includes(tag) && selectedTags.length >= MAX_TAGS) {
      toast.error(t("feedback.maxTags", { count: MAX_TAGS }));
      return;
    }

    if (!categoryOptions.some((item) => item.label === tag)) {
      setCustomTags((current) => (
        current.includes(tag) ? current : [...current, tag]
      ));
    }
    setSelectedTags((current) => (
      current.includes(tag) ? current : [...current, tag]
    ));
    setCustomTagInput("");
  };

  const handleCustomTagKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter" || event.key === "," || event.key === "，") {
      event.preventDefault();
      addCustomTag();
    }
  };

  const getSubmissionTags = () => {
    const pendingTag = normalizeTag(customTagInput);
    if (!pendingTag || selectedTags.includes(pendingTag) || selectedTags.length >= MAX_TAGS) {
      return selectedTags;
    }

    return [...selectedTags, pendingTag];
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!authState) {
      if (!authLoading) {
        await handleStartLogin();
      }
      return;
    }
    if (!canSubmit) return;

    setSubmitting(true);
    setError("");

    try {
      const submissionTags = getSubmissionTags();
      const submissionCategory = getCategoryFromTags(submissionTags);

      const result = await invoke<FeedbackSubmitResult>("submit_feedback", {
        payload: {
          category: submissionCategory,
          message: trimmedMessage,
          path: getCurrentPath(),
          appVersion: APP_VERSION,
          userAgent: navigator.userAgent,
          locale: navigator.language,
          timezone: getTimezone(),
          metadata: {
            tags: submissionTags.map(formatTag),
            tagLabels: submissionTags,
            screen: `${window.screen.width}x${window.screen.height}`,
            pixelRatio: window.devicePixelRatio,
          },
        },
      });

      setSubmittedTicket(result);
      setMessage("");
      toast.success(t("feedback.submittedToast"));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
      toast.error(t("feedback.submitFailed", { message }));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent className="gap-0 overflow-x-hidden p-0 sm:max-w-[420px] sm:rounded-2xl">
          <DialogHeader className="px-5 pb-3 pt-5 pr-12 text-left">
            <DialogTitle className="font-serif text-2xl leading-tight">
              {submittedTicket ? t("feedback.submitted") : t("feedback.submitFeedback")}
            </DialogTitle>
          </DialogHeader>

          {submittedTicket ? (
            <div className="space-y-4 px-5 pb-5">
              <div className="max-w-full overflow-hidden rounded-xl border border-primary/30 bg-primary/5 p-3">
                <div className="mb-3 flex items-center gap-2 text-sm font-medium text-foreground">
                  <CheckCircle2 className="h-4 w-4 text-primary" />
                  {t("feedback.ticketId")}
                </div>
                <div className="grid min-w-0 max-w-full gap-2 rounded-lg border border-border bg-background p-2 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
                  <code className="block min-w-0 break-all rounded bg-muted/50 px-2 py-1.5 font-mono text-xs leading-relaxed text-foreground">
                    {submittedTicket.feedbackId}
                  </code>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="w-full sm:w-auto"
                    onClick={handleCopyTicketId}
                  >
                    <Copy className="mr-2 h-4 w-4" />
                    {t("common.copy")}
                  </Button>
                </div>
                {submittedTicket.authenticated && (
                  <p className="mt-2 truncate text-xs text-muted-foreground">
                    {submittedTicket.submitterEmail || t("feedback.currentAccount")}
                  </p>
                )}
              </div>

              <DialogFooter className="gap-2 sm:space-x-0 [&>button]:w-full sm:[&>button]:w-auto">
                {!submittedTicket.authenticated && (
                  <Button type="button" variant="outline" onClick={handleStartLogin}>
                    <LogIn className="mr-2 h-4 w-4" />
                    {t("auth.loginOrRegister")}
                  </Button>
                )}
                <Button type="button" variant="outline" onClick={handleOpenTickets}>
                  <ExternalLink className="mr-2 h-4 w-4" />
                  {t("feedback.accountCenter")}
                </Button>
                <Button type="button" onClick={() => handleOpenChange(false)}>
                  {t("common.done")}
                </Button>
              </DialogFooter>
            </div>
          ) : (
            <form className="space-y-4 px-5 pb-5" onSubmit={handleSubmit}>
              <div className="space-y-2">
                <div className="flex items-center justify-between gap-3">
                  <Label htmlFor="feedback-message" className="text-sm font-medium">{t("feedback.message")}</Label>
                  <span
                    className={cn(
                      "shrink-0 text-xs tabular-nums",
                      isMessageTooShort ? "text-destructive" : "text-muted-foreground",
                    )}
                  >
                    {isMessageTooShort ? translate(`还差 ${MIN_MESSAGE_CHARS - messageLength} 字`) : `${messageLength}/5000`}
                  </span>
                </div>
                <textarea
                  id="feedback-message"
                  value={message}
                  onChange={(event) => setMessage(event.target.value)}
                  placeholder={t("feedback.messagePlaceholder")}
                  maxLength={5000}
                  autoFocus
                  className="min-h-[148px] w-full resize-none rounded-xl border border-input bg-background px-3 py-3 text-sm leading-relaxed text-foreground outline-none transition-colors placeholder:text-muted-foreground focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-ring"
                />
              </div>

              <div className="flex flex-wrap items-center gap-2" aria-label={t("feedback.tags")}>
                {categoryOptions.map((item) => (
                  <button
                    key={item.value}
                    type="button"
                    aria-pressed={selectedTags.includes(item.label)}
                    className={cn(
                      "rounded-full border px-3 py-1.5 text-xs font-medium transition-colors",
                      selectedTags.includes(item.label)
                        ? "border-primary bg-primary/10 text-primary"
                        : "border-border bg-background text-muted-foreground hover:bg-accent hover:text-foreground",
                    )}
                    onClick={() => toggleTag(item.label)}
                  >
                    {formatTag(localizeTag(item.label))}
                  </button>
                ))}
                {customTags.map((tag) => (
                  <button
                    key={tag}
                    type="button"
                    aria-pressed={selectedTags.includes(tag)}
                    className={cn(
                      "rounded-full border px-3 py-1.5 text-xs font-medium transition-colors",
                      selectedTags.includes(tag)
                        ? "border-primary bg-primary/10 text-primary"
                        : "border-border bg-background text-muted-foreground hover:bg-accent hover:text-foreground",
                    )}
                    onClick={() => toggleTag(tag)}
                  >
                    {formatTag(tag)}
                  </button>
                ))}
                <input
                  value={customTagInput}
                  onChange={(event) => setCustomTagInput(event.target.value)}
                  onKeyDown={handleCustomTagKeyDown}
                  onBlur={addCustomTag}
                  placeholder={t("feedback.customTag")}
                  aria-label={t("feedback.addCustomTag")}
                  maxLength={MAX_TAG_CHARS + 1}
                  className="h-8 min-w-24 flex-1 rounded-full border border-border bg-background px-3 text-xs text-foreground outline-none placeholder:text-muted-foreground focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-ring"
                />
              </div>

              <div className="min-w-0 text-xs leading-relaxed text-muted-foreground">
                {authLoading ? (
                  t("feedback.checkingLogin")
                ) : authState ? (
                  <span className="block truncate">{t("feedback.loggedInAs", { email: authState.user.email })}</span>
                ) : loginFlow ? (
                  <span className="inline-flex max-w-full items-center gap-2">
                    <span>{t("feedback.authCode")}</span>
                    <span className="truncate rounded-md border border-border bg-background px-2 py-0.5 font-mono tracking-widest text-foreground">
                      {loginFlow.userCode}
                    </span>
                  </span>
                ) : (
                  t("feedback.loginToTrack")
                )}
              </div>

              {error && (
                <p className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
                  {error}
                </p>
              )}

              <div className="flex flex-col-reverse gap-2 pt-2 sm:flex-row sm:items-center sm:justify-between">
                <Button type="button" variant="ghost" className="w-full sm:w-auto" onClick={handleOpenMail}>
                  <Mail className="mr-2 h-4 w-4" />
                  {t("feedback.email")}
                </Button>
                <Button
                  type={authState ? "submit" : "button"}
                  className="w-full sm:min-w-32 sm:w-auto"
                  onClick={authState ? undefined : handleStartLogin}
                  disabled={authState ? !canSubmit : authLoading}
                >
                  {submitting || authLoading || (!authState && loginPolling) ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : authState ? (
                    <Send className="mr-2 h-4 w-4" />
                  ) : (
                    <LogIn className="mr-2 h-4 w-4" />
                  )}
                  {authState ? t("feedback.submitTicket") : loginFlow ? t("feedback.reopenAuth") : t("feedback.loginToSubmit")}
                </Button>
              </div>
            </form>
          )}
      </DialogContent>
    </Dialog>
  );
}
