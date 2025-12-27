import type { ComponentType } from "react";

interface NavItem {
  key: string;
  label: string;
  icon?: ComponentType<{ className?: string }>;
}

interface NavSidebarProps {
  title?: string;
  items: NavItem[];
  activeKey: string | null;
  onItemClick: (key: string) => void;
}

export function NavSidebar({ title, items, activeKey, onItemClick }: NavSidebarProps) {
  return (
    <aside className="w-48 shrink-0 border-r border-border bg-card overflow-y-auto">
      <div className="p-3">
        {title && (
          <h2 className="text-xs font-medium text-muted-foreground uppercase tracking-wider px-2 mb-2">
            {title}
          </h2>
        )}
        <nav className="flex flex-col gap-0.5">
          {items.map((item) => {
            const Icon = item.icon;
            const isActive = activeKey === item.key;

            return (
              <button
                key={item.key}
                onClick={() => onItemClick(item.key)}
                className={`flex items-center gap-2 px-2 py-1.5 rounded-md text-left text-sm transition-colors ${
                  isActive
                    ? "bg-primary/10 text-primary"
                    : "text-muted-foreground hover:text-foreground hover:bg-card-alt"
                }`}
              >
                {Icon && <Icon className="w-4 h-4 shrink-0" />}
                <span className="truncate">{item.label}</span>
              </button>
            );
          })}
        </nav>
      </div>
    </aside>
  );
}
