import { useEffect, useState } from "react";
import { DatabaseZap, Loader2, Settings2 } from "lucide-react";
import { AppUpdatePanel } from "@/components/AppUpdatePanel";
import {
  getSemanticSearchStatus,
  initializeSemanticSearch,
  setSemanticSearchEnabled,
  type SemanticSearchStatus,
} from "@/modules/api/ataru";

const semanticErrorContext = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

export default function SettingsPage() {
  const [semantic, setSemantic] = useState<SemanticSearchStatus | null>(null);
  const [semanticBusy, setSemanticBusy] = useState(false);
  const [semanticError, setSemanticError] = useState<string | null>(null);
  const diagnostic = semanticError ?? semantic?.error ?? null;

  const refreshSemanticStatus = async () => {
    try {
      setSemanticError(null);
      setSemantic(await getSemanticSearchStatus());
    } catch (error) {
      setSemanticError(semanticErrorContext(error));
    }
  };

  useEffect(() => {
    void refreshSemanticStatus();
  }, []);

  const toggleSemantic = async () => {
    const enabled = !(semantic?.enabled ?? false);
    setSemanticBusy(true);
    try {
      setSemanticError(null);
      setSemantic(await setSemanticSearchEnabled(enabled));
    } catch (error) {
      setSemanticError(semanticErrorContext(error));
    } finally {
      setSemanticBusy(false);
    }
  };

  const initializeSemantic = async () => {
    setSemanticBusy(true);
    try {
      setSemanticError(null);
      setSemantic(await initializeSemanticSearch());
    } catch (error) {
      setSemanticError(semanticErrorContext(error));
    } finally {
      setSemanticBusy(false);
    }
  };

  return (
    <div className="h-full overflow-auto bg-background">
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 p-8">
        <header className="space-y-1">
          <div className="flex items-center gap-2 text-primary">
            <Settings2 className="h-5 w-5" />
            <span className="text-sm font-medium">应用设置</span>
          </div>
          <h1 className="font-serif text-2xl font-semibold text-foreground">设置</h1>
        </header>

        <section className="rounded-xl border border-border bg-card p-6">
          <h2 className="font-serif text-lg font-semibold text-foreground">本地体验</h2>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            搜索索引、对话档案与应用偏好将在这里统一管理。
          </p>
        </section>

        <section className="rounded-xl border border-border bg-card p-6">
          <div className="flex items-start justify-between gap-6">
            <div className="min-w-0">
              <div className="flex items-center gap-2 text-primary">
                <DatabaseZap className="h-4 w-4" />
                <span className="text-sm font-medium">高级检索</span>
              </div>
              <h2 className="mt-2 font-serif text-lg font-semibold text-foreground">语义检索</h2>
              <p className="mt-2 max-w-xl text-sm leading-6 text-muted-foreground">
                默认只使用本地关键词检索。启用后，Ataru 会在你明确初始化时调用已配置的 Embedding 服务，并将向量索引保存在本机 SQLite 中。
              </p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={semantic?.enabled ?? false}
              disabled={semanticBusy}
              onClick={() => void toggleSemantic()}
              className="inline-flex shrink-0 items-center rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {semanticBusy && <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />}
              {semantic?.enabled ? "已启用" : "启用"}
            </button>
          </div>

          {semantic?.enabled && (
            <div className="mt-5 rounded-lg border border-border bg-background/60 p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="text-sm text-foreground">
                  {semantic.ready
                    ? `已就绪 · SQLite · ${semantic.entries.toLocaleString()} 条索引记录`
                    : semantic.configured
                      ? "已读取 Embedding 配置，等待初始化本地索引"
                      : "尚未读取到 Embedding 配置"}
                </div>
                <button
                  type="button"
                  disabled={semanticBusy || !semantic.configured}
                  onClick={() => void initializeSemantic()}
                  className="rounded-lg border border-border bg-card px-3 py-2 text-sm font-medium text-foreground transition-colors hover:border-primary/50 hover:bg-primary/5 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  初始化本地索引
                </button>
              </div>
              {!semantic.configured && (
                <p className="mt-3 text-xs leading-5 text-muted-foreground">
                  请先在 Claude 配置的 env 中设置 <code>LOVCODE_EMBEDDING_BASE_URL</code>、<code>LOVCODE_EMBEDDING_MODEL</code>，以及需要时的 <code>LOVCODE_EMBEDDING_API_KEY</code>。
                </p>
              )}
            </div>
          )}

          {diagnostic && (
            <div className="mt-4 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-xs leading-5 text-destructive">
              <div className="flex items-start justify-between gap-3">
                <code className="min-w-0 break-all">{diagnostic}</code>
                <button
                  type="button"
                  onClick={() => void navigator.clipboard.writeText(diagnostic)}
                  className="shrink-0 rounded-md border border-destructive/30 px-2 py-1 text-[11px] text-foreground hover:bg-background"
                >
                  复制诊断
                </button>
              </div>
            </div>
          )}
        </section>

        <AppUpdatePanel />
      </div>
    </div>
  );
}
