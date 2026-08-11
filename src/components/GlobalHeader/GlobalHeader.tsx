import { BookOpenText, ChevronLeft, ChevronRight, Search } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export type PrimaryRoute = "search" | "library";

export function GlobalHeader({
  activeRoute,
  onNavigate,
  onGoBack,
  onGoForward,
}: {
  activeRoute: PrimaryRoute;
  onNavigate: (route: PrimaryRoute) => void;
  onGoBack: () => void;
  onGoForward: () => void;
}) {
  return (
    <header data-tauri-drag-region className="flex h-12 shrink-0 items-center border-b border-border bg-background px-3">
      <div className="flex min-w-[240px] items-center gap-1 pl-[70px]">
        <button
          type="button"
          onClick={() => onNavigate("search")}
          className="mr-2 inline-flex h-8 items-center gap-2 rounded-lg px-2 text-foreground transition-colors hover:bg-muted"
          aria-label="打开 Ataru 搜索"
        >
          <img src="/ataru.svg" alt="" className="h-6 w-6 shrink-0 object-contain" />
          <span className="font-serif text-[15px] font-semibold tracking-tight">Ataru</span>
        </button>
        <HeaderButton onClick={onGoBack} label="后退"><ChevronLeft className="h-4 w-4" /></HeaderButton>
        <HeaderButton onClick={onGoForward} label="前进"><ChevronRight className="h-4 w-4" /></HeaderButton>
      </div>

      <nav className="flex flex-1 items-center justify-center gap-1" aria-label="主要导航">
        <NavButton active={activeRoute === "search"} onClick={() => onNavigate("search")}>
          <Search className="h-4 w-4" />搜索
        </NavButton>
        <NavButton active={activeRoute === "library"} onClick={() => onNavigate("library")}>
          <BookOpenText className="h-4 w-4" />资料库
        </NavButton>
      </nav>
      <div className="min-w-[240px]" />
    </header>
  );
}

function HeaderButton({ children, onClick, label }: { children: ReactNode; onClick: () => void; label: string }) {
  return (
    <button type="button" onClick={onClick} aria-label={label} title={label} className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
      {children}
    </button>
  );
}

function NavButton({ children, active, onClick }: { children: ReactNode; active: boolean; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className={cn("inline-flex h-8 items-center gap-1.5 rounded-lg px-3 text-sm font-medium transition-colors", active ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-muted hover:text-foreground")}>
      {children}
    </button>
  );
}
