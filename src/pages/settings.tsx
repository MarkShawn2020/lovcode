import { useEffect, useState } from "react";
import { ChevronDown, DatabaseZap, FileClock, Loader2, Settings2 } from "lucide-react";
import { AppUpdatePanel } from "@/components/AppUpdatePanel";
import { useSearchIndexBuildStatus } from "@/hooks/useSearchIndexBuildStatus";
import {
  copyText,
  getIncrementalSearchIndexSyncStatus,
  getSemanticSearchStatus,
  initializeSemanticSearch,
  previewSemanticSearchInitialization,
  setIncrementalSearchIndexSyncEnabled,
  setSemanticSearchEnabled,
  type IncrementalSearchIndexSyncStatus,
  type SemanticSearchInitializationPreview,
  type SemanticSearchStatus,
  type SearchIndexWatchTarget,
} from "@/modules/api/ataru";

const semanticErrorContext = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

const dateTimeFormatter = new Intl.DateTimeFormat("zh-CN", {
  month: "numeric",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});

function formatSyncTime(value: number | null | undefined) {
  return value ? dateTimeFormatter.format(new Date(value * 1000)) : "尚未触发";
}

function WatchTargetFiles({ target }: { target: SearchIndexWatchTarget }) {
  const [open, setOpen] = useState(false);

  return (
    <details
      className="group rounded-lg border border-border bg-background/60"
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary className="flex cursor-pointer list-none items-center gap-3 px-3 py-2.5 outline-none transition-colors hover:bg-primary/5 focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
        <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform group-open:rotate-180" />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium text-foreground">{target.source}</span>
          <span className="mt-0.5 block truncate font-mono text-[11px] text-muted-foreground" title={target.rootPath}>{target.rootPath}</span>
        </span>
        <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{target.files.length.toLocaleString()} 个文件</span>
      </summary>

      {open && (
        <div className="border-t border-border px-3 py-3">
          {target.files.length === 0 ? (
            <p className="text-xs leading-5 text-muted-foreground">该位置暂时还没有可同步的会话文件。</p>
          ) : (
            <ul className="max-h-56 space-y-1 overflow-y-auto pr-1" aria-label={`${target.source} 监控文件`}>
              {target.files.map((file) => (
                <li key={file} className="break-all rounded-md px-2 py-1 font-mono text-[11px] leading-5 text-muted-foreground hover:bg-muted/70">
                  {file}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </details>
  );
}

export default function SettingsPage() {
  const { status: indexStatus, activity: indexActivity } = useSearchIndexBuildStatus();
  const [incrementalSync, setIncrementalSync] = useState<IncrementalSearchIndexSyncStatus | null>(null);
  const [incrementalSyncBusy, setIncrementalSyncBusy] = useState(false);
  const [incrementalSyncError, setIncrementalSyncError] = useState<string | null>(null);
  const [semantic, setSemantic] = useState<SemanticSearchStatus | null>(null);
  const [semanticBusy, setSemanticBusy] = useState(false);
  const [semanticError, setSemanticError] = useState<string | null>(null);
  const [semanticPreview, setSemanticPreview] = useState<SemanticSearchInitializationPreview | null>(null);
  const diagnostic = semanticError ?? semantic?.error ?? null;
  const incrementalSyncEnabled = incrementalSync?.enabled ?? true;
  const watchedFileCount = incrementalSync?.targets.reduce((total, target) => total + target.files.length, 0) ?? 0;
  const incrementalSyncDiagnostic = incrementalSyncError
    ? [
        "Ataru 增量同步诊断",
        `错误: ${incrementalSyncError}`,
        `开关: ${incrementalSyncEnabled ? "开启" : "暂停"}`,
        `搜索索引: ${indexStatus?.state ?? "unknown"}`,
        `监控文件: ${watchedFileCount}`,
        `最近文件变动: ${formatSyncTime(incrementalSync?.lastChangeAt)}`,
        `最近同步请求: ${formatSyncTime(incrementalSync?.lastSyncRequestedAt)}`,
      ].join("\n")
    : null;

  const refreshSemanticStatus = async () => {
    try {
      setSemanticError(null);
      setSemantic(await getSemanticSearchStatus());
    } catch (error) {
      setSemanticError(semanticErrorContext(error));
    }
  };

  const refreshIncrementalSyncStatus = async () => {
    try {
      setIncrementalSyncError(null);
      setIncrementalSync(await getIncrementalSearchIndexSyncStatus());
    } catch (error) {
      setIncrementalSyncError(semanticErrorContext(error));
    }
  };

  useEffect(() => {
    void refreshSemanticStatus();
    void refreshIncrementalSyncStatus();
  }, []);

  useEffect(() => {
    if (indexStatus?.completedAt) {
      void refreshIncrementalSyncStatus();
    }
  }, [indexStatus?.completedAt]);

  const toggleIncrementalSync = async () => {
    setIncrementalSyncBusy(true);
    try {
      setIncrementalSyncError(null);
      setIncrementalSync(await setIncrementalSearchIndexSyncEnabled(!incrementalSyncEnabled));
    } catch (error) {
      setIncrementalSyncError(semanticErrorContext(error));
    } finally {
      setIncrementalSyncBusy(false);
    }
  };

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

  const previewSemanticInitialization = async () => {
    setSemanticBusy(true);
    try {
      setSemanticError(null);
      setSemanticPreview(await previewSemanticSearchInitialization());
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
                <FileClock className="h-4 w-4" />
                <span className="text-sm font-medium">本地搜索</span>
              </div>
              <h2 className="mt-2 font-serif text-lg font-semibold text-foreground">增量同步</h2>
              <p className="mt-2 max-w-xl text-sm leading-6 text-muted-foreground">
                会话文件发生变动后，Ataru 会只处理新增或变更的片段，并自动同步本地搜索索引。
              </p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={incrementalSyncEnabled}
              disabled={incrementalSyncBusy}
              onClick={() => void toggleIncrementalSync()}
              className="inline-flex shrink-0 items-center rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {incrementalSyncBusy && <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />}
              {incrementalSyncEnabled ? "已开启" : "已暂停"}
            </button>
          </div>

          <div className="mt-5 rounded-lg border border-border bg-background/60 p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-sm font-medium text-foreground">
                  {incrementalSync?.monitoring
                    ? `正在监控 ${watchedFileCount.toLocaleString()} 个会话文件`
                    : incrementalSyncEnabled
                      ? "正在读取监控范围"
                      : "已暂停自动同步"}
                </p>
                <p className="mt-1 text-xs leading-5 text-muted-foreground">
                  {indexActivity.syncing
                    ? "检测到变动，正在同步搜索索引。"
                    : `最近同步请求：${formatSyncTime(incrementalSync?.lastSyncRequestedAt)}`}
                </p>
              </div>
              {incrementalSync?.lastChangeAt && (
                <span className="rounded-md bg-card px-2 py-1 text-xs text-muted-foreground">最近变动：{formatSyncTime(incrementalSync.lastChangeAt)}</span>
              )}
            </div>

            <div className="mt-4 space-y-2">
              {incrementalSync?.targets.map((target) => <WatchTargetFiles key={target.source} target={target} />)}
            </div>
          </div>

          {incrementalSyncDiagnostic && (
            <div className="mt-4 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-xs leading-5 text-destructive">
              <div className="flex items-start justify-between gap-3">
                <code className="min-w-0 break-all">{incrementalSyncError}</code>
                <button
                  type="button"
                  onClick={() => void copyText(incrementalSyncDiagnostic)}
                  className="shrink-0 rounded-md border border-destructive/30 px-2 py-1 text-[11px] text-foreground hover:bg-background"
                >
                  复制诊断
                </button>
              </div>
            </div>
          )}
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
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    disabled={semanticBusy}
                    onClick={() => void previewSemanticInitialization()}
                    className="rounded-lg border border-border bg-card px-3 py-2 text-sm font-medium text-foreground transition-colors hover:border-primary/50 hover:bg-primary/5 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    检查初始化范围
                  </button>
                  <button
                    type="button"
                    disabled={semanticBusy || !semantic.configured}
                    onClick={() => void initializeSemantic()}
                    className="rounded-lg border border-border bg-card px-3 py-2 text-sm font-medium text-foreground transition-colors hover:border-primary/50 hover:bg-primary/5 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    初始化本地索引
                  </button>
                </div>
              </div>
              {semanticPreview && (
                <p className="mt-3 text-xs leading-5 text-muted-foreground">
                  已抽样扫描 {semanticPreview.sampledSessions.toLocaleString()} / {semanticPreview.sourceSessions.toLocaleString()} 个会话，估计约 {semanticPreview.candidateChunks.toLocaleString()} 个文本片段、{semanticPreview.embeddingBatches.toLocaleString()} 批 Embedding 请求；仅本地扫描，未发送任何对话内容。
                </p>
              )}
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
