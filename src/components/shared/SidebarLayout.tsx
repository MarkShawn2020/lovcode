import type { ReactNode } from "react";

interface SidebarLayoutProps {
  sidebar: ReactNode;
  children: ReactNode;
}

export function SidebarLayout({ sidebar, children }: SidebarLayoutProps) {
  return (
    <div className="flex h-full">
      {sidebar}
      <main className="flex-1 overflow-auto">
        {children}
      </main>
    </div>
  );
}
