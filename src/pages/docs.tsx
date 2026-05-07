import { useMemo, useState } from "react";
import { invoke } from "@/lib/tauri";
import { useQueries } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import {
  BookOpen,
  Database,
  ExternalLink,
  FileText,
  FolderOpen,
  Github,
  Layers3,
  Library,
  Search,
  Sparkles,
  type LucideIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { DocumentReader, type DocumentItem } from "@/components/DocumentReader";
import { useInvokeQuery } from "@/hooks";
import { useI18n, type Language } from "@/i18n";
import type { DocNode, DocSource, DocSourceKind } from "@/types";

interface DocEntry extends DocumentItem {
  sourceId: string;
  sourceName: string;
  sourceKind: DocSourceKind;
  relPath: string;
  depth: number;
}

interface SourceStats {
  source: DocSource;
  docs: DocEntry[];
  loading: boolean;
}

const kindIcon: Record<DocSourceKind, LucideIcon> = {
  bundled: Library,
  github: Github,
  symlink: FolderOpen,
  vault: Database,
};

function normalizePath(path: string) {
  return path.replace(/\\/g, "/").replace(/\/+$/, "");
}

function relativeDocPath(path: string, root: string) {
  const normalizedPath = normalizePath(path);
  const normalizedRoot = normalizePath(root);
  if (normalizedPath.startsWith(normalizedRoot)) {
    return normalizedPath.slice(normalizedRoot.length).replace(/^\/+/, "");
  }
  return normalizedPath.split("/").pop() ?? normalizedPath;
}

function flattenTree(source: DocSource, nodes: DocNode[], parentDir = "", depth = 0): DocEntry[] {
  const docs: DocEntry[] = [];

  for (const node of nodes) {
    if (node.type === "file") {
      const relPath = relativeDocPath(node.path, source.path);
      docs.push({
        name: node.name,
        path: node.path,
        group: parentDir || null,
        sourceId: source.id,
        sourceName: source.name,
        sourceKind: source.kind,
        relPath,
        depth,
      });
    } else {
      const nextDir = parentDir ? `${parentDir}/${node.name}` : node.name;
      docs.push(...flattenTree(source, node.children, nextDir, depth + 1));
    }
  }

  return docs;
}

function includesQuery(doc: DocEntry, query: string) {
  if (!query) return true;
  const haystack = `${doc.name} ${doc.relPath} ${doc.group ?? ""} ${doc.sourceName}`.toLowerCase();
  return haystack.includes(query.toLowerCase());
}

function labelForKind(kind: DocSourceKind, language: Language) {
  const labels: Record<DocSourceKind, Record<Language, string>> = {
    bundled: { en: "Bundled", zh: "内置" },
    github: { en: "GitHub", zh: "GitHub" },
    symlink: { en: "Linked", zh: "链接" },
    vault: { en: "Vault", zh: "Vault" },
  };
  return labels[kind][language];
}

export default function DocsPage() {
  const navigate = useNavigate();
  const { activeLanguage } = useI18n();
  const [search, setSearch] = useState("");
  const [activeSourceId, setActiveSourceId] = useState<string>("all");
  const [selectedPath, setSelectedPath] = useState("");

  const copy = useMemo(
    () => ({
      eyebrow: activeLanguage === "zh" ? "Lovcode Docs" : "Lovcode Docs",
      title: activeLanguage === "zh" ? "文档中心" : "Docs Center",
      subtitle:
        activeLanguage === "zh"
          ? "统一浏览内置参考、GitHub 文档、本地 vault 和沉淀笔记。搜索入口很轻，阅读体验很重。"
          : "Browse bundled references, GitHub docs, local vaults, and distilled notes in one place. Search stays light; reading stays serious.",
      search: activeLanguage === "zh" ? "搜索标题、路径或来源..." : "Search titles, paths, or sources...",
      allSources: activeLanguage === "zh" ? "全部来源" : "All sources",
      manage: activeLanguage === "zh" ? "管理来源" : "Manage sources",
      distill: activeLanguage === "zh" ? "查看沉淀" : "View distill",
      emptyTitle: activeLanguage === "zh" ? "还没有可读文档" : "No readable docs yet",
      emptyBody:
        activeLanguage === "zh"
          ? "进入知识区添加 GitHub 仓库或本地文档目录。"
          : "Open Knowledge to add a GitHub repository or a local documentation folder.",
      results: activeLanguage === "zh" ? "文档结果" : "Document results",
      sources: activeLanguage === "zh" ? "来源" : "Sources",
      sourceKinds: activeLanguage === "zh" ? "来源类型" : "Source kinds",
    }),
    [activeLanguage],
  );

  const { data: sources = [], isLoading: sourcesLoading } = useInvokeQuery<DocSource[]>(["docSources"], "list_doc_sources");
  const visibleSources = useMemo(() => sources.filter((source) => !source.hidden), [sources]);
  const kindCounts = useMemo(() => {
    return visibleSources.reduce<Record<DocSourceKind, number>>(
      (counts, source) => ({ ...counts, [source.kind]: counts[source.kind] + 1 }),
      { bundled: 0, github: 0, symlink: 0, vault: 0 },
    );
  }, [visibleSources]);

  const treeQueries = useQueries({
    queries: visibleSources.map((source) => ({
      queryKey: ["docTree", source.id],
      queryFn: () => invoke<DocNode[]>("list_doc_tree", { sourceId: source.id }),
      staleTime: Infinity,
      refetchOnMount: false,
      refetchOnWindowFocus: false,
    })),
  });

  const sourceStats = useMemo<SourceStats[]>(() => {
    return visibleSources.map((source, index) => {
      const query = treeQueries[index];
      return {
        source,
        docs: flattenTree(source, (query?.data ?? []) as DocNode[]),
        loading: Boolean(query?.isLoading),
      };
    });
  }, [treeQueries, visibleSources]);

  const allDocs = useMemo(() => sourceStats.flatMap((entry) => entry.docs), [sourceStats]);
  const sourceFilteredDocs = useMemo(
    () => (activeSourceId === "all" ? allDocs : allDocs.filter((doc) => doc.sourceId === activeSourceId)),
    [activeSourceId, allDocs],
  );
  const filteredDocs = useMemo(
    () => sourceFilteredDocs.filter((doc) => includesQuery(doc, search)).slice(0, 120),
    [search, sourceFilteredDocs],
  );
  const selectedDoc = useMemo(
    () => (selectedPath ? allDocs.find((doc) => doc.path === selectedPath) : undefined),
    [allDocs, selectedPath],
  );
  const readerDocs = useMemo(
    () => (selectedDoc ? allDocs.filter((doc) => doc.sourceId === selectedDoc.sourceId) : []),
    [allDocs, selectedDoc],
  );
  const currentIndex = selectedDoc ? readerDocs.findIndex((doc) => doc.path === selectedDoc.path) : -1;
  const selectedFilePath = selectedDoc?.path ?? "";
  const { data: selectedContent = "", isLoading: docLoading } = useInvokeQuery<string>(
    ["docsFile", selectedFilePath],
    "read_file",
    { path: selectedFilePath },
    { enabled: Boolean(selectedFilePath) },
  );

  const docsLoading = sourcesLoading || treeQueries.some((query) => query.isLoading);

  if (selectedDoc && currentIndex >= 0) {
    return (
      <DocumentReader
        documents={readerDocs}
        currentIndex={currentIndex}
        content={selectedContent}
        loading={docLoading}
        sourceName={selectedDoc.sourceName}
        onNavigate={(index) => {
          const next = readerDocs[index];
          if (next) setSelectedPath(next.path);
        }}
        onBack={() => setSelectedPath("")}
      />
    );
  }

  return (
    <div className="h-full overflow-auto bg-background text-foreground">
      <div className="mx-auto max-w-7xl px-6 py-8 lg:px-8">
        <header className="border-b border-border pb-7">
          <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <div className="mb-3 flex items-center gap-3 text-[11px] uppercase tracking-[0.22em] text-muted-foreground">
                <span className="h-px w-8 bg-border" />
                <span>{copy.eyebrow}</span>
              </div>
              <h1 className="font-serif text-4xl leading-tight text-foreground lg:text-5xl">{copy.title}</h1>
              <p className="mt-3 max-w-2xl text-sm leading-6 text-muted-foreground">{copy.subtitle}</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="outline" className="rounded-lg" onClick={() => navigate("/knowledge/distill")}>
                <Sparkles className="mr-2 h-4 w-4" />
                {copy.distill}
              </Button>
              <Button className="rounded-lg" onClick={() => navigate("/knowledge/distill")}>
                <ExternalLink className="mr-2 h-4 w-4" />
                {copy.manage}
              </Button>
            </div>
          </div>

          <div className="mt-6 grid gap-3 sm:grid-cols-3">
            <Metric label={activeLanguage === "zh" ? "文档" : "Docs"} value={allDocs.length} />
            <Metric label={activeLanguage === "zh" ? "来源" : "Sources"} value={visibleSources.length} />
            <Metric label={activeLanguage === "zh" ? "可刷新源" : "Refreshable"} value={visibleSources.filter((source) => source.kind === "github").length} />
          </div>
        </header>

        <section className="mt-6 grid gap-5 lg:grid-cols-[280px_minmax(0,1fr)]">
          <aside className="space-y-3">
            <div className="rounded-xl border border-border bg-card p-3">
              <div className="mb-2 flex items-center gap-2 px-1 text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">
                <Layers3 className="h-3.5 w-3.5" />
                {copy.sources}
              </div>
              <button
                type="button"
                onClick={() => setActiveSourceId("all")}
                className={`flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm transition-colors ${
                  activeSourceId === "all" ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-card-alt hover:text-foreground"
                }`}
              >
                <span>{copy.allSources}</span>
                <span>{allDocs.length}</span>
              </button>
              <div className="mt-2 space-y-1">
                {sourceStats.map(({ source, docs, loading }) => {
                  const Icon = kindIcon[source.kind];
                  const active = activeSourceId === source.id;
                  return (
                    <button
                      key={source.id}
                      type="button"
                      onClick={() => setActiveSourceId(source.id)}
                      className={`flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm transition-colors ${
                        active ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-card-alt hover:text-foreground"
                      }`}
                      title={source.path}
                    >
                      <Icon className="h-4 w-4 shrink-0" />
                      <span className="min-w-0 flex-1 truncate">{source.name}</span>
                      <span className="text-xs">{loading ? "..." : docs.length}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="rounded-xl border border-border bg-card p-4">
              <div className="mb-2 flex items-center gap-2 text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">
                <BookOpen className="h-3.5 w-3.5" />
                {copy.sourceKinds}
              </div>
              <div className="divide-y divide-border">
                {(["bundled", "github", "vault", "symlink"] as DocSourceKind[]).map((kind) => {
                  const Icon = kindIcon[kind];
                  return (
                    <div key={kind} className="flex items-center justify-between gap-3 py-2 text-sm first:pt-0 last:pb-0">
                      <span className="flex items-center gap-2 text-muted-foreground">
                        <Icon className="h-4 w-4 text-primary" />
                        {labelForKind(kind, activeLanguage)}
                      </span>
                      <span className="font-medium text-foreground">{kindCounts[kind]}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          </aside>

          <main className="min-w-0">
            <div className="rounded-xl border border-border bg-card p-4">
              <label className="relative block">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder={copy.search}
                  className="h-11 w-full rounded-lg border border-input bg-background pl-10 pr-3 text-sm text-foreground outline-none transition-colors placeholder:text-muted-foreground focus:border-primary"
                />
              </label>
            </div>

            <div className="mt-4 rounded-xl border border-border bg-card">
              <div className="flex items-center justify-between border-b border-border px-4 py-3">
                <h2 className="font-serif text-lg text-foreground">{copy.results}</h2>
                <span className="text-xs text-muted-foreground">{docsLoading ? "..." : filteredDocs.length}</span>
              </div>

              {docsLoading && allDocs.length === 0 ? (
                <div className="divide-y divide-border">
                  {[0, 1, 2, 3].map((index) => (
                    <div key={index} className="flex items-start gap-3 px-4 py-3">
                      <div className="h-9 w-9 shrink-0 rounded-lg bg-muted" />
                      <div className="min-w-0 flex-1 space-y-2">
                        <div className="h-4 w-1/3 rounded-lg bg-muted" />
                        <div className="h-3 w-2/3 rounded-lg bg-muted" />
                      </div>
                    </div>
                  ))}
                </div>
              ) : filteredDocs.length > 0 ? (
                <div className="divide-y divide-border">
                  {filteredDocs.map((doc) => {
                    const Icon = kindIcon[doc.sourceKind];
                    return (
                      <button
                        key={doc.path}
                        type="button"
                        onClick={() => setSelectedPath(doc.path)}
                        className="group flex w-full min-w-0 items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-card-alt"
                      >
                        <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-border bg-background text-primary">
                          <FileText className="h-4 w-4" />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate font-medium text-foreground group-hover:text-primary">{doc.name}</span>
                          <span className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                            <span className="inline-flex items-center gap-1">
                              <Icon className="h-3.5 w-3.5" />
                              {doc.sourceName}
                            </span>
                            <span>{labelForKind(doc.sourceKind, activeLanguage)}</span>
                            <span className="max-w-full truncate font-mono">{doc.relPath}</span>
                          </span>
                        </span>
                      </button>
                    );
                  })}
                </div>
              ) : (
                <div className="px-6 py-16 text-center">
                  <BookOpen className="mx-auto h-10 w-10 text-muted-foreground" />
                  <h3 className="mt-4 font-serif text-2xl text-foreground">{copy.emptyTitle}</h3>
                  <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-muted-foreground">{copy.emptyBody}</p>
                  <Button className="mt-5 rounded-lg" onClick={() => navigate("/knowledge/distill")}>
                    {copy.manage}
                  </Button>
                </div>
              )}
            </div>
          </main>
        </section>
      </div>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl border border-border bg-card px-4 py-3">
      <div className="text-2xl font-semibold text-foreground">{value.toLocaleString()}</div>
      <div className="mt-1 text-xs uppercase tracking-[0.18em] text-muted-foreground">{label}</div>
    </div>
  );
}
