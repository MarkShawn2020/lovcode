import { useState, useEffect, ReactNode } from "react";
import Markdown from "react-markdown";
import { ExternalLink, Download } from "lucide-react";

// ============================================================================
// Atomic Components
// ============================================================================

export function LoadingState({ message }: { message: string }) {
  return (
    <div className="flex items-center justify-center h-full">
      <p className="text-muted">{message}</p>
    </div>
  );
}

export function EmptyState({
  icon,
  message,
  hint,
}: {
  icon: string;
  message: string;
  hint?: string;
}) {
  return (
    <div className="text-center py-12">
      <span className="text-4xl mb-4 block">{icon}</span>
      <p className="text-muted">{message}</p>
      {hint && <p className="text-sm text-muted mt-1">{hint}</p>}
    </div>
  );
}

export function SearchInput({
  placeholder,
  value,
  onChange,
}: {
  placeholder: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <input
      type="text"
      placeholder={placeholder}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="w-full max-w-md mb-6 px-4 py-2 bg-card border border-border rounded-lg text-ink placeholder:text-muted focus:outline-none focus:border-primary"
    />
  );
}

export function PageHeader({
  title,
  subtitle,
}: {
  title: string;
  subtitle: string;
}) {
  return (
    <header className="mb-6">
      <h1 className="font-serif text-3xl font-semibold text-ink">{title}</h1>
      <p className="text-muted mt-1">{subtitle}</p>
    </header>
  );
}

export function DetailHeader({
  title,
  description,
  backLabel,
  onBack,
  path,
  onOpenPath,
}: {
  title: string;
  description?: string | null;
  backLabel: string;
  onBack: () => void;
  path?: string;
  onOpenPath?: (path: string) => void;
}) {
  return (
    <header className="mb-6">
      <button
        onClick={onBack}
        className="text-muted hover:text-ink mb-2 flex items-center gap-1 text-sm"
      >
        <span>←</span> {backLabel}
      </button>
      <div className="flex items-center gap-2">
        <h1 className="font-mono text-2xl font-semibold text-primary">{title}</h1>
        {path && (
          <button
            onClick={() => onOpenPath?.(path)}
            className="text-muted hover:text-primary"
            title={path}
          >
            <ExternalLink className="w-4 h-4" />
          </button>
        )}
      </div>
      {description && <p className="text-muted mt-2">{description}</p>}
    </header>
  );
}

export function ItemCard({
  name,
  description,
  badge,
  badgeVariant = "accent",
  onClick,
}: {
  name: string;
  description?: string | null;
  badge?: string | null;
  badgeVariant?: "accent" | "muted";
  onClick: () => void;
}) {
  const badgeClass =
    badgeVariant === "accent"
      ? "bg-accent/20 text-accent"
      : "bg-card-alt text-muted";

  return (
    <button
      onClick={onClick}
      className="w-full text-left bg-card rounded-xl p-4 border border-border hover:border-primary transition-colors"
    >
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 min-w-0">
          <p className="font-mono font-medium text-primary">{name}</p>
          {description && (
            <p className="text-sm text-muted mt-1 line-clamp-2">{description}</p>
          )}
        </div>
        {badge && (
          <span className={`text-xs px-2 py-1 rounded shrink-0 ${badgeClass}`}>
            {badge}
          </span>
        )}
      </div>
    </button>
  );
}

export function DetailCard({
  label,
  variant = "default",
  children,
}: {
  label: string;
  variant?: "default" | "alt";
  children: ReactNode;
}) {
  const bgClass = variant === "default" ? "bg-card border border-border" : "bg-card-alt";

  return (
    <div className={`rounded-xl p-4 ${bgClass}`}>
      <p className="text-xs text-muted uppercase tracking-wide mb-1">{label}</p>
      {children}
    </div>
  );
}

export function ContentCard({ label, content }: { label: string; content: string }) {
  return (
    <DetailCard label={label}>
      <div className="prose prose-sm max-w-none text-ink">
        <Markdown>{content}</Markdown>
      </div>
    </DetailCard>
  );
}


// ============================================================================
// Layout Components
// ============================================================================

export function ConfigPage({ children }: { children: ReactNode }) {
  return <div className="px-6 py-8">{children}</div>;
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
}

export function MarketplaceSection({
  items,
  search,
  onSelect,
}: {
  items: MarketplaceItem[];
  search: string;
  onSelect: (item: MarketplaceItem) => void;
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
      <p className="text-xs text-muted uppercase tracking-wide mb-3">
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
                    <span className="text-xs text-muted">↓{item.downloads}</span>
                  )}
                </div>
                {item.description && (
                  <p className="text-sm text-muted mt-1 line-clamp-2">{item.description}</p>
                )}
              </div>
              <Download className="w-4 h-4 text-primary shrink-0" />
            </div>
          </button>
        ))}
        {filtered.length > 5 && (
          <p className="text-xs text-muted text-center py-2">
            +{filtered.length - 5} more in Marketplace
          </p>
        )}
      </div>
    </div>
  );
}
