import Editor from "@monaco-editor/react";

const EDITOR_OPTIONS = {
  readOnly: true,
  minimap: { enabled: false },
  scrollBeyondLastLine: false,
  fontSize: 12,
  lineHeight: 18,
  fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
  renderLineHighlight: "none" as const,
  overviewRulerLanes: 0,
  hideCursorInOverviewRuler: true,
  overviewRulerBorder: false,
  scrollbar: { vertical: "auto" as const, horizontal: "auto" as const, verticalScrollbarSize: 6, horizontalScrollbarSize: 6 },
  padding: { top: 8, bottom: 8 },
  lineNumbers: "on" as const,
  folding: true,
  wordWrap: "on" as const,
};

interface CodePreviewProps {
  value: string;
  language: string;
  height?: string | number;
  className?: string;
}

export function CodePreview({ value, language, height = 300, className }: CodePreviewProps) {
  return (
    <div className={`rounded-lg overflow-hidden border border-border ${className ?? ""}`} style={{ height }}>
      <Editor
        value={value}
        language={language}
        theme="vs"
        options={EDITOR_OPTIONS}
      />
    </div>
  );
}
