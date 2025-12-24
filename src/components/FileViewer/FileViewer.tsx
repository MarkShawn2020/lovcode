import { useState, useEffect, useMemo } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Cross2Icon, ExternalLinkIcon } from "@radix-ui/react-icons";
import Editor, { loader } from "@monaco-editor/react";

// Configure Monaco to use local assets (avoid CDN)
loader.config({ paths: { vs: "https://cdn.jsdelivr.net/npm/monaco-editor@0.52.0/min/vs" } });

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

export function FileViewer({ filePath, onClose }: FileViewerProps) {
  const [content, setContent] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fileName = useMemo(() => filePath.split("/").pop() || filePath, [filePath]);
  const language = useMemo(() => getLanguage(filePath), [filePath]);

  useEffect(() => {
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
  }, [filePath]);

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
        ) : (
          <Editor
            value={content}
            language={language}
            theme="vs"
            options={{
              readOnly: true,
              minimap: { enabled: false },
              scrollBeyondLastLine: false,
              fontSize: 13,
              lineHeight: 20,
              fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
              renderLineHighlight: "none",
              overviewRulerLanes: 0,
              hideCursorInOverviewRuler: true,
              overviewRulerBorder: false,
              scrollbar: {
                vertical: "auto",
                horizontal: "auto",
                verticalScrollbarSize: 8,
                horizontalScrollbarSize: 8,
              },
              padding: { top: 12, bottom: 12 },
            }}
          />
        )}
      </div>
    </div>
  );
}
