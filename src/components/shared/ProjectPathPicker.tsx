import { useEffect, useLayoutEffect, useRef, useState, type FocusEvent, type PointerEvent, type ReactNode } from "react";
import { Check, ChevronDown, FolderOpen, MessageSquare } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useAppConfig } from "@/context/AppConfigContext";
import { useI18n } from "@/i18n";
import { cn } from "@/lib/utils";

const PROJECT_PATH_MENU_MIN_WIDTH = 288;
const PROJECT_PATH_MENU_MAX_WIDTH = 448;
const PROJECT_PATH_MENU_VIEWPORT_PADDING = 16;
const PROJECT_PATH_PREVIEW_WIDTH = 320;
const PROJECT_PATH_PREVIEW_ESTIMATED_HEIGHT = 104;
const PROJECT_PATH_PREVIEW_OFFSET = 12;
const PROJECT_PATH_PREVIEW_DELAY_MS = 350;
const PICKER_TRIGGER_BASE_CLASS =
  "inline-flex min-w-0 items-center gap-2 rounded-xl border border-border bg-card-alt/60 px-3 text-left shadow-sm transition-[background-color,border-color,box-shadow] hover:bg-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
const PICKER_TRIGGER_SIZE_CLASS = {
  compact: "h-9",
  default: "h-11",
};
const PICKER_ICON_CLASS =
  "agent-composer-picker-icon flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-background text-muted-foreground ring-1 ring-border/70";

export interface ProjectPathOption {
  path: string;
  label?: string;
  detail?: string;
}

interface ProjectPathPreview {
  active: boolean;
  label: string;
  path: string;
  x: number;
  y: number;
  width: number;
}

type ProjectPathPreviewBase = Omit<ProjectPathPreview, "x" | "y" | "width">;

export function ProjectPathPicker({
  cwd,
  label,
  hasProjectPath,
  pathOptions = [],
  allowNoProject = false,
  emptyLabel,
  emptyEyebrow,
  emptyIcon,
  onPickFolder,
  onSelectCwd,
  compact = false,
  className,
}: {
  cwd: string | null;
  label?: string;
  hasProjectPath?: boolean;
  pathOptions?: ProjectPathOption[];
  allowNoProject?: boolean;
  emptyLabel?: string;
  emptyEyebrow?: string;
  emptyIcon?: ReactNode;
  onPickFolder?: () => void;
  onSelectCwd?: (path: string | null) => void;
  compact?: boolean;
  className?: string;
}) {
  const { homeDir } = useAppConfig();
  const { t } = useI18n();
  const displayLabel = label ??
    (cwd
      ? getPathName(cwd)
      : emptyLabel ?? (allowNoProject ? t("chat.generalChat") : t("common.selectProject")));
  const hasPath = hasProjectPath ?? Boolean(cwd);
  const hasMenu = Boolean(onSelectCwd || onPickFolder || pathOptions.length > 0 || allowNoProject);
  const hasItemsAfterGeneral = Boolean(onPickFolder || pathOptions.length > 0);
  const currentKey = normalizePathForCompare(cwd);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);
  const previewTimerRef = useRef<ReturnType<typeof window.setTimeout> | null>(null);
  const [menuWidth, setMenuWidth] = useState(PROJECT_PATH_MENU_MIN_WIDTH);
  const [menuOpen, setMenuOpen] = useState(false);
  const [pathPreview, setPathPreview] = useState<ProjectPathPreview | null>(null);
  const baseClassName = cn(
    PICKER_TRIGGER_BASE_CLASS,
    compact ? PICKER_TRIGGER_SIZE_CLASS.compact : PICKER_TRIGGER_SIZE_CLASS.default,
    hasPath ? "text-foreground" : "text-muted-foreground",
    className,
  );
  const content = (
    <PickerTriggerContent
      icon={hasPath ? <FolderOpen className="h-3.5 w-3.5" /> : emptyIcon ?? <MessageSquare className="h-3.5 w-3.5" />}
      label={displayLabel}
      eyebrow={compact
        ? undefined
        : hasPath
          ? t("common.project")
          : emptyEyebrow ?? (allowNoProject ? t("common.noProject") : t("common.project"))}
      hasMenu={hasMenu}
      labelClassName="font-mono text-xs"
    />
  );

  useLayoutEffect(() => {
    if (!hasMenu) return;
    const trigger = triggerRef.current;
    if (!trigger) return;

    const syncWidth = () => {
      setMenuWidth(getProjectPathMenuWidth(trigger.getBoundingClientRect().width));
    };
    syncWidth();

    const observer = new ResizeObserver(syncWidth);
    observer.observe(trigger);
    window.addEventListener("resize", syncWidth);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", syncWidth);
    };
  }, [hasMenu]);

  useEffect(() => {
    return () => {
      if (previewTimerRef.current) window.clearTimeout(previewTimerRef.current);
    };
  }, []);

  const clearPathPreview = () => {
    if (previewTimerRef.current) {
      window.clearTimeout(previewTimerRef.current);
      previewTimerRef.current = null;
    }
    setPathPreview(null);
  };

  const showPathPreview = (preview: ProjectPathPreviewBase, clientX: number, anchorRect: DOMRect) => {
    if (previewTimerRef.current) window.clearTimeout(previewTimerRef.current);
    const rect = contentRef.current?.getBoundingClientRect();
    if (!rect) {
      previewTimerRef.current = window.setTimeout(() => {
        setPathPreview({ ...preview, x: PROJECT_PATH_PREVIEW_OFFSET, y: PROJECT_PATH_PREVIEW_OFFSET, width: PROJECT_PATH_PREVIEW_WIDTH });
      }, PROJECT_PATH_PREVIEW_DELAY_MS);
      return;
    }

    const width = Math.min(PROJECT_PATH_PREVIEW_WIDTH, Math.max(180, rect.width - PROJECT_PATH_PREVIEW_OFFSET));
    const rawX = clientX - rect.left + PROJECT_PATH_PREVIEW_OFFSET;
    const belowY = anchorRect.bottom - rect.top + PROJECT_PATH_PREVIEW_OFFSET / 2;
    const aboveY = anchorRect.top - rect.top - PROJECT_PATH_PREVIEW_ESTIMATED_HEIGHT - PROJECT_PATH_PREVIEW_OFFSET / 2;
    const maxX = Math.max(PROJECT_PATH_PREVIEW_OFFSET / 2, rect.width - width - PROJECT_PATH_PREVIEW_OFFSET / 2);
    const maxY = Math.max(PROJECT_PATH_PREVIEW_OFFSET / 2, rect.height - PROJECT_PATH_PREVIEW_ESTIMATED_HEIGHT - PROJECT_PATH_PREVIEW_OFFSET / 2);
    const hasRoomBelow = belowY + PROJECT_PATH_PREVIEW_ESTIMATED_HEIGHT <= rect.height - PROJECT_PATH_PREVIEW_OFFSET / 2;

    const nextPreview = {
      ...preview,
      x: clamp(rawX, PROJECT_PATH_PREVIEW_OFFSET / 2, maxX),
      y: clamp(hasRoomBelow ? belowY : aboveY, PROJECT_PATH_PREVIEW_OFFSET / 2, maxY),
      width,
    };

    previewTimerRef.current = window.setTimeout(() => {
      setPathPreview(nextPreview);
    }, PROJECT_PATH_PREVIEW_DELAY_MS);
  };

  if (!hasMenu) {
    return (
      <span className={baseClassName}>
        {content}
      </span>
    );
  }

  return (
    <DropdownMenu
      open={menuOpen}
      onOpenChange={(open) => {
        setMenuOpen(open);
        if (!open) clearPathPreview();
      }}
    >
      <DropdownMenuTrigger asChild>
        <button
          ref={triggerRef}
          type="button"
          className={baseClassName}
          aria-label={
            hasPath
              ? t("project.changeFolder")
              : allowNoProject
                ? t("project.chooseScope")
                : t("project.chooseFolder")
          }
        >
          {content}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        ref={contentRef}
        align="start"
        collisionPadding={8}
        sideOffset={6}
        className="relative flex max-w-[calc(100vw-1rem)] flex-col overflow-hidden rounded-xl p-1.5"
        style={{
          maxHeight: "min(var(--radix-dropdown-menu-content-available-height, calc(100vh - 1rem)), calc(100vh - 1rem))",
          width: menuWidth,
        }}
      >
        {allowNoProject && (
          <DropdownMenuItem
            onPointerEnter={clearPathPreview}
            onFocus={clearPathPreview}
            onSelect={() => onSelectCwd?.(null)}
            className={cn("gap-2 rounded-lg py-2", !hasPath ? "bg-primary/10" : "")}
          >
            <MenuCheck active={!hasPath} />
            <MessageSquare className="h-4 w-4 shrink-0 text-muted-foreground" />
            <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">{t("chat.generalChat")}</span>
          </DropdownMenuItem>
        )}

        {allowNoProject && hasItemsAfterGeneral && <DropdownMenuSeparator />}

        {onPickFolder && (
          <DropdownMenuItem
            onPointerEnter={clearPathPreview}
            onFocus={clearPathPreview}
            onSelect={() => onPickFolder()}
            className="gap-2 rounded-lg py-2"
          >
            <span className="h-4 w-4 shrink-0" />
            <FolderOpen className="h-4 w-4 shrink-0 text-muted-foreground" />
            <span className="text-sm font-medium text-foreground">{t("project.chooseOtherFolder")}</span>
          </DropdownMenuItem>
        )}

        {pathOptions.length > 0 && (
          <>
            {onPickFolder && <DropdownMenuSeparator />}
            <DropdownMenuLabel className="px-2 py-1 text-xs font-medium text-muted-foreground">{t("project.recentPaths")}</DropdownMenuLabel>
            <div className="min-h-0 flex-1 overflow-y-auto pr-1" onPointerLeave={clearPathPreview}>
              {pathOptions.map((option) => {
                const optionKey = normalizePathForCompare(option.path);
                const active = Boolean(currentKey && optionKey === currentKey);
                const optionLabel = option.label ?? getPathName(option.path);
                const optionDetail = formatPathWithHome(option.detail ?? option.path, homeDir);
                return (
                  <ProjectPathMenuItem
                    key={option.path}
                    active={active}
                    label={optionLabel}
                    path={optionDetail}
                    onPreview={showPathPreview}
                    onClearPreview={clearPathPreview}
                    onSelect={() => onSelectCwd?.(option.path)}
                  />
                );
              })}
            </div>
            {pathPreview && <ProjectPathHoverPreview preview={pathPreview} />}
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function PickerTriggerContent({
  icon,
  label,
  eyebrow,
  hasMenu,
  labelClassName,
}: {
  icon: ReactNode;
  label: string;
  eyebrow?: string;
  hasMenu?: boolean;
  labelClassName?: string;
}) {
  return (
    <>
      <span className={PICKER_ICON_CLASS}>{icon}</span>
      <span className="agent-composer-picker-label grid min-w-0 flex-1">
        {eyebrow && <span className="text-[10px] font-medium uppercase leading-3 text-muted-foreground">{eyebrow}</span>}
        <span className={cn("truncate text-sm font-medium leading-5 text-foreground", labelClassName)}>{label}</span>
      </span>
      {hasMenu && <ChevronDown className="agent-composer-picker-chevron h-3.5 w-3.5 shrink-0 text-muted-foreground" />}
    </>
  );
}

function MenuCheck({ active }: { active: boolean }) {
  return active ? <Check className="h-4 w-4 shrink-0 text-primary" /> : <span className="h-4 w-4 shrink-0" />;
}

function ProjectPathMenuItem({
  active,
  label,
  path,
  onPreview,
  onClearPreview,
  onSelect,
}: {
  active: boolean;
  label: string;
  path: string;
  onPreview: (preview: ProjectPathPreviewBase, clientX: number, anchorRect: DOMRect) => void;
  onClearPreview: () => void;
  onSelect: () => void;
}) {
  const preview = { active, label, path };
  const showPointerPreview = (event: PointerEvent<HTMLDivElement>) => {
    onPreview(preview, event.clientX, event.currentTarget.getBoundingClientRect());
  };
  const showFocusPreview = (event: FocusEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    onPreview(preview, rect.right, rect);
  };

  return (
    <DropdownMenuItem
      onPointerEnter={showPointerPreview}
      onPointerMove={showPointerPreview}
      onPointerLeave={onClearPreview}
      onFocus={showFocusPreview}
      onBlur={onClearPreview}
      onSelect={onSelect}
      className={cn("gap-2 rounded-lg py-2", active ? "bg-primary/10" : "")}
    >
      <MenuCheck active={active} />
      <FolderOpen className="h-4 w-4 shrink-0 text-muted-foreground" />
      <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">{label}</span>
      {active && (
        <span className="shrink-0 rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary ring-1 ring-primary/20">
          Current
        </span>
      )}
    </DropdownMenuItem>
  );
}

function ProjectPathHoverPreview({ preview }: { preview: ProjectPathPreview }) {
  return (
    <div
      className="pointer-events-none absolute z-10 rounded-lg border border-border bg-card px-3 py-2.5 shadow-lg"
      style={{ left: preview.x, top: preview.y, width: preview.width }}
    >
      <div className="flex min-w-0 items-center gap-2">
        <span className="min-w-0 flex-1 truncate text-sm font-semibold text-foreground">{preview.label}</span>
        {preview.active && (
          <span className="shrink-0 rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary ring-1 ring-primary/20">
            Current
          </span>
        )}
      </div>
      <div className="mt-1 max-h-20 overflow-hidden break-all font-mono text-xs leading-relaxed text-muted-foreground">
        {preview.path}
      </div>
    </div>
  );
}

function getProjectPathMenuWidth(triggerWidth: number) {
  if (typeof window === "undefined") return PROJECT_PATH_MENU_MIN_WIDTH;
  const availableWidth = Math.max(160, window.innerWidth - PROJECT_PATH_MENU_VIEWPORT_PADDING);
  const preferredWidth = Math.max(Math.ceil(triggerWidth), PROJECT_PATH_MENU_MIN_WIDTH);
  return Math.min(preferredWidth, PROJECT_PATH_MENU_MAX_WIDTH, availableWidth);
}

function normalizePathForCompare(path?: string | null) {
  return path ? path.replace(/[/\\]+$/, "") : "";
}

function getPathName(path: string) {
  return path.split(/[\\/]/).filter(Boolean).pop() || path;
}

function formatPathWithHome(path: string, homeDir: string) {
  if (homeDir && path === homeDir) return "~";
  if (homeDir && path.startsWith(`${homeDir}/`)) return `~/${path.slice(homeDir.length + 1)}`;
  return path;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}
