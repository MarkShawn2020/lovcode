import { createContext, useContext, useState, type ReactNode } from "react";

interface CollapsibleContextValue {
  open: boolean;
  toggle: () => void;
}

const CollapsibleContext = createContext<CollapsibleContextValue | null>(null);

interface CollapsibleProps {
  children: ReactNode;
  defaultOpen?: boolean;
  className?: string;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

export function Collapsible({
  children,
  defaultOpen = false,
  className = "",
  open,
  onOpenChange,
}: CollapsibleProps) {
  const [uncontrolledOpen, setUncontrolledOpen] = useState(defaultOpen);
  const isControlled = open !== undefined;
  const currentOpen = isControlled ? open : uncontrolledOpen;
  const handleToggle = () => {
    const nextOpen = !currentOpen;
    if (!isControlled) setUncontrolledOpen(nextOpen);
    onOpenChange?.(nextOpen);
  };
  return (
    <CollapsibleContext.Provider value={{ open: currentOpen, toggle: handleToggle }}>
      <div className={className} data-state={currentOpen ? "open" : "closed"}>
        {children}
      </div>
    </CollapsibleContext.Provider>
  );
}

interface CollapsibleTriggerProps {
  children: ReactNode;
  className?: string;
}

export function CollapsibleTrigger({ children, className = "" }: CollapsibleTriggerProps) {
  const ctx = useContext(CollapsibleContext);
  if (!ctx) throw new Error("CollapsibleTrigger must be inside Collapsible");
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={ctx.toggle}
      onKeyDown={(e) => e.key === "Enter" && ctx.toggle()}
      className={`cursor-pointer ${className}`}
      data-state={ctx.open ? "open" : "closed"}
    >
      {children}
    </div>
  );
}

interface CollapsibleContentProps {
  children: ReactNode;
  className?: string;
}

export function CollapsibleContent({ children, className = "" }: CollapsibleContentProps) {
  const ctx = useContext(CollapsibleContext);
  if (!ctx) throw new Error("CollapsibleContent must be inside Collapsible");
  if (!ctx.open) return null;
  return <div className={className}>{children}</div>;
}

export function useCollapsible() {
  const ctx = useContext(CollapsibleContext);
  if (!ctx) throw new Error("useCollapsible must be inside Collapsible");
  return ctx;
}
