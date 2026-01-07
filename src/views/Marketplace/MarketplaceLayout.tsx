import type { ReactNode } from "react";
import { useMemo } from "react";
import { SidebarLayout, NavSidebar } from "@/components/shared";
import { TEMPLATE_CATEGORIES } from "@/constants";
import type { TemplateCategory } from "@/types";

interface MarketplaceLayoutProps {
  children: ReactNode;
  currentCategory: TemplateCategory;
  onCategoryClick: (category: TemplateCategory) => void;
}

export function MarketplaceLayout({ children, currentCategory, onCategoryClick }: MarketplaceLayoutProps) {
  const items = useMemo(() =>
    TEMPLATE_CATEGORIES
      .filter(c => c.key !== "settings")
      .map(c => ({ key: c.key, label: c.label })),
    []
  );

  return (
    <SidebarLayout
      sidebar={
        <NavSidebar
          items={items}
          activeKey={currentCategory}
          onItemClick={(key) => onCategoryClick(key as TemplateCategory)}
        />
      }
    >
      {children}
    </SidebarLayout>
  );
}
