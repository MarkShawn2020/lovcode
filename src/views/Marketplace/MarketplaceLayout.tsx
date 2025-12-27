import type { ReactNode } from "react";
import { MarketplaceSidebar } from "./MarketplaceSidebar";
import type { TemplateCategory } from "@/types";

interface MarketplaceLayoutProps {
  children: ReactNode;
  currentCategory: TemplateCategory;
  onCategoryClick: (category: TemplateCategory) => void;
}

export function MarketplaceLayout({ children, currentCategory, onCategoryClick }: MarketplaceLayoutProps) {
  return (
    <div className="flex h-full">
      <MarketplaceSidebar currentCategory={currentCategory} onCategoryClick={onCategoryClick} />
      <main className="flex-1 overflow-auto">
        {children}
      </main>
    </div>
  );
}
