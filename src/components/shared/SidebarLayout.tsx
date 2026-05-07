import type { ReactNode } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { useAtomValue } from "jotai";
import { sidebarCollapsedAtom } from "@/store";

interface SidebarLayoutProps {
  sidebar: ReactNode;
  children: ReactNode;
  className?: string;
  mainClassName?: string;
}

export function SidebarLayout({
  sidebar,
  children,
  className = "flex h-full min-h-0 min-w-0",
  mainClassName = "min-h-0 min-w-0 flex-1 overflow-auto",
}: SidebarLayoutProps) {
  const sidebarCollapsed = useAtomValue(sidebarCollapsedAtom);

  return (
    <div className={className}>
      <AnimatePresence initial={false}>
        {!sidebarCollapsed && (
          <motion.div
            key="sidebar"
            className="flex min-h-0 shrink-0 overflow-hidden"
            initial={{ width: 0, opacity: 0 }}
            animate={{ width: "auto", opacity: 1 }}
            exit={{ width: 0, opacity: 0 }}
            transition={{ duration: 0.18, ease: "easeOut" }}
          >
            {sidebar}
          </motion.div>
        )}
      </AnimatePresence>
      <main className={mainClassName}>
        {children}
      </main>
    </div>
  );
}
