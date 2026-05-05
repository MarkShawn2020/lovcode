import { FormEvent, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import { CheckCircle2, Copy, ExternalLink, Loader2, Mail, MessageSquarePlus, Send } from "lucide-react";
import { version as APP_VERSION } from "../../package.json";
import { Button } from "./ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { toast } from "./ui/toast";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";

const FEEDBACK_EMAIL = "mark@lovstudio.ai";
const MIN_MESSAGE_CHARS = 4;
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

export function FeedbackButton() {
  const [open, setOpen] = useState(false);
  const [category, setCategory] = useState<FeedbackCategory>("idea");
  const [message, setMessage] = useState("");
  const [contact, setContact] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [submittedTicket, setSubmittedTicket] = useState<FeedbackSubmitResult | null>(null);

  const trimmedMessage = message.trim();
  const messageLength = charCount(trimmedMessage);
  const isMessageTooShort = messageLength > 0 && messageLength < MIN_MESSAGE_CHARS;
  const canSubmit = messageLength >= MIN_MESSAGE_CHARS && !submitting;

  const selectedCategoryLabel = useMemo(
    () => categoryOptions.find((item) => item.value === category)?.label ?? "建议",
    [category],
  );

  const resetForm = () => {
    setCategory("idea");
    setMessage("");
    setContact("");
    setError("");
    setSubmittedTicket(null);
  };

  const handleOpenChange = (nextOpen: boolean) => {
    setOpen(nextOpen);
    if (nextOpen) {
      setError("");
    } else {
      resetForm();
    }
  };

  const buildMailtoUrl = () => {
    const subject = `[Lovcode 反馈] ${selectedCategoryLabel}`;
    const body = [
      "Lovcode Feedback",
      `Category: ${selectedCategoryLabel}`,
      `Page: ${getCurrentPath()}`,
      `App Version: ${APP_VERSION}`,
      contact.trim() ? `Contact: ${contact.trim()}` : "",
      "",
      trimmedMessage || "请在这里写下反馈内容。",
    ].filter(Boolean).join("\n");

    return `mailto:${FEEDBACK_EMAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  };

  const handleOpenMail = async () => {
    try {
      await openUrl(buildMailtoUrl());
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      toast.error(`打开邮件失败: ${message}`);
    }
  };

  const handleCopyTicketId = async () => {
    if (!submittedTicket?.feedbackId) return;

    try {
      await navigator.clipboard.writeText(submittedTicket.feedbackId);
      toast.success("工单 ID 已复制");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      toast.error(`复制失败: ${message}`);
    }
  };

  const handleOpenTickets = async () => {
    try {
      await openUrl(TICKETS_URL);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      toast.error(`打开用户中心失败: ${message}`);
    }
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!canSubmit) return;

    setSubmitting(true);
    setError("");

    try {
      const result = await invoke<FeedbackSubmitResult>("submit_feedback", {
        payload: {
          category,
          message: trimmedMessage,
          contact: contact.trim() || null,
          path: getCurrentPath(),
          appVersion: APP_VERSION,
          userAgent: navigator.userAgent,
          locale: navigator.language,
          timezone: getTimezone(),
          metadata: {
            screen: `${window.screen.width}x${window.screen.height}`,
            pixelRatio: window.devicePixelRatio,
          },
        },
      });

      setSubmittedTicket(result);
      setMessage("");
      toast.success("反馈已提交，请复制工单 ID");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
      toast.error(`提交失败: ${message}`);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            type="button"
            size="icon"
            className="fixed bottom-10 right-4 z-40 h-10 w-10 rounded-full border border-border shadow-lg"
            onClick={() => handleOpenChange(true)}
            aria-label="提交反馈"
          >
            <MessageSquarePlus className="h-5 w-5" />
          </Button>
        </TooltipTrigger>
        <TooltipContent side="left" sideOffset={8}>提交反馈</TooltipContent>
      </Tooltip>

      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent className="sm:max-w-[440px]">
          <DialogHeader>
            <DialogTitle className="font-serif">提交反馈</DialogTitle>
            <DialogDescription>
              {submittedTicket
                ? "反馈已进入工单系统。"
                : `同步到 lovstudio.ai，并通知 ${FEEDBACK_EMAIL}。`}
            </DialogDescription>
          </DialogHeader>

          {submittedTicket ? (
            <div className="space-y-4">
              <div className="max-w-full overflow-hidden rounded-xl border border-primary/30 bg-primary/5 p-4">
                <div className="flex min-w-0 items-start gap-3">
                  <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
                  <div className="min-w-0 flex-1 space-y-2">
                    <p className="font-medium text-foreground">反馈已提交</p>
                    <p className="text-sm text-muted-foreground">
                      复制工单 ID，后续可以在用户中心查看处理状态。
                    </p>
                    <div className="flex min-w-0 flex-col items-stretch gap-2 rounded-lg border border-border bg-background px-3 py-2 sm:flex-row sm:items-center">
                      <code className="min-w-0 break-all rounded bg-muted/50 px-2 py-1 font-mono text-xs text-foreground sm:flex-1 sm:truncate sm:bg-transparent sm:px-0 sm:py-0 sm:text-sm">
                        {submittedTicket.feedbackId}
                      </code>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className="w-full shrink-0 sm:w-auto"
                        onClick={handleCopyTicketId}
                      >
                        <Copy className="mr-2 h-4 w-4" />
                        复制
                      </Button>
                    </div>
                  </div>
                </div>
              </div>

              <DialogFooter className="gap-2 sm:space-x-0">
                <Button type="button" variant="outline" onClick={handleOpenTickets}>
                  <ExternalLink className="mr-2 h-4 w-4" />
                  用户中心
                </Button>
                <Button type="button" onClick={() => handleOpenChange(false)}>
                  完成
                </Button>
              </DialogFooter>
            </div>
          ) : (
            <form className="space-y-4" onSubmit={handleSubmit}>
            <div className="grid grid-cols-3 gap-2">
              {categoryOptions.map((item) => (
                <button
                  key={item.value}
                  type="button"
                  className={`rounded-lg border px-3 py-2 text-sm transition-colors ${
                    category === item.value
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-border bg-background text-muted-foreground hover:bg-accent hover:text-foreground"
                  }`}
                  onClick={() => setCategory(item.value)}
                >
                  {item.label}
                </button>
              ))}
            </div>

            <div className="space-y-2">
              <Label htmlFor="feedback-message">反馈内容</Label>
              <textarea
                id="feedback-message"
                value={message}
                onChange={(event) => setMessage(event.target.value)}
                placeholder="遇到的问题、期待的功能，或希望我联系你的事项。"
                maxLength={5000}
                className="min-h-32 w-full resize-none rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground shadow-sm outline-none transition-colors placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring"
              />
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span className={isMessageTooShort ? "text-destructive" : ""}>
                  {isMessageTooShort ? `至少输入 ${MIN_MESSAGE_CHARS} 个字符` : " "}
                </span>
                <span>{messageLength}/5000</span>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="feedback-contact">联系方式</Label>
              <Input
                id="feedback-contact"
                value={contact}
                onChange={(event) => setContact(event.target.value)}
                placeholder="建议填写 lovstudio.ai 登录邮箱（可选）"
                maxLength={200}
              />
              <p className="text-xs text-muted-foreground">
                使用登录邮箱提交后，可在用户中心查看已提交工单。
              </p>
            </div>

            {error && (
              <p className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
                {error}
              </p>
            )}

            <DialogFooter className="gap-2 sm:space-x-0">
              <Button type="button" variant="outline" onClick={handleOpenMail}>
                <Mail className="mr-2 h-4 w-4" />
                邮件发送
              </Button>
              <Button type="submit" disabled={!canSubmit}>
                {submitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />}
                提交
              </Button>
            </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
