import { useState, useEffect, useMemo } from "react";
import { useAtom } from "jotai";
import { fileViewModeAtom } from "@/store";
import { invoke, convertFileSrc } from "@tauri-apps/api/core";
import { Cross2Icon, ExternalLinkIcon, CodeIcon, ReaderIcon, ColumnsIcon } from "@radix-ui/react-icons";
import Editor from "@monaco-editor/react";
import { MarkdownRenderer } from "../MarkdownRenderer";
import { isImageFile } from "@/lib/utils";

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
}

interface ImageInfo {
  width: number;
  height: number;
  fileSize: number;
  modified?: number;
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function FileViewer({ filePath, onClose }: FileViewerProps) {
  const [content, setContent] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [viewMode, setViewMode] = useAtom(fileViewModeAtom);
  const [imageInfo, setImageInfo] = useState<ImageInfo | null>(null);

  const fileName = useMemo(() => filePath.split("/").pop() || filePath, [filePath]);
  const language = useMemo(() => getLanguage(filePath), [filePath]);
  const isMarkdown = language === "markdown";
  const isImage = useMemo(() => isImageFile(fileName), [fileName]);
  const imageSrc = useMemo(() => isImage ? convertFileSrc(filePath) : null, [isImage, filePath]);
  const fileExt = useMemo(() => fileName.split('.').pop()?.toUpperCase() || '', [fileName]);

  useEffect(() => {
    // Load file metadata for images
    if (isImage) {
      setLoading(false);
      invoke<{ size: number; modified?: number }>("get_file_metadata", { path: filePath })
        .then((meta) => {
          setImageInfo((prev) => prev ? { ...prev, fileSize: meta.size, modified: meta.modified } : { width: 0, height: 0, fileSize: meta.size, modified: meta.modified });
        })
        .catch(console.error);
      return;
    }

    let cancelled = false;

    async function loadFile() {
      setLoading(true);
      setError(null);
      try {
        const result = await invoke<string>("read_file", { path: filePath });
        if (!cancelled) {
          setContent(result);
        }
      } catch (err) {
        if (!cancelled) {
          setError(String(err));
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    loadFile();

    return () => {
      cancelled = true;
    };
  }, [filePath, isImage]);

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
      await invoke("open_in_editor", { path: filePath });
    } catch (err) {
      console.error("Failed to open in editor:", err);
    }
  };

  return (
    <div className="h-full flex flex-col bg-terminal">
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-2 border-b border-border bg-canvas-alt flex-shrink-0">
        <span className="flex-1 text-sm font-medium text-ink truncate" title={filePath}>
          {fileName}
        </span>
        {isMarkdown && (
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
        ) : isImage && imageSrc ? (
          <div className="h-full flex">
            <div className="flex-1 flex items-center justify-center p-4 bg-[#1e1e1e]">
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
        ) : isMarkdown && viewMode === "preview" ? (
          <div className="h-full overflow-auto p-6 bg-background">
            <MarkdownRenderer content={content} />
          </div>
        ) : isMarkdown && viewMode === "split" ? (
          <div className="h-full flex">
            <div className="w-1/2 border-r border-border">
              <Editor value={content} language="markdown" theme="vs" options={EDITOR_OPTIONS} />
            </div>
            <div className="w-1/2 overflow-auto p-6 bg-background">
              <MarkdownRenderer content={content} className="max-w-none" />
            </div>
          </div>
        ) : (
          <Editor value={content} language={language} theme="vs" options={EDITOR_OPTIONS} />
        )}
      </div>
    </div>
  );
}
