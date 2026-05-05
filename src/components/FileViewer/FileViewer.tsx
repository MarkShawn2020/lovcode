import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { useAtom } from "jotai";
import { fileViewModeAtom } from "@/store";
import { invoke, convertFileSrc } from "@tauri-apps/api/core";
import {
  Cross2Icon,
  ExternalLinkIcon,
  CodeIcon,
  ReaderIcon,
  ColumnsIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  DotsHorizontalIcon,
  FileIcon,
} from "@radix-ui/react-icons";
import { Archive, FileWarning, Folder } from "lucide-react";
import Editor from "@monaco-editor/react";
import { MarkdownRenderer } from "../MarkdownRenderer";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../ui/dropdown-menu";
import { cn, getAbsoluteParentPath, isImageFile } from "@/lib/utils";

const EDITOR_OPTIONS = {
  readOnly: true,
  minimap: { enabled: false },
  scrollBeyondLastLine: false,
  fontSize: 13,
  lineHeight: 20,
  fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
  renderLineHighlight: "none" as const,
  overviewRulerLanes: 0,
  hideCursorInOverviewRuler: true,
  overviewRulerBorder: false,
  scrollbar: { vertical: "auto" as const, horizontal: "auto" as const, verticalScrollbarSize: 8, horizontalScrollbarSize: 8 },
  padding: { top: 12, bottom: 12 },
};

// Map file extension to Monaco language
function getLanguage(path: string): string {
  const ext = path.split(".").pop()?.toLowerCase() || "";
  const map: Record<string, string> = {
    ts: "typescript",
    tsx: "typescript",
    js: "javascript",
    jsx: "javascript",
    py: "python",
    rb: "ruby",
    rs: "rust",
    go: "go",
    java: "java",
    kt: "kotlin",
    swift: "swift",
    c: "c",
    cpp: "cpp",
    h: "c",
    hpp: "cpp",
    cs: "csharp",
    php: "php",
    html: "html",
    css: "css",
    scss: "scss",
    less: "less",
    json: "json",
    yaml: "yaml",
    yml: "yaml",
    toml: "ini",
    xml: "xml",
    md: "markdown",
    sql: "sql",
    sh: "shell",
    bash: "shell",
    zsh: "shell",
    dockerfile: "dockerfile",
    makefile: "makefile",
  };
  return map[ext] || "plaintext";
}

interface FileViewerProps {
  filePath: string;
  onClose: () => void;
  onOpenFilePath?: (path: string) => void;
  /** Optional line to reveal once content is loaded (1-indexed). */
  revealLine?: number;
  /** Optional column to place the cursor at (1-indexed). */
  revealColumn?: number;
  /** Bumped by parent on every open call so reveal re-runs even if path is unchanged. */
  revealNonce?: number;
}

interface ImageInfo {
  width: number;
  height: number;
  fileSize: number;
  modified?: number;
}

interface DirEntry {
  name: string;
  path: string;
  is_dir: boolean;
}

interface ArchiveEntry {
  name: string;
  path: string;
  is_dir: boolean;
  size: number;
  compressed_size: number;
}

interface ArchiveListing {
  entries: ArchiveEntry[];
  total_entries: number;
  truncated: boolean;
}

interface ArchiveTreeNode {
  name: string;
  path: string;
  isDir: boolean;
  children: ArchiveTreeNode[];
  size: number;
  compressedSize: number;
}

interface MutableArchiveTreeNode extends ArchiveTreeNode {
  childMap: Map<string, MutableArchiveTreeNode>;
}

interface UnsupportedPreviewInfo {
  title: string;
  description: string;
}

interface BreadcrumbSegment {
  name: string;
  path: string;
}

interface MonacoEditorLike {
  getModel(): {
    getLineCount(): number;
    onDidChangeContent(listener: () => void): { dispose(): void };
  } | null;
  getLayoutInfo?: () => { height: number; width: number };
  revealLineInCenter(lineNumber: number): void;
  setPosition(position: { lineNumber: number; column: number }): void;
  focus(): void;
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function createArchiveTreeNode(name: string, path: string, isDir: boolean): MutableArchiveTreeNode {
  return {
    name,
    path,
    isDir,
    children: [],
    childMap: new Map(),
    size: 0,
    compressedSize: 0,
  };
}

function toArchiveTreeNode(node: MutableArchiveTreeNode): ArchiveTreeNode {
  const children = Array.from(node.childMap.values())
    .sort((a, b) => {
      if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
      return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" });
    })
    .map(toArchiveTreeNode);

  return {
    name: node.name,
    path: node.path,
    isDir: node.isDir,
    size: node.size,
    compressedSize: node.compressedSize,
    children,
  };
}

function buildArchiveTree(entries: ArchiveEntry[]): ArchiveTreeNode[] {
  const root = createArchiveTreeNode("", "", true);

  entries.forEach((entry) => {
    const normalized = entry.path.replace(/\\/g, "/").replace(/^\/+/, "");
    const isDirectoryEntry = entry.is_dir || normalized.endsWith("/");
    const parts = normalized.split("/").filter(Boolean);
    if (parts.length === 0) return;

    let current = root;
    let accumulated = "";

    parts.forEach((part, index) => {
      const isLast = index === parts.length - 1;
      const isDir = !isLast || isDirectoryEntry;
      accumulated = accumulated ? `${accumulated}/${part}` : part;

      let child = current.childMap.get(part);
      if (!child) {
        child = createArchiveTreeNode(part, isDir ? `${accumulated}/` : accumulated, isDir);
        current.childMap.set(part, child);
      }

      if (isLast && !isDir) {
        child.size = entry.size;
        child.compressedSize = entry.compressed_size;
      }

      current = child;
    });
  });

  return Array.from(root.childMap.values()).map(toArchiveTreeNode);
}

function countArchiveTree(nodes: ArchiveTreeNode[]) {
  let files = 0;
  let folders = 0;

  const walk = (node: ArchiveTreeNode) => {
    if (node.isDir) {
      folders += 1;
      node.children.forEach(walk);
    } else {
      files += 1;
    }
  };

  nodes.forEach(walk);
  return { files, folders };
}

function isZipArchive(path: string): boolean {
  return path.toLowerCase().endsWith(".zip");
}

function getUnsupportedPreviewInfo(fileName: string): UnsupportedPreviewInfo | null {
  const lower = fileName.toLowerCase();

  if ([".7z", ".rar", ".tar", ".tar.gz", ".tgz", ".gz", ".bz2", ".xz"].some((ext) => lower.endsWith(ext))) {
    return {
      title: "Archive preview is not supported",
      description: "Built-in archive browsing currently supports ZIP files only. Open this archive with the default app to inspect its contents.",
    };
  }

  if ([".pdf", ".doc", ".docx", ".ppt", ".pptx", ".xls", ".xlsx", ".pages", ".numbers", ".key"].some((ext) => lower.endsWith(ext))) {
    return {
      title: "Document preview is not supported",
      description: "This file format needs a dedicated document viewer. Open it with the default app, or reveal it in Finder.",
    };
  }

  if ([".db", ".sqlite", ".sqlite3", ".wasm", ".bin", ".exe", ".dll", ".dylib", ".so", ".class", ".pyc", ".dmg", ".pkg", ".ttf", ".otf", ".woff", ".woff2", ".mp3", ".mp4", ".mov", ".wav", ".webm"].some((ext) => lower.endsWith(ext))) {
    return {
      title: "Binary preview is not supported",
      description: "This file is not a text or image format that Lovcode can render inline. Open it with the default app, or reveal it in Finder.",
    };
  }

  return null;
}

function isUnsupportedUtf8Error(error: string): boolean {
  return /not valid utf-?8|valid utf-?8|stream did not contain valid utf-?8/i.test(error);
}

function UnsupportedPreview({
  info,
  fileName,
  fileSize,
  onOpenDefault,
  onReveal,
}: {
  info: UnsupportedPreviewInfo;
  fileName: string;
  fileSize?: number;
  onOpenDefault: () => void;
  onReveal: () => void;
}) {
  return (
    <div className="flex h-full items-center justify-center bg-background p-6">
      <div className="w-full max-w-md rounded-xl border border-border bg-card p-5 shadow-sm">
        <div className="mb-4 flex items-start gap-3">
          <div className="rounded-lg bg-card-alt p-2 text-muted-foreground">
            <FileWarning className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <h3 className="font-serif text-base font-semibold text-foreground">{info.title}</h3>
            <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{info.description}</p>
          </div>
        </div>
        <dl className="mb-4 space-y-1.5 text-xs">
          <div className="grid grid-cols-[64px_minmax(0,1fr)] gap-2">
            <dt className="text-muted-foreground">File</dt>
            <dd className="truncate font-mono text-foreground" title={fileName}>{fileName}</dd>
          </div>
          {fileSize !== undefined && (
            <div className="grid grid-cols-[64px_minmax(0,1fr)] gap-2">
              <dt className="text-muted-foreground">Size</dt>
              <dd className="font-mono text-foreground">{formatFileSize(fileSize)}</dd>
            </div>
          )}
        </dl>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={onOpenDefault}
            className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            <ExternalLinkIcon className="h-3.5 w-3.5" />
            Open with default app
          </button>
          <button
            type="button"
            onClick={onReveal}
            className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-background px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-card-alt"
          >
            <Folder className="h-3.5 w-3.5" />
            Reveal in Finder
          </button>
        </div>
      </div>
    </div>
  );
}

function ArchiveTreeRows({
  nodes,
  expandedPaths,
  onToggle,
  depth = 0,
}: {
  nodes: ArchiveTreeNode[];
  expandedPaths: Set<string>;
  onToggle: (path: string) => void;
  depth?: number;
}) {
  return (
    <>
      {nodes.map((node) => {
        const expanded = expandedPaths.has(node.path);

        return (
          <li key={node.path}>
            <div
              className="grid grid-cols-[minmax(0,1fr)_88px_88px] items-center gap-3 py-1.5 pr-4 text-sm transition-colors hover:bg-card-alt"
              style={{ paddingLeft: 12 + depth * 16 }}
            >
              {node.isDir ? (
                <button
                  type="button"
                  onClick={() => onToggle(node.path)}
                  className="flex min-w-0 items-center gap-1.5 text-left"
                  title={node.path}
                >
                  <ChevronRightIcon
                    className={cn(
                      "h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform",
                      expanded && "rotate-90",
                    )}
                  />
                  <Folder className="h-4 w-4 shrink-0 text-primary" />
                  <span className="min-w-0 truncate text-foreground">{node.name}</span>
                  <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
                    {node.children.length}
                  </span>
                </button>
              ) : (
                <div className="flex min-w-0 items-center gap-1.5" title={node.path}>
                  <span className="h-3.5 w-3.5 shrink-0" />
                  <FileIcon className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 truncate text-foreground">{node.name}</span>
                </div>
              )}
              <span className="text-right font-mono text-xs text-muted-foreground">
                {node.isDir ? "" : formatFileSize(node.size)}
              </span>
              <span className="text-right font-mono text-xs text-muted-foreground">
                {node.isDir ? "" : formatFileSize(node.compressedSize)}
              </span>
            </div>
            {node.isDir && expanded && node.children.length > 0 && (
              <ul>
                <ArchiveTreeRows
                  nodes={node.children}
                  expandedPaths={expandedPaths}
                  onToggle={onToggle}
                  depth={depth + 1}
                />
              </ul>
            )}
          </li>
        );
      })}
    </>
  );
}

function ArchivePreview({
  listing,
  fileName,
  fileSize,
  onOpenDefault,
  onReveal,
}: {
  listing: ArchiveListing;
  fileName: string;
  fileSize?: number;
  onOpenDefault: () => void;
  onReveal: () => void;
}) {
  const tree = useMemo(() => buildArchiveTree(listing.entries), [listing.entries]);
  const { files: fileCount, folders: folderCount } = useMemo(() => countArchiveTree(tree), [tree]);
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(() => new Set());

  useEffect(() => {
    const next = new Set<string>();
    if (tree.length === 1 && tree[0]?.isDir) {
      next.add(tree[0].path);
    }
    setExpandedPaths(next);
  }, [tree]);

  const togglePath = useCallback((path: string) => {
    setExpandedPaths((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }, []);

  return (
    <div className="flex h-full flex-col bg-background">
      <div className="shrink-0 border-b border-border bg-canvas-alt px-4 py-3">
        <div className="flex items-start gap-3">
          <div className="rounded-lg bg-card-alt p-2 text-muted-foreground">
            <Archive className="h-5 w-5" />
          </div>
          <div className="min-w-0 flex-1">
            <h3 className="truncate font-serif text-base font-semibold text-foreground" title={fileName}>
              {fileName}
            </h3>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {fileCount} files · {folderCount} folders
              {fileSize !== undefined ? ` · ${formatFileSize(fileSize)}` : ""}
              {listing.truncated ? ` · ${listing.entries.length}/${listing.total_entries} shown` : ""}
            </p>
          </div>
          <div className="flex shrink-0 gap-1">
            <button
              type="button"
              onClick={onOpenDefault}
              className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-card-alt hover:text-ink"
              title="Open with default app"
            >
              <ExternalLinkIcon className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={onReveal}
              className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-card-alt hover:text-ink"
              title="Reveal in Finder"
            >
              <Folder className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        {tree.length === 0 ? (
          <div className="flex h-48 items-center justify-center text-sm text-muted-foreground">
            Empty archive
          </div>
        ) : (
          <ul className="py-1">
            <ArchiveTreeRows nodes={tree} expandedPaths={expandedPaths} onToggle={togglePath} />
          </ul>
        )}
      </div>
    </div>
  );
}

function buildBreadcrumbs(path: string): BreadcrumbSegment[] | null {
  if (!path.startsWith("/")) return null;
  const parts = path.split("/").filter(Boolean);
  let acc = "";
  return parts.map((name) => {
    acc += "/" + name;
    return { name, path: acc };
  });
}

function PathBreadcrumbs({
  path,
  segments,
  onNavigate,
  currentIsDir,
  className,
}: {
  path: string;
  segments: BreadcrumbSegment[] | null;
  onNavigate: (path: string) => void;
  currentIsDir?: boolean | null;
  className?: string;
}) {
  if (!segments) {
    return (
      <span className={cn("min-w-0 text-ink", className)} title={path}>
        {path}
      </span>
    );
  }

  const isRoot = path === "/";
  const visibleCount = 2;
  const shouldCollapse = segments.length > visibleCount;
  const visibleSegments = shouldCollapse ? segments.slice(-visibleCount) : segments;
  const hiddenSegments = shouldCollapse ? segments.slice(0, -visibleCount) : [];
  const hiddenMenuSegments = shouldCollapse
    ? [{ name: "/", path: "/" }, ...hiddenSegments]
    : [];
  const separator = (
    <ChevronRightIcon className="h-3 w-3 shrink-0 text-muted-foreground/50" />
  );

  return (
    <nav
      className={cn(
        "flex min-w-0 items-center gap-0.5 overflow-hidden whitespace-nowrap text-muted-foreground",
        className,
      )}
      title={path}
      aria-label="File path"
    >
      {!shouldCollapse && (
        <button
          type="button"
          onClick={() => onNavigate("/")}
          disabled={isRoot}
          className={cn(
            "inline-flex h-5 shrink-0 items-center rounded-md px-1.5 transition-colors",
            isRoot
              ? "cursor-default text-ink"
              : "cursor-pointer hover:bg-card-alt hover:text-primary",
          )}
          title="/"
        >
          /
        </button>
      )}
      {hiddenSegments.length > 0 && (
        <>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className={cn(
                  "inline-flex h-5 shrink-0 items-center justify-center rounded-md px-1 text-muted-foreground transition-colors hover:bg-card-alt hover:text-primary",
                )}
                title="Show parent folders"
              >
                <DotsHorizontalIcon className="h-3.5 w-3.5" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-64">
              {hiddenMenuSegments.map((seg) => (
                <DropdownMenuItem
                  key={seg.path}
                  onSelect={() => onNavigate(seg.path)}
                  className="min-w-0"
                >
                  <Folder className="h-3 w-3 shrink-0 text-muted-foreground" />
                  <span className="min-w-0">
                    <span className="block truncate">{seg.name}</span>
                    <span className="block truncate font-mono text-[10px] text-muted-foreground">
                      {seg.path}
                    </span>
                  </span>
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </>
      )}
      {visibleSegments.map((seg) => {
        const isLast = seg.path === path;
        const showFileIcon = isLast && currentIsDir === false;
        return (
          <span key={seg.path} className="inline-flex min-w-0 items-center gap-0.5">
            {separator}
            <button
              type="button"
              onClick={() => onNavigate(seg.path)}
              disabled={isLast}
              className={cn(
                "inline-flex min-w-0 items-center rounded-md px-1.5 transition-colors",
                isLast ? "h-5 max-w-40" : "h-5 max-w-24",
                isLast
                  ? "cursor-default bg-card-alt text-ink"
                  : "cursor-pointer hover:bg-card-alt hover:text-primary",
              )}
              title={seg.path}
            >
              {showFileIcon && (
                <FileIcon className="h-3 w-3 shrink-0 text-muted-foreground" />
              )}
              <span className="truncate">{seg.name}</span>
            </button>
          </span>
        );
      })}
    </nav>
  );
}

export function FileViewer({
  filePath,
  onClose,
  onOpenFilePath,
  revealLine,
  revealColumn,
  revealNonce,
}: FileViewerProps) {
  // Internal navigation: lets users drill into directories without losing the
  // original `filePath` prop. History stack supports the back button.
  const [currentPath, setCurrentPath] = useState(filePath);
  const [history, setHistory] = useState<string[]>([]);
  const [isDir, setIsDir] = useState<boolean | null>(null);
  const [dirEntries, setDirEntries] = useState<DirEntry[]>([]);
  const [content, setContent] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [unsupportedPreview, setUnsupportedPreview] = useState<UnsupportedPreviewInfo | null>(null);
  const [archiveListing, setArchiveListing] = useState<ArchiveListing | null>(null);
  const [fileSize, setFileSize] = useState<number | null>(null);
  const [viewMode, setViewMode] = useAtom(fileViewModeAtom);
  const [imageInfo, setImageInfo] = useState<ImageInfo | null>(null);

  const editorRef = useRef<MonacoEditorLike | null>(null);
  // Track whether the most recent reveal request has been applied to avoid
  // re-revealing on unrelated re-renders (e.g. user scrolls then resizes).
  const appliedNonceRef = useRef<number | undefined>(undefined);

  // Reset internal state when the parent opens a different path
  useEffect(() => {
    setCurrentPath(filePath);
    setHistory([]);
  }, [filePath]);

  // Reveal target line if pending and conditions are met. Called both reactively
  // (from useEffect when content/path/nonce changes) and imperatively (from Editor
  // onMount, since Monaco's mount happens via ref assignment which doesn't re-render).
  //
  // Subtle race: when a path is opened for the first time, Monaco mounts AFTER
  // content arrives, but the editor's model may not yet contain the text on the
  // very first onMount tick — so revealLineInCenter targets a line that doesn't
  // exist yet and silently no-ops. We retry once the model actually has enough
  // lines via `onDidChangeModelContent`, and also defer to the next frame so
  // layout is finalized before scrolling.
  const tryRevealTarget = useCallback(() => {
    const ed = editorRef.current;
    if (!ed) return;
    if (!revealLine || revealLine < 1) return;
    if (loading || isDir) return;
    if (revealNonce !== undefined && appliedNonceRef.current === revealNonce)
      return;

    const column = revealColumn && revealColumn > 0 ? revealColumn : 1;

    const doReveal = () => {
      const e = editorRef.current;
      if (!e) return;
      e.revealLineInCenter(revealLine);
      e.setPosition({ lineNumber: revealLine, column });
      e.focus();
      appliedNonceRef.current = revealNonce;
    };

    const model = ed.getModel();
    if (model && model.getLineCount() >= revealLine) {
      requestAnimationFrame(doReveal);
      return;
    }

    if (!model) return;
    const sub = model.onDidChangeContent(() => {
      const m = editorRef.current?.getModel();
      if (!m || m.getLineCount() < revealLine) return;
      sub.dispose();
      requestAnimationFrame(doReveal);
    });
  }, [revealLine, revealColumn, revealNonce, loading, isDir]);

  useEffect(() => {
    tryRevealTarget();
  }, [tryRevealTarget, content, viewMode]);

  const fileName = useMemo(() => currentPath.split("/").pop() || currentPath, [currentPath]);
  const language = useMemo(() => getLanguage(currentPath), [currentPath]);
  const isMarkdown = language === "markdown";
  const isImage = useMemo(() => !isDir && isImageFile(fileName), [isDir, fileName]);
  const imageSrc = useMemo(() => isImage ? convertFileSrc(currentPath) : null, [isImage, currentPath]);
  const fileExt = useMemo(() => fileName.split('.').pop()?.toUpperCase() || '', [fileName]);
  const markdownCwd = useMemo(() => getAbsoluteParentPath(currentPath), [currentPath]);

  const navigateTo = useCallback((path: string) => {
    if (path === currentPath) return;
    setHistory((h) => [...h, currentPath]);
    setCurrentPath(path);
  }, [currentPath]);

  const openDirectoryEntry = useCallback((entry: DirEntry) => {
    if (entry.is_dir) {
      navigateTo(entry.path);
      return;
    }

    if (onOpenFilePath) {
      onOpenFilePath(entry.path);
      return;
    }

    navigateTo(entry.path);
  }, [navigateTo, onOpenFilePath]);

  const breadcrumbs = useMemo(() => buildBreadcrumbs(currentPath), [currentPath]);

  const goBack = useCallback(() => {
    setHistory((h) => {
      if (h.length === 0) return h;
      const next = [...h];
      const prev = next.pop()!;
      setCurrentPath(prev);
      return next;
    });
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setIsDir(null);
    setUnsupportedPreview(null);
    setArchiveListing(null);
    setContent("");
    setDirEntries([]);
    setImageInfo(null);
    setFileSize(null);

    async function load() {
      try {
        const meta = await invoke<{ size: number; modified?: number; is_dir: boolean }>(
          "get_file_metadata",
          { path: currentPath },
        );
        if (cancelled) return;
        setIsDir(meta.is_dir);
        setFileSize(meta.size);

        if (meta.is_dir) {
          const entries = await invoke<DirEntry[]>("list_directory", { path: currentPath });
          if (!cancelled) {
            // Folders first, then alphabetical
            entries.sort((a, b) => {
              if (a.is_dir !== b.is_dir) return a.is_dir ? -1 : 1;
              return a.name.localeCompare(b.name);
            });
            setDirEntries(entries);
            setLoading(false);
          }
          return;
        }

        if (isImageFile(currentPath.split("/").pop() || "")) {
          setImageInfo((prev) =>
            prev
              ? { ...prev, fileSize: meta.size, modified: meta.modified }
              : { width: 0, height: 0, fileSize: meta.size, modified: meta.modified },
          );
          setLoading(false);
          return;
        }

        if (isZipArchive(currentPath)) {
          const listing = await invoke<ArchiveListing>("list_zip_entries", {
            path: currentPath,
            limit: 1000,
          });
          if (!cancelled) {
            setArchiveListing(listing);
            setLoading(false);
          }
          return;
        }

        const unsupportedInfo = getUnsupportedPreviewInfo(currentPath.split("/").pop() || "");
        if (unsupportedInfo) {
          setUnsupportedPreview(unsupportedInfo);
          setLoading(false);
          return;
        }

        const result = await invoke<string>("read_file", { path: currentPath });
        if (!cancelled) {
          setContent(result);
          setLoading(false);
        }
      } catch (err) {
        if (!cancelled) {
          const message = String(err);
          if (isUnsupportedUtf8Error(message)) {
            setUnsupportedPreview({
              title: "Text preview is not supported",
              description: "This file is not valid UTF-8 text. Lovcode can preview UTF-8 text, Markdown, images, folders, and ZIP archives inline.",
            });
          } else if (isZipArchive(currentPath)) {
            setUnsupportedPreview({
              title: "ZIP preview is unavailable",
              description: "Lovcode could not read this ZIP archive. It may be encrypted, corrupted, or the app may need to restart before the archive preview command is available.",
            });
          } else {
            setError(message);
          }
          setLoading(false);
        }
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [currentPath]);

  const handleImageLoad = (e: React.SyntheticEvent<HTMLImageElement>) => {
    const img = e.currentTarget;
    setImageInfo((prev) => ({
      width: img.naturalWidth,
      height: img.naturalHeight,
      fileSize: prev?.fileSize || 0,
      modified: prev?.modified,
    }));
  };

  const handleOpenInEditor = async () => {
    try {
      await invoke("open_in_editor", { path: currentPath });
    } catch (err) {
      console.error("Failed to open in editor:", err);
    }
  };

  const handleOpenDefault = async () => {
    try {
      await invoke("open_path", { path: currentPath });
    } catch (err) {
      console.error("Failed to open with default app:", err);
    }
  };

  const revealInFinder = async () => {
    try {
      await invoke("reveal_path", { path: currentPath });
    } catch (err) {
      console.error("Failed to reveal:", err);
    }
  };

  return (
    <div className="h-full flex flex-col bg-terminal">
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-2 border-b border-border bg-canvas-alt flex-shrink-0">
        {history.length > 0 && (
          <button
            onClick={goBack}
            className="p-1 text-muted-foreground hover:text-ink hover:bg-card-alt rounded transition-colors"
            title="Back"
          >
            <ChevronLeftIcon className="w-4 h-4" />
          </button>
        )}
        <div className="min-w-0 flex-1">
          <PathBreadcrumbs
            path={currentPath}
            segments={breadcrumbs}
            onNavigate={navigateTo}
            currentIsDir={isDir}
            className="text-sm font-medium"
          />
        </div>
        {isMarkdown && !isDir && (
          <div className="flex items-center bg-card-alt rounded-lg p-0.5">
            <button
              onClick={() => setViewMode("source")}
              className={`p-1.5 rounded transition-colors ${
                viewMode === "source"
                  ? "bg-background text-ink shadow-sm"
                  : "text-muted-foreground hover:text-ink"
              }`}
              title="Source"
            >
              <CodeIcon className="w-4 h-4" />
            </button>
            <button
              onClick={() => setViewMode("split")}
              className={`p-1.5 rounded transition-colors ${
                viewMode === "split"
                  ? "bg-background text-ink shadow-sm"
                  : "text-muted-foreground hover:text-ink"
              }`}
              title="Side by Side"
            >
              <ColumnsIcon className="w-4 h-4" />
            </button>
            <button
              onClick={() => setViewMode("preview")}
              className={`p-1.5 rounded transition-colors ${
                viewMode === "preview"
                  ? "bg-background text-ink shadow-sm"
                  : "text-muted-foreground hover:text-ink"
              }`}
              title="Preview"
            >
              <ReaderIcon className="w-4 h-4" />
            </button>
          </div>
        )}
        <button
          onClick={handleOpenInEditor}
          className="p-1.5 text-muted-foreground hover:text-ink hover:bg-card-alt rounded transition-colors"
          title="Open in editor"
        >
          <ExternalLinkIcon className="w-4 h-4" />
        </button>
        <button
          onClick={onClose}
          className="p-1.5 text-muted-foreground hover:text-ink hover:bg-card-alt rounded transition-colors"
          title="Close"
        >
          <Cross2Icon className="w-4 h-4" />
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 min-h-0 overflow-auto">
        {loading ? (
          <div className="flex items-center justify-center h-full">
            <div className="text-sm text-muted-foreground">Loading...</div>
          </div>
        ) : error ? (
          <div className="flex items-center justify-center h-full">
            <div className="text-sm text-destructive">{error}</div>
          </div>
        ) : unsupportedPreview ? (
          <UnsupportedPreview
            info={unsupportedPreview}
            fileName={fileName}
            fileSize={fileSize ?? undefined}
            onOpenDefault={handleOpenDefault}
            onReveal={revealInFinder}
          />
        ) : isDir ? (
          <div className="h-full overflow-auto bg-background">
            {dirEntries.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-48 gap-2">
                <Folder className="w-8 h-8 text-muted-foreground/40" />
                <div className="text-sm text-muted-foreground">Empty directory</div>
                <button
                  onClick={revealInFinder}
                  className="text-xs text-primary hover:underline"
                >
                  Reveal in Finder
                </button>
              </div>
            ) : (
              <ul className="py-1">
                {dirEntries.map((entry) => (
                  <li key={entry.path}>
                    <button
                      onClick={() => openDirectoryEntry(entry)}
                      onDoubleClick={() => {
                        if (!entry.is_dir) return;
                        invoke("open_path", { path: entry.path }).catch(console.error);
                      }}
                      className="w-full flex items-center gap-2 px-4 py-1.5 text-left text-sm hover:bg-card-alt transition-colors"
                      title={entry.path}
                    >
                      {entry.is_dir ? (
                        <Folder className="w-4 h-4 shrink-0 text-primary" />
                      ) : (
                        <FileIcon className="w-4 h-4 shrink-0 text-muted-foreground" />
                      )}
                      <span className="truncate text-ink">{entry.name}</span>
                      {entry.is_dir && (
                        <span className="ml-auto text-xs text-muted-foreground/60">/</span>
                      )}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ) : isImage && imageSrc ? (
          <div className="h-full flex">
            <div className="flex-1 flex items-center justify-center p-4 bg-foreground">
              <img
                src={imageSrc}
                alt={fileName}
                className="max-w-full max-h-full object-contain"
                onLoad={handleImageLoad}
              />
            </div>
            <div className="w-48 border-l border-border bg-canvas-alt p-3 flex-shrink-0">
              <h3 className="text-xs font-medium text-muted-foreground mb-3">Image Info</h3>
              <div className="space-y-2 text-sm">
                <div>
                  <span className="text-muted-foreground">Format</span>
                  <p className="text-ink">{fileExt}</p>
                </div>
                {imageInfo?.width && imageInfo.width > 0 && (
                  <div>
                    <span className="text-muted-foreground">Dimensions</span>
                    <p className="text-ink">{imageInfo.width} × {imageInfo.height}</p>
                  </div>
                )}
                {imageInfo?.fileSize && imageInfo.fileSize > 0 && (
                  <div>
                    <span className="text-muted-foreground">Size</span>
                    <p className="text-ink">{formatFileSize(imageInfo.fileSize)}</p>
                  </div>
                )}
              </div>
            </div>
          </div>
        ) : archiveListing ? (
          <ArchivePreview
            listing={archiveListing}
            fileName={fileName}
            fileSize={fileSize ?? undefined}
            onOpenDefault={handleOpenDefault}
            onReveal={revealInFinder}
          />
        ) : isMarkdown && viewMode === "preview" ? (
          <div className="h-full overflow-auto p-6 bg-background">
            <MarkdownRenderer content={content} cwd={markdownCwd} />
          </div>
        ) : isMarkdown && viewMode === "split" ? (
          <div className="h-full flex">
            <div className="w-1/2 border-r border-border">
              <Editor
                value={content}
                language="markdown"
                theme="vs"
                options={EDITOR_OPTIONS}
                onMount={(ed) => {
                  editorRef.current = ed;
                  tryRevealTarget();
                }}
              />
            </div>
            <div className="w-1/2 overflow-auto p-6 bg-background">
              <MarkdownRenderer content={content} cwd={markdownCwd} className="max-w-none" />
            </div>
          </div>
        ) : (
          <Editor
            value={content}
            language={language}
            theme="vs"
            options={EDITOR_OPTIONS}
            onMount={(ed) => {
              editorRef.current = ed;
              tryRevealTarget();
            }}
          />
        )}
      </div>
    </div>
  );
}
