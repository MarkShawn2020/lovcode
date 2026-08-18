import { useMemo, useState } from "react";
import { Check, Copy, RotateCcw } from "lucide-react";
import { isRouteErrorResponse, useRouteError } from "react-router-dom";

/**
 * Router-level fallback. Replaces React Router's developer error screen so a
 * bad route on the public site degrades into something a visitor can act on —
 * and something a reporter can paste back to us verbatim.
 */
export function RouteErrorBoundary() {
  const error = useRouteError();
  const [copied, setCopied] = useState(false);

  const { headline, detail } = useMemo(() => {
    // Mounted as the catch-all `element` there is no thrown error to read —
    // the unmatched path itself is the whole story.
    if (error == null) {
      return { headline: "这个页面不存在", detail: `404 ${window.location.hash || "#/"}` };
    }
    if (isRouteErrorResponse(error)) {
      return {
        headline: error.status === 404 ? "这个页面不存在" : `请求失败（${error.status}）`,
        detail: `${error.status} ${error.statusText}`,
      };
    }
    if (error instanceof Error) return { headline: "页面加载失败", detail: error.message };
    return { headline: "页面加载失败", detail: String(error) };
  }, [error]);

  const report = useMemo(
    () =>
      [
        `error: ${detail}`,
        `url: ${window.location.href}`,
        `version: ${__APP_VERSION__}`,
        `ua: ${navigator.userAgent}`,
        error instanceof Error && error.stack ? `stack:\n${error.stack}` : "",
      ]
        .filter(Boolean)
        .join("\n"),
    [detail, error]
  );

  const copy = () => {
    void navigator.clipboard.writeText(report).then(() => setCopied(true));
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-6 text-foreground">
      <div className="w-full max-w-md">
        <h1 className="font-serif text-2xl font-semibold tracking-tight">{headline}</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          可以返回首页重试。如果反复出现，把下面的诊断信息复制给我们。
        </p>

        <pre className="mt-5 max-h-40 overflow-auto rounded-xl border border-border bg-card p-3 font-mono text-[11px] leading-relaxed text-muted-foreground">
          {detail}
        </pre>

        <div className="mt-5 flex items-center gap-2">
          {/* Full navigation, not a hash change: index.html re-runs its host gate,
              so the public site lands on /#/landing instead of the app shell. */}
          <a
            href="/"
            className="inline-flex h-9 items-center gap-2 rounded-lg bg-primary px-3.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            <RotateCcw className="h-4 w-4" />
            返回首页
          </a>
          <button
            type="button"
            onClick={copy}
            className="inline-flex h-9 items-center gap-2 rounded-lg border border-border px-3.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
            {copied ? "已复制诊断信息" : "复制诊断信息"}
          </button>
        </div>
      </div>
    </div>
  );
}
