import { Check, Copy, RefreshCw } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { copyText } from "@/modules/api/ataru";
import { searchTerms } from "./utils";

export function HighlightedText({ text, query }: { text: string; query: string }) {
  const terms = searchTerms(query);
  if (terms.length === 0) return text;
  const escaped = terms.map((term) => term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const pattern = new RegExp(`(${escaped.join("|")})`, "gi");
  const matches = new Set(terms.map((term) => term.toLocaleLowerCase()));
  return text.split(pattern).map((part, index) => (
    matches.has(part.toLocaleLowerCase())
      ? <mark key={`${part}:${index}`} className="rounded-sm bg-primary/20 px-0.5 font-semibold text-foreground underline decoration-primary/40 decoration-1 underline-offset-2">{part}</mark>
      : part
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
