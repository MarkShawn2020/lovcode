import type { ComponentType } from "react";

interface NavItem {
  key: string;
  label: string;
  icon?: ComponentType<{ className?: string }>;
}

interface NavGroup {
  title?: string;
  items: NavItem[];
}

interface NavSidebarProps {
  title?: string;
  items?: NavItem[];
  groups?: NavGroup[];
  activeKey: string | null;
  onItemClick: (key: string) => void;
}

export function NavSidebar({ title, items, groups, activeKey, onItemClick }: NavSidebarProps) {
  const renderItem = (item: NavItem) => {
    const isActive = activeKey === item.key;

    return (
      <button
        key={item.key}
        onClick={() => onItemClick(item.key)}
        className={`ml-2 px-2 py-1.5 rounded-md text-left text-sm transition-colors truncate ${
          isActive
            ? "bg-primary/10 text-primary font-medium"
            : "text-muted-foreground hover:text-foreground hover:bg-card-alt"
        }`}
      >
        {item.label}
      </button>
    );
  };

  return (
    <aside className="w-48 shrink-0 border-r border-border bg-card overflow-y-auto">
      <div className="p-3">
        {title && (
          <h2 className="text-xs font-medium text-muted-foreground uppercase tracking-wider px-2 mb-2">
            {title}
          </h2>
        )}
        {/* Render grouped items */}
        {groups && groups.map((group, idx) => (
          <div key={idx} className={idx > 0 ? "mt-4" : ""}>
            {group.title && (
              <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider px-2 mb-1.5">
                {group.title}
              </h3>
            )}
            <nav className="flex flex-col gap-0.5">
              {group.items.map(renderItem)}
            </nav>
          </div>
        ))}
        {/* Render flat items (backwards compatible) */}
        {items && !groups && (
          <nav className="flex flex-col gap-0.5">
            {items.map(renderItem)}
          </nav>
        )}
      </div>
    </aside>
  );
}
