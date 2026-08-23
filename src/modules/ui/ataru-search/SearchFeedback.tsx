import { Check, Copy, RefreshCw } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { copyText } from "@/modules/api/ataru";
import { getSearchHighlightSegments } from "./utils";

export function HighlightedText({ text, query }: { text: string; query: string }) {
  const segments = getSearchHighlightSegments(text, query);
  if (!segments.some((segment) => segment.highlighted)) return text;

  return segments.map((segment, index) => (
    segment.highlighted
      ? <mark key={index} className="rounded-sm bg-primary/30 px-0.5 font-semibold text-foreground underline decoration-primary/60 decoration-1 underline-offset-2">{segment.text}</mark>
      : segment.text
  ));
}

export function ErrorState({ error, onRetry }: { error: string; onRetry?: () => void }) {
  const [copied, setCopied] = useState(false);

  const copyError = async () => {
    try {
      await copyText(error);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div className="rounded-md border border-destructive/30 bg-destructive/5 p-5">
      <p className="font-medium text-foreground">搜索没有完成</p>
      <p className="mt-1 break-words text-xs leading-5 text-muted-foreground">{error}</p>
      <div className="mt-4 flex flex-wrap items-center gap-2">
        {onRetry && (
          <Button variant="outline" size="sm" onClick={onRetry}>
            <RefreshCw className="mr-2 h-3.5 w-3.5" />
            重试
          </Button>
        )}
        <Button variant="ghost" size="sm" onClick={() => void copyError()}>
          {copied ? <Check className="mr-2 h-3.5 w-3.5 text-primary" /> : <Copy className="mr-2 h-3.5 w-3.5" />}
          {copied ? "已复制" : "复制错误信息"}
        </Button>
      </div>
    </div>
  );
}
