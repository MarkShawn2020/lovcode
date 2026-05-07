import * as React from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

type AccordionType = "single" | "multiple";
type AccordionValue = string | string[];

interface AccordionContextValue {
  openValues: string[];
  toggleValue: (value: string) => void;
}

interface AccordionItemContextValue {
  value: string;
  open: boolean;
}

const AccordionContext = React.createContext<AccordionContextValue | null>(null);
const AccordionItemContext = React.createContext<AccordionItemContextValue | null>(null);

function normalizeValue(value: AccordionValue | undefined): string[] {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function useAccordion() {
  const context = React.useContext(AccordionContext);
  if (!context) {
    throw new Error("Accordion components must be used within <Accordion />");
  }
  return context;
}

function useAccordionItem() {
  const context = React.useContext(AccordionItemContext);
  if (!context) {
    throw new Error("Accordion item components must be used within <AccordionItem />");
  }
  return context;
}

function Accordion({
  type = "single",
  value,
  defaultValue,
  collapsible = false,
  onValueChange,
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement> & {
  type?: AccordionType;
  value?: AccordionValue;
  defaultValue?: AccordionValue;
  collapsible?: boolean;
  onValueChange?: (value: AccordionValue) => void;
}) {
  const [uncontrolledValue, setUncontrolledValue] = React.useState<string[]>(
    normalizeValue(defaultValue),
  );
  const controlled = value !== undefined;
  const openValues = controlled ? normalizeValue(value) : uncontrolledValue;

  const setOpenValues = React.useCallback(
    (nextValues: string[]) => {
      if (!controlled) {
        setUncontrolledValue(nextValues);
      }
      onValueChange?.(type === "single" ? nextValues[0] ?? "" : nextValues);
    },
    [controlled, onValueChange, type],
  );

  const toggleValue = React.useCallback(
    (itemValue: string) => {
      const currentlyOpen = openValues.includes(itemValue);
      if (type === "multiple") {
        setOpenValues(
          currentlyOpen
            ? openValues.filter((openValue) => openValue !== itemValue)
            : [...openValues, itemValue],
        );
        return;
      }

      if (currentlyOpen && collapsible) {
        setOpenValues([]);
      } else if (!currentlyOpen) {
        setOpenValues([itemValue]);
      }
    },
    [collapsible, openValues, setOpenValues, type],
  );

  return (
    <AccordionContext.Provider value={{ openValues, toggleValue }}>
      <div data-slot="accordion" className={cn("w-full", className)} {...props} />
    </AccordionContext.Provider>
  );
}

function AccordionItem({
  value,
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement> & {
  value: string;
}) {
  const { openValues } = useAccordion();
  const open = openValues.includes(value);

  return (
    <AccordionItemContext.Provider value={{ value, open }}>
      <div
        data-slot="accordion-item"
        data-state={open ? "open" : "closed"}
        className={cn("border-b border-border last:border-b-0", className)}
        {...props}
      />
    </AccordionItemContext.Provider>
  );
}

function AccordionTrigger({
  className,
  children,
  onClick,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  const { toggleValue } = useAccordion();
  const { value, open } = useAccordionItem();

  return (
    <button
      type="button"
      data-slot="accordion-trigger"
      data-state={open ? "open" : "closed"}
      onClick={(event) => {
        onClick?.(event);
        if (!event.defaultPrevented) toggleValue(value);
      }}
      className={cn(
        "group flex w-full items-center justify-between gap-3 px-4 py-3 text-left text-sm font-medium text-foreground transition-colors hover:bg-card-alt focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        className,
      )}
      {...props}
    >
      <span className="min-w-0 flex-1">{children}</span>
      <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-data-[state=open]:rotate-180" />
    </button>
  );
}

function AccordionContent({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  const { open } = useAccordionItem();
  if (!open) return null;

  return (
    <div
      data-slot="accordion-content"
      data-state="open"
      className={cn("px-4 pb-4", className)}
      {...props}
    />
  );
}

export { Accordion, AccordionItem, AccordionTrigger, AccordionContent };
