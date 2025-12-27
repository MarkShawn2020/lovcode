import { TEMPLATE_CATEGORIES } from "@/constants";
import type { TemplateCategory } from "@/types";

interface MarketplaceSidebarProps {
  currentCategory: TemplateCategory;
  onCategoryClick: (category: TemplateCategory) => void;
}

export function MarketplaceSidebar({ currentCategory, onCategoryClick }: MarketplaceSidebarProps) {
  return (
    <aside className="w-48 shrink-0 border-r border-border bg-card overflow-y-auto">
      <div className="p-3">
        <h2 className="text-xs font-medium text-muted-foreground uppercase tracking-wider px-2 mb-2">
          Categories
        </h2>
        <nav className="flex flex-col gap-0.5">
          {TEMPLATE_CATEGORIES.map((cat) => {
            const Icon = cat.icon;
            const isActive = currentCategory === cat.key;

            return (
              <button
                key={cat.key}
                onClick={() => onCategoryClick(cat.key)}
                className={`flex items-center gap-2 px-2 py-1.5 rounded-md text-left text-sm transition-colors ${
                  isActive
                    ? "bg-primary/10 text-primary"
                    : "text-muted-foreground hover:text-foreground hover:bg-card-alt"
                }`}
              >
                {Icon && <Icon className="w-4 h-4 shrink-0" />}
                <span className="truncate">{cat.label}</span>
              </button>
            );
          })}
        </nav>
      </div>
    </aside>
  );
}
