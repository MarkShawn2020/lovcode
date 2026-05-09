import { useState, useEffect } from "react";
import { invoke } from "@/lib/tauri";
import { save } from "@tauri-apps/plugin-dialog";
import { useAtom } from "jotai";
import { atomWithStorage } from "jotai/utils";
import { Button } from "../../components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "../../components/ui/dialog";
import { Label } from "../../components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../components/ui/select";
import { useI18n } from "@/i18n";
import { getMessageDisplayRole, isUserPromptMessage } from "@/lib/messageSemantics";
import { restoreSlashCommand } from "./utils";
import type { ExportFormat, MarkdownStyle } from "./types";
import type { Message } from "../../types";

const exportFormatAtom = atomWithStorage<ExportFormat>("lovcode:exportFormat", "markdown");
const exportMdStyleAtom = atomWithStorage<MarkdownStyle>("lovcode:exportMdStyle", "full");
const exportTruncateAtom = atomWithStorage("lovcode:exportTruncate", false);
const exportSeparatorAtom = atomWithStorage("lovcode:exportSeparator", true);
const exportOriginalAtom = atomWithStorage("lovcode:exportOriginal", true);
const exportWatermarkAtom = atomWithStorage("lovcode:exportWatermark", true);
const exportJsonPrettyAtom = atomWithStorage("lovcode:exportJsonPretty", true);

interface ExportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  allMessages: Message[];
  selectedIds: Set<string>;
  onSelectedIdsChange: (ids: Set<string>) => void;
  defaultName: string;
}

export function ExportDialog({
  open,
  onOpenChange,
  allMessages,
  selectedIds,
  onSelectedIdsChange,
  defaultName,
}: ExportDialogProps) {
  const { t } = useI18n();
  const [selectPreset, setSelectPreset] = useState<"all" | "user" | "custom">("all");

  useEffect(() => {
    if (selectPreset === "all") {
      onSelectedIdsChange(new Set(allMessages.map((m) => m.uuid)));
    } else if (selectPreset === "user") {
      onSelectedIdsChange(new Set(allMessages.filter(isUserPromptMessage).map((m) => m.uuid)));
    }
  }, [selectPreset, allMessages, onSelectedIdsChange]);

  useEffect(() => {
    if (open) {
      setSelectPreset("all");
    }
  }, [open]);

  const [format, setFormat] = useAtom(exportFormatAtom);
  const [mdStyle, setMdStyle] = useAtom(exportMdStyleAtom);
  const [truncateBullet, setTruncateBullet] = useAtom(exportTruncateAtom);
  const [addSeparator, setAddSeparator] = useAtom(exportSeparatorAtom);
  const [exportOriginal, setExportOriginal] = useAtom(exportOriginalAtom);
  const [addWatermark, setAddWatermark] = useAtom(exportWatermarkAtom);
  const [jsonPretty, setJsonPretty] = useAtom(exportJsonPrettyAtom);

  const messages = exportOriginal
    ? allMessages.filter((m) => selectedIds.has(m.uuid) && !m.is_meta && !m.is_tool)
    : allMessages.filter((m) => selectedIds.has(m.uuid));
  const processContent = (content: string) => (exportOriginal ? restoreSlashCommand(content) : content);

  const generateOutput = () => {
    if (format === "json") {
      const data = messages.map((m) => ({
        role: getMessageDisplayRole(m),
        content: processContent(m.content),
      }));
      return JSON.stringify(data, null, jsonPretty ? 2 : undefined);
    }

    const truncate = (text: string) => {
      if (!truncateBullet) return text;
      const firstLine = text.split("\n")[0].slice(0, 200);
      const isTruncated = text.includes("\n") || text.length > 200;
      return `${firstLine}${isTruncated ? "..." : ""}`;
    };

    const userIndices = messages.map((m, i) => (isUserPromptMessage(m) ? i : -1)).filter((i) => i >= 0);
    const needsSeparator = (i: number) => addSeparator && userIndices.includes(i) && i !== userIndices[0];

    let output: string;
    if (mdStyle === "bullet") {
      output = messages
        .map((m, i) => {
          const prefix = isUserPromptMessage(m) ? "- **Q:**" : "- **A:**";
          const content = truncate(processContent(m.content));
          const line = `${prefix} ${content}`;
          return needsSeparator(i) ? `\n---\n\n${line}` : line;
        })
        .join("\n");
    } else if (mdStyle === "qa") {
      output = messages
        .map((m, i) => {
          const prefix = isUserPromptMessage(m) ? "**Q:**" : "**A:**";
          const content = truncate(processContent(m.content));
          const line = `${prefix} ${content}`;
          return needsSeparator(i) ? `---\n\n${line}` : line;
        })
        .join("\n\n");
    } else {
      output = messages
        .map((m, i) => {
          const displayRole = getMessageDisplayRole(m);
          const role = displayRole.charAt(0).toUpperCase() + displayRole.slice(1);
          const content = truncate(processContent(m.content));
          const line = `## ${role}\n\n${content}`;
          return needsSeparator(i) ? `---\n\n${line}` : line;
        })
        .join("\n\n");
    }
    if (addWatermark) {
      output +=
        "\n\n---\n\n*Exported with [Lovcode](https://github.com/MarkShawn2020/lovcode) - A desktop companion app for AI coding tools*";
    }
    return output;
  };

  const handleCopy = async () => {
    await navigator.clipboard.writeText(generateOutput());
    onOpenChange(false);
  };

  const handleExport = async () => {
    const ext = format === "json" ? "json" : "md";
    const filterName = format === "json" ? "JSON" : "Markdown";
    const path = await save({
      defaultPath: `${defaultName}.${ext}`,
      filters: [{ name: filterName, extensions: [ext] }],
    });
    if (path) {
      await invoke("write_file", { path, content: generateOutput() });
      onOpenChange(false);
    }
  };

  const preview = generateOutput();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="!flex !flex-col max-w-2xl max-h-[80vh] overflow-hidden">
        <DialogHeader>
          <DialogTitle>{t("export.title", { count: messages.length })}</DialogTitle>
        </DialogHeader>

        <div className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 py-2 border-b border-border items-center">
          <Label className="text-sm text-muted-foreground-foreground">{t("common.select")}</Label>
          <Select value={selectPreset} onValueChange={(v) => setSelectPreset(v as "all" | "user" | "custom")}>
            <SelectTrigger size="sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t("export.selectAll", { count: allMessages.length })}</SelectItem>
              <SelectItem value="user">{t("export.userOnly", { count: allMessages.filter(isUserPromptMessage).length })}</SelectItem>
              <SelectItem value="custom">{t("export.custom", { count: selectedIds.size })}</SelectItem>
            </SelectContent>
          </Select>

          <Label className="text-sm text-muted-foreground-foreground">{t("export.format")}</Label>
          <Select value={format} onValueChange={(v) => setFormat(v as ExportFormat)}>
            <SelectTrigger size="sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="markdown">Markdown</SelectItem>
              <SelectItem value="json">JSON</SelectItem>
            </SelectContent>
          </Select>

          {format === "markdown" && (
            <>
              <Label className="text-sm text-muted-foreground-foreground">{t("export.style")}</Label>
              <Select value={mdStyle} onValueChange={(v) => setMdStyle(v as MarkdownStyle)}>
                <SelectTrigger size="sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="full">{t("export.full")}</SelectItem>
                  <SelectItem value="qa">{t("export.qa")}</SelectItem>
                  <SelectItem value="bullet">{t("export.qaList")}</SelectItem>
                </SelectContent>
              </Select>
            </>
          )}

          <Label className="text-sm text-muted-foreground">{t("export.options")}</Label>
          <div className="flex gap-4 flex-wrap">
            <label className="flex items-center gap-2 text-sm text-muted-foreground cursor-pointer">
              <input
                type="checkbox"
                checked={exportOriginal}
                onChange={(e) => setExportOriginal(e.target.checked)}
                className="w-4 h-4 accent-primary cursor-pointer"
              />
              <span>{t("export.original")}</span>
            </label>

            {format === "markdown" && (
              <>
                <label className="flex items-center gap-2 text-sm text-muted-foreground cursor-pointer">
                  <input
                    type="checkbox"
                    checked={truncateBullet}
                    onChange={(e) => setTruncateBullet(e.target.checked)}
                    className="w-4 h-4 accent-primary cursor-pointer"
                  />
                  <span>{t("export.truncate")}</span>
                </label>
                <label className="flex items-center gap-2 text-sm text-muted-foreground cursor-pointer">
                  <input
                    type="checkbox"
                    checked={addSeparator}
                    onChange={(e) => setAddSeparator(e.target.checked)}
                    className="w-4 h-4 accent-primary cursor-pointer"
                  />
                  <span>{t("export.separator")}</span>
                </label>
                <label className="flex items-center gap-2 text-sm text-muted-foreground cursor-pointer">
                  <input
                    type="checkbox"
                    checked={addWatermark}
                    onChange={(e) => setAddWatermark(e.target.checked)}
                    className="w-4 h-4 accent-primary cursor-pointer"
                  />
                  <span>{t("export.watermark")}</span>
                </label>
              </>
            )}

            {format === "json" && (
              <label className="flex items-center gap-2 text-sm text-muted-foreground cursor-pointer">
                <input
                  type="checkbox"
                  checked={jsonPretty}
                  onChange={(e) => setJsonPretty(e.target.checked)}
                  className="w-4 h-4 accent-primary cursor-pointer"
                />
                <span>{t("export.pretty")}</span>
              </label>
            )}
          </div>
        </div>

        <div className="flex-1 flex flex-col min-h-0 overflow-hidden mt-4">
          <div className="text-xs text-muted-foreground-foreground mb-2 shrink-0">{t("export.preview")}</div>
          <div className="flex-1 bg-card-alt rounded-lg p-4 text-sm text-ink overflow-auto font-mono whitespace-pre-wrap break-all">
            {preview}
          </div>
        </div>

        <div className="flex justify-end gap-2 pt-4 border-t border-border shrink-0">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t("common.cancel")}
          </Button>
          <Button variant="outline" onClick={handleCopy}>
            {t("common.copy")}
          </Button>
          <Button onClick={handleExport}>{t("export.export")}</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
