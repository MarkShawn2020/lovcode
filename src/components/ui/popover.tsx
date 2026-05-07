import { createPortal } from "react-dom";
import {
  useState,
  useRef,
  useEffect,
  useLayoutEffect,
  createContext,
  useContext,
  type CSSProperties,
  type ReactNode,
} from "react";

const VIEWPORT_PADDING = 8;

interface PopoverContextValue {
  open: boolean;
  setOpen: (open: boolean) => void;
  triggerRef: React.RefObject<HTMLButtonElement | null>;
}

const PopoverContext = createContext<PopoverContextValue | null>(null);

interface PopoverProps {
  children: ReactNode;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  className?: string;
}

export function Popover({ children, open: controlledOpen, onOpenChange, className = "" }: PopoverProps) {
  const [internalOpen, setInternalOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);

  const open = controlledOpen ?? internalOpen;
  const setOpen = (value: boolean) => {
    setInternalOpen(value);
    onOpenChange?.(value);
  };

  return (
    <PopoverContext.Provider value={{ open, setOpen, triggerRef }}>
      <div className={`relative inline-block ${className}`}>
        {children}
      </div>
    </PopoverContext.Provider>
  );
}

interface PopoverTriggerProps {
  children: ReactNode;
  asChild?: boolean;
  className?: string;
}

export function PopoverTrigger({ children, className = "" }: PopoverTriggerProps) {
  const context = useContext(PopoverContext);
  if (!context) throw new Error("PopoverTrigger must be used within Popover");

  return (
    <button
      ref={context.triggerRef}
      onClick={() => context.setOpen(!context.open)}
      className={className}
      type="button"
    >
      {children}
    </button>
  );
}

interface PopoverContentProps {
  children: ReactNode;
  className?: string;
  align?: "start" | "center" | "end";
  sideOffset?: number;
}

interface PopoverSize {
  width: number;
  height: number;
}

export function PopoverContent({
  children,
  className = "",
  align = "center",
  sideOffset = 4,
}: PopoverContentProps) {
  const context = useContext(PopoverContext);
  const contentRef = useRef<HTMLDivElement>(null);
  const [triggerRect, setTriggerRect] = useState<DOMRect | null>(null);
  const [contentSize, setContentSize] = useState<PopoverSize | null>(null);

  if (!context) throw new Error("PopoverContent must be used within Popover");

  useEffect(() => {
    if (!context.open) return;

    const handleClickOutside = (e: MouseEvent) => {
      if (
        contentRef.current &&
        !contentRef.current.contains(e.target as Node) &&
        context.triggerRef.current &&
        !context.triggerRef.current.contains(e.target as Node)
      ) {
        context.setOpen(false);
      }
    };

    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        context.setOpen(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside, true);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside, true);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [context.open, context]);

  useLayoutEffect(() => {
    if (!context.open) {
      setTriggerRect(null);
      setContentSize(null);
      return;
    }

    const updateLayout = () => {
      setTriggerRect(context.triggerRef.current?.getBoundingClientRect() ?? null);
      const contentElement = contentRef.current;
      if (!contentElement) return;
      const contentRect = contentElement.getBoundingClientRect();
      setContentSize((current) => {
        const next = {
          width: Math.max(contentRect.width, contentElement.scrollWidth),
          height: Math.max(contentRect.height, contentElement.scrollHeight),
        };
        if (
          current &&
          Math.abs(current.width - next.width) < 0.5 &&
          Math.abs(current.height - next.height) < 0.5
        ) {
          return current;
        }
        return next;
      });
    };

    updateLayout();
    const frameId = window.requestAnimationFrame(updateLayout);
    const observedElement = contentRef.current;
    const resizeObserver =
      typeof ResizeObserver === "undefined" || !observedElement
        ? null
        : new ResizeObserver(updateLayout);

    if (resizeObserver && observedElement) {
      resizeObserver.observe(observedElement);
    }
    window.addEventListener("resize", updateLayout);
    window.addEventListener("scroll", updateLayout, true);
    return () => {
      window.cancelAnimationFrame(frameId);
      resizeObserver?.disconnect();
      window.removeEventListener("resize", updateLayout);
      window.removeEventListener("scroll", updateLayout, true);
    };
  }, [context.open, context.triggerRef]);

  if (!context.open) return null;

  const alignmentStyle = getPopoverAlignmentStyle(triggerRect, contentSize, align, sideOffset);

  return createPortal(
    <div
      ref={contentRef}
      style={alignmentStyle}
      className={`
        fixed z-50
        min-w-[8rem] rounded-md border border-border bg-popover p-4
        text-popover-foreground shadow-md outline-none
        animate-in fade-in-0 zoom-in-95
        ${className}
      `}
    >
      {children}
    </div>,
    document.body,
  );
}

function getPopoverAlignmentStyle(
  rect: DOMRect | null,
  contentSize: PopoverSize | null,
  align: NonNullable<PopoverContentProps["align"]>,
  sideOffset: number,
): CSSProperties {
  if (!rect || !contentSize) {
    return {
      left: 0,
      top: 0,
      visibility: "hidden",
    };
  }

  const maxWidth = Math.max(0, window.innerWidth - VIEWPORT_PADDING * 2);
  const maxHeight = Math.max(0, window.innerHeight - VIEWPORT_PADDING * 2);
  const popoverWidth = Math.min(contentSize.width, maxWidth);
  const popoverHeight = Math.min(contentSize.height, maxHeight);
  const minLeft = VIEWPORT_PADDING;
  const maxLeft = Math.max(VIEWPORT_PADDING, window.innerWidth - popoverWidth - VIEWPORT_PADDING);
  const minTop = VIEWPORT_PADDING;
  const maxTop = Math.max(VIEWPORT_PADDING, window.innerHeight - popoverHeight - VIEWPORT_PADDING);

  const preferredLeft =
    align === "end"
      ? rect.right - popoverWidth
      : align === "center"
        ? rect.left + rect.width / 2 - popoverWidth / 2
        : rect.left;
  const belowTop = rect.bottom + sideOffset;
  const aboveTop = rect.top - sideOffset - popoverHeight;
  const preferredTop =
    belowTop + popoverHeight > window.innerHeight - VIEWPORT_PADDING && aboveTop >= VIEWPORT_PADDING
      ? aboveTop
      : belowTop;

  return {
    left: clamp(preferredLeft, minLeft, maxLeft),
    top: clamp(preferredTop, minTop, maxTop),
    maxHeight,
    maxWidth,
    overflowY: contentSize.height > maxHeight ? "auto" : undefined,
  };
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}
