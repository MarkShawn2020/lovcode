import { useState, useEffect, useRef, ReactNode, ComponentType } from "react";
import Markdown from "react-markdown";
// Radix icons
import { ExternalLinkIcon, DownloadIcon, ChatBubbleIcon, DotsHorizontalIcon, ChevronDownIcon, CopyIcon } from "@radix-ui/react-icons";
import type { IconProps } from "@radix-ui/react-icons/dist/types";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "../ui/dropdown-menu";
import { Button } from "../ui/button";
import { differenceInMinutes, differenceInHours, differenceInDays, differenceInWeeks, differenceInMonths } from "date-fns";

function formatRelativeTime(date: Date): string {
  const now = new Date();
  const mins = differenceInMinutes(now, date);
  if (mins < 1) return "刚刚";
  if (mins < 60) return `${mins}分钟前`;
  const hours = differenceInHours(now, date);
  if (hours < 24) return `${hours}小时前`;
  const days = differenceInDays(now, date);
  if (days < 7) return `${days}天前`;
  const weeks = differenceInWeeks(now, date);
  if (weeks < 5) return `${weeks}周前`;
  const months = differenceInMonths(now, date);
  return `${months}个月前`;
}

// ============================================================================
// Atomic Components
// ============================================================================

export function LoadingState({ message }: { message: string }) {
  return (
    <div className="flex items-center justify-center h-full">
      <p className="text-muted-foreground">{message}</p>
    </div>
  );
}

export function EmptyState({
  icon: Icon,
  message,
  hint,
}: {
  icon: ComponentType<{ className?: string }>;
  message: string;
  hint?: string;
}) {
  return (
    <div className="text-center py-12">
      <Icon className="w-10 h-10 mx-auto mb-4 text-muted-foreground" />
      <p className="text-muted-foreground">{message}</p>
      {hint && <p className="text-sm text-muted-foreground mt-1">{hint}</p>}
    </div>
  );
}

export function SearchInput({
  placeholder,
  value,
  onChange,
  className,
}: {
  placeholder: string;
  value: string;
  onChange: (value: string) => void;
  className?: string;
}) {
  return (
    <input
      type="text"
      placeholder={placeholder}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={className ?? "w-full max-w-md mb-6 px-4 py-2 bg-card border border-border rounded-lg text-ink placeholder:text-muted-foreground focus:outline-none focus:border-primary"}
    />
  );
}

export function PageHeader({
  title,
  subtitle,
  action,
}: {
  title: string;
  subtitle: ReactNode;
  action?: ReactNode;
}) {
  return (
    <header className="mb-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="font-serif text-3xl font-semibold text-ink">{title}</h1>
          <div className="text-muted-foreground mt-1">{subtitle}</div>
        </div>
        {action}
      </div>
    </header>
  );
}

export interface DetailHeaderMenuItem {
  label: string;
  onClick: () => void;
  icon?: ComponentType<IconProps>;
  variant?: "default" | "danger";
  disabled?: boolean;
}

export function DetailHeader({
  title,
  description,
  backLabel,
  onBack,
  path,
  onOpenPath,
  onNavigateSession,
  badge,
  statusBadge,
  menuItems,
  hasChangelog,
  onChangelogClick,
  onRename,
}: {
  title: string;
  description?: string | null;
  backLabel: string;
  onBack: () => void;
  path?: string;
  onOpenPath?: (path: string) => void;
  onNavigateSession?: () => void;
  badge?: string | null;
  statusBadge?: { label: string; variant: "success" | "warning" | "muted" } | null;
  menuItems?: DetailHeaderMenuItem[];
  hasChangelog?: boolean;
  onChangelogClick?: () => void;
  onRename?: (newName: string) => void;
}) {
  const hasMenu = Boolean(path) || onNavigateSession || (menuItems && menuItems.length > 0);
  const hasDefaultMenuItems = Boolean(path) || onNavigateSession;
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState(title);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [isEditing]);

  useEffect(() => {
    setEditValue(title);
  }, [title]);

  const handleSubmit = () => {
    const trimmed = editValue.trim();
    if (trimmed && trimmed !== title) {
      onRename?.(trimmed);
    } else {
      setEditValue(title);
    }
    setIsEditing(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      handleSubmit();
    } else if (e.key === "Escape") {
      setEditValue(title);
      setIsEditing(false);
    }
  };

  return (
    <header className="mb-6">
      <button
        onClick={onBack}
        className="text-muted-foreground hover:text-ink mb-2 flex items-center gap-1 text-sm"
      >
        <span>←</span> {backLabel}
      </button>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {isEditing ? (
            <input
              ref={inputRef}
              value={editValue}
              onChange={(e) => setEditValue(e.target.value)}
              onBlur={handleSubmit}
              onKeyDown={handleKeyDown}
              className="font-mono text-2xl font-semibold text-primary bg-transparent border-b-2 border-primary outline-none min-w-[200px]"
            />
          ) : (
            <h1
              className={`font-mono text-2xl font-semibold text-primary ${onRename ? "cursor-pointer hover:opacity-80" : ""}`}
              onClick={onRename ? () => setIsEditing(true) : undefined}
              title={onRename ? "Click to rename" : undefined}
            >
              {title}
            </h1>
          )}
          {badge && (
            <span className="text-xs px-2 py-0.5 rounded bg-card-alt text-muted-foreground">
              {badge}
            </span>
          )}
          {hasChangelog && (
            <button
              onClick={onChangelogClick}
              className="text-xs px-2 py-0.5 rounded bg-primary/10 text-primary hover:bg-primary/20 transition-colors cursor-pointer"
            >
              changelog
            </button>
          )}
          {statusBadge && (
            <span className={`text-xs px-2 py-0.5 rounded ${
              statusBadge.variant === "success" ? "bg-green-500/20 text-green-600" :
              statusBadge.variant === "warning" ? "bg-amber-500/20 text-amber-600" :
              "bg-card-alt text-muted-foreground"
            }`}>
              {statusBadge.label}
            </span>
          )}
        </div>
        {hasMenu && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="sm">
                <DotsHorizontalIcon className="w-4 h-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {path && onOpenPath && (
                <DropdownMenuItem onClick={() => onOpenPath(path)}>
                  <ExternalLinkIcon className="w-4 h-4 mr-2" />
                  Open in Editor
                </DropdownMenuItem>
              )}
              {path && (
                <DropdownMenuItem onClick={() => navigator.clipboard.writeText(path)}>
                  <CopyIcon className="w-4 h-4 mr-2" />
                  Copy Path
                </DropdownMenuItem>
              )}
              {onNavigateSession && (
                <DropdownMenuItem onClick={onNavigateSession}>
                  <ChatBubbleIcon className="w-4 h-4 mr-2" />
                  Go to Session
                </DropdownMenuItem>
              )}
              {hasDefaultMenuItems && menuItems && menuItems.length > 0 && (
                <DropdownMenuSeparator />
              )}
              {menuItems?.map((item, i) => {
                const Icon = item.icon;
                return (
                  <DropdownMenuItem
                    key={i}
                    onClick={item.onClick}
                    disabled={item.disabled}
                    className={item.variant === "danger" ? "text-amber-600" : ""}
                  >
                    {Icon && <Icon className="w-4 h-4 mr-2" />}
                    {item.label}
                  </DropdownMenuItem>
                );
              })}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
      {description && <p className="text-muted-foreground mt-2">{description}</p>}
    </header>
  );
}

export function ItemCard({
  name,
  description,
  badge,
  badgeVariant = "accent",
  usageCount,
  timestamp,
  onClick,
}: {
  name: string;
  description?: string | null;
  badge?: string | null;
  badgeVariant?: "accent" | "muted";
  usageCount?: number;
  timestamp?: string | Date;
  onClick: () => void;
}) {
  const badgeClass =
    badgeVariant === "accent"
      ? "bg-accent/20 text-accent"
      : "bg-card-alt text-muted-foreground";

  const relativeTime = timestamp
    ? formatRelativeTime(new Date(timestamp))
    : null;

  return (
    <button
      onClick={onClick}
      className="w-full text-left bg-card rounded-xl p-4 border border-border hover:border-primary transition-colors"
    >
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <p className="font-mono font-medium text-primary">{name}</p>
            {usageCount !== undefined && usageCount > 0 && (
              <span className="text-xs text-muted-foreground" title={`Used ${usageCount} times`}>
                ×{usageCount}
              </span>
            )}
          </div>
          {description && (
            <p className="text-sm text-muted-foreground mt-1 line-clamp-2">{description}</p>
          )}
        </div>
        <div className="flex flex-col items-end gap-1 shrink-0">
          {badge && (
            <span className={`text-xs px-2 py-0.5 rounded ${badgeClass}`}>
              {badge}
            </span>
          )}
          {relativeTime && (
            <span className="text-xs text-muted-foreground" title={String(timestamp)}>
              {relativeTime}
            </span>
          )}
        </div>
      </div>
    </button>
  );
}

export function DetailCard({
  label,
  variant = "default",
  action,
  children,
}: {
  label: string;
  variant?: "default" | "alt";
  action?: ReactNode;
  children: ReactNode;
}) {
  const bgClass = variant === "default" ? "bg-card border border-border" : "bg-card-alt";

  return (
    <div className={`rounded-xl p-4 ${bgClass} relative`}>
      <div className="flex items-center justify-between mb-1">
        <p className="text-xs text-muted-foreground uppercase tracking-wide">{label}</p>
        {action}
      </div>
      {children}
    </div>
  );
}

export function ContentCard({
  label,
  content,
  showGoToTop,
  onGoToTop,
}: {
  label: string;
  content: string;
  showGoToTop?: boolean;
  onGoToTop?: () => void;
}) {
  return (
    <DetailCard label={label}>
      <div className="prose prose-sm max-w-none text-ink">
        <Markdown>{content}</Markdown>
      </div>
      {showGoToTop && onGoToTop && (
        <div className="sticky bottom-4 flex justify-end pointer-events-none">
          <button
            onClick={onGoToTop}
            className="pointer-events-auto p-3 bg-background border border-border rounded-full shadow-lg hover:bg-card-alt transition-colors"
            title="Go to top"
          >
            <ChevronDownIcon className="w-5 h-5 rotate-180" />
          </button>
        </div>
      )}
    </DetailCard>
  );
}


// ============================================================================
// Layout Components
// ============================================================================

export function ConfigPage({ children }: { children: ReactNode }) {
  return <div className="px-6 py-8 config-page-container">{children}</div>;
}

// ============================================================================
// Hooks
// ============================================================================

export function useSearch<T>(
  items: T[],
  fields: (keyof T)[]
): {
  search: string;
  setSearch: (v: string) => void;
  filtered: T[];
} {
  const [search, setSearch] = useState("");

  const filtered = items.filter((item) => {
    if (!search) return true;
    const query = search.toLowerCase();
    return fields.some((field) => {
      const value = item[field];
      return typeof value === "string" && value.toLowerCase().includes(query);
    });
  });

  return { search, setSearch, filtered };
}

export function useAsyncData<T>(
  fetcher: () => Promise<T>,
  deps: unknown[] = []
): { data: T | null; loading: boolean; error: string | null } {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    fetcher()
      .then(setData)
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return { data, loading, error };
}

// ============================================================================
// Marketplace Section Component
// ============================================================================

export interface MarketplaceItem {
  name: string;
  path: string;
  description: string | null;
  downloads: number | null;
  content?: string | null;
}

export function MarketplaceSection({
  items,
  search,
  onSelect,
  onBrowseMore,
}: {
  items: MarketplaceItem[];
  search: string;
  onSelect: (item: MarketplaceItem) => void;
  onBrowseMore?: () => void;
}) {
  if (!search || items.length === 0) return null;

  const filtered = items.filter(
    (item) =>
      item.name.toLowerCase().includes(search.toLowerCase()) ||
      item.description?.toLowerCase().includes(search.toLowerCase())
  );

  if (filtered.length === 0) return null;

  return (
    <div className="mt-8 pt-6 border-t border-border">
      <p className="text-xs text-muted-foreground uppercase tracking-wide mb-3">
        From Marketplace ({filtered.length})
      </p>
      <div className="space-y-2">
        {filtered.slice(0, 5).map((item) => (
          <button
            key={item.path}
            onClick={() => onSelect(item)}
            className="w-full text-left bg-card-alt rounded-xl p-4 border border-dashed border-border hover:border-primary transition-colors"
          >
            <div className="flex items-start justify-between gap-4">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <p className="font-mono font-medium text-ink">{item.name}</p>
                  {item.downloads != null && (
                    <span className="text-xs text-muted-foreground">↓{item.downloads}</span>
                  )}
                </div>
                {item.description && (
                  <p className="text-sm text-muted-foreground mt-1 line-clamp-2">{item.description}</p>
                )}
              </div>
              <DownloadIcon className="w-4 h-4 text-primary shrink-0" />
            </div>
          </button>
        ))}
        {filtered.length > 5 && (
          onBrowseMore ? (
            <button
              onClick={onBrowseMore}
              className="w-full text-xs text-primary hover:underline text-center py-2"
            >
              +{filtered.length - 5} more in Marketplace →
            </button>
          ) : (
            <p className="text-xs text-muted-foreground text-center py-2">
              +{filtered.length - 5} more in Marketplace
            </p>
          )
        )}
      </div>
    </div>
  );
}
