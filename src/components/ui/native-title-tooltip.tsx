import { useEffect, useRef, useState } from "react";

import { cn } from "@/lib/utils";

const NATIVE_TITLE_ATTRIBUTE = "data-native-title";
const NATIVE_TITLE_ARIA_ATTRIBUTE = "data-native-title-aria-label";
const DEFAULT_TOOLTIP_DELAY_MS = 2000;
const TOOLTIP_OFFSET = 8;
const VIEWPORT_PADDING = 8;

type TooltipPlacement = "top" | "bottom";

interface TooltipState {
  text: string;
  left: number;
  top: number;
  placement: TooltipPlacement;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function isTitleElement(element: Element): element is HTMLElement | SVGElement {
  return element instanceof HTMLElement || element instanceof SVGElement;
}

function isInteractiveElement(element: Element) {
  if (!(element instanceof HTMLElement)) return false;

  const tagName = element.tagName.toLowerCase();
  if (["button", "a", "input", "select", "textarea", "summary"].includes(tagName)) return true;
  if (element.hasAttribute("tabindex") && element.getAttribute("tabindex") !== "-1") return true;

  const role = element.getAttribute("role");
  return role
    ? ["button", "checkbox", "link", "menuitem", "radio", "switch", "tab"].includes(role)
    : false;
}

function preserveAccessibleName(element: Element, title: string) {
  const ownsAriaLabel = element.getAttribute(NATIVE_TITLE_ARIA_ATTRIBUTE) === "true";

  if (!title.trim() || !isInteractiveElement(element) || element.hasAttribute("aria-labelledby")) {
    if (ownsAriaLabel) {
      element.removeAttribute("aria-label");
      element.removeAttribute(NATIVE_TITLE_ARIA_ATTRIBUTE);
    }
    return;
  }

  if (element.hasAttribute("aria-label") && !ownsAriaLabel) return;

  if (element.textContent?.trim()) {
    if (ownsAriaLabel) {
      element.removeAttribute("aria-label");
      element.removeAttribute(NATIVE_TITLE_ARIA_ATTRIBUTE);
    }
    return;
  }

  element.setAttribute("aria-label", title);
  element.setAttribute(NATIVE_TITLE_ARIA_ATTRIBUTE, "true");
}

function moveNativeTitle(element: Element) {
  if (!isTitleElement(element)) return;

  const title = element.getAttribute("title");
  if (title === null) return;

  element.setAttribute(NATIVE_TITLE_ATTRIBUTE, title);
  element.removeAttribute("title");
  preserveAccessibleName(element, title);
}

function sanitizeTitleTree(root: ParentNode) {
  if (root instanceof Element) {
    moveNativeTitle(root);
  }

  root.querySelectorAll?.("[title]").forEach(moveNativeTitle);
}

function findTooltipTarget(target: EventTarget | null) {
  if (!(target instanceof Element)) return null;

  const element = target.closest(`[${NATIVE_TITLE_ATTRIBUTE}], [title]`);
  if (!element) return null;

  moveNativeTitle(element);
  return element.hasAttribute(NATIVE_TITLE_ATTRIBUTE) ? element : null;
}

function getTooltipState(target: Element): TooltipState | null {
  const text = target.getAttribute(NATIVE_TITLE_ATTRIBUTE);
  if (!text?.trim()) return null;

  const rect = target.getBoundingClientRect();
  const viewportWidth = document.documentElement.clientWidth || window.innerWidth;
  const viewportHeight = document.documentElement.clientHeight || window.innerHeight;
  const availableBelow = viewportHeight - rect.bottom;
  const placement: TooltipPlacement = availableBelow < 48 && rect.top > availableBelow ? "top" : "bottom";

  return {
    text,
    left: clamp(rect.left + rect.width / 2, VIEWPORT_PADDING, viewportWidth - VIEWPORT_PADDING),
    top: placement === "top"
      ? Math.max(VIEWPORT_PADDING, rect.top - TOOLTIP_OFFSET)
      : Math.min(viewportHeight - VIEWPORT_PADDING, rect.bottom + TOOLTIP_OFFSET),
    placement,
  };
}

export function NativeTitleTooltip() {
  const activeTargetRef = useRef<Element | null>(null);
  const showTimerRef = useRef<number | null>(null);
  const [tooltip, setTooltip] = useState<TooltipState | null>(null);

  useEffect(() => {
    const clearShowTimer = () => {
      if (showTimerRef.current === null) return;

      window.clearTimeout(showTimerRef.current);
      showTimerRef.current = null;
    };

    const hideTooltip = () => {
      clearShowTimer();
      activeTargetRef.current = null;
      setTooltip(null);
    };

    const scheduleTooltip = (target: Element) => {
      clearShowTimer();
      activeTargetRef.current = target;
      setTooltip(null);

      showTimerRef.current = window.setTimeout(() => {
        showTimerRef.current = null;
        if (activeTargetRef.current !== target || !target.isConnected) return;

        setTooltip(getTooltipState(target));
      }, DEFAULT_TOOLTIP_DELAY_MS);
    };

    const handleEnter = (event: PointerEvent | FocusEvent) => {
      const target = findTooltipTarget(event.target);
      if (!target) return;
      if (activeTargetRef.current === target) return;

      const nextTooltip = getTooltipState(target);
      if (!nextTooltip) {
        hideTooltip();
        return;
      }

      scheduleTooltip(target);
    };

    const handleLeave = (event: PointerEvent | FocusEvent) => {
      const currentTarget = activeTargetRef.current;
      if (!currentTarget) return;

      const relatedTarget = event.relatedTarget;
      if (relatedTarget instanceof Node && currentTarget.contains(relatedTarget)) return;

      hideTooltip();
    };

    const handleViewportChange = () => {
      const currentTarget = activeTargetRef.current;
      if (!currentTarget?.isConnected) {
        hideTooltip();
        return;
      }

      setTooltip((currentTooltip) => currentTooltip ? getTooltipState(currentTarget) : currentTooltip);
    };

    sanitizeTitleTree(document.body);

    const observer = new MutationObserver((records) => {
      records.forEach((record) => {
        if (record.type === "attributes" && record.target instanceof Element) {
          moveNativeTitle(record.target);
          return;
        }

        record.addedNodes.forEach((node) => {
          if (node instanceof Element) {
            sanitizeTitleTree(node);
          }
        });
      });

      const currentTarget = activeTargetRef.current;
      if (currentTarget && !currentTarget.isConnected) {
        hideTooltip();
      }
    });

    observer.observe(document.body, {
      attributeFilter: ["title"],
      attributes: true,
      childList: true,
      subtree: true,
    });

    document.addEventListener("pointerover", handleEnter, true);
    document.addEventListener("pointerout", handleLeave, true);
    document.addEventListener("focusin", handleEnter, true);
    document.addEventListener("focusout", handleLeave, true);
    window.addEventListener("resize", handleViewportChange);
    window.addEventListener("scroll", handleViewportChange, true);

    return () => {
      clearShowTimer();
      observer.disconnect();
      document.removeEventListener("pointerover", handleEnter, true);
      document.removeEventListener("pointerout", handleLeave, true);
      document.removeEventListener("focusin", handleEnter, true);
      document.removeEventListener("focusout", handleLeave, true);
      window.removeEventListener("resize", handleViewportChange);
      window.removeEventListener("scroll", handleViewportChange, true);
    };
  }, []);

  if (!tooltip) return null;

  return (
    <div
      role="tooltip"
      className={cn(
        "pointer-events-none fixed z-[1000] max-w-[min(22rem,calc(100vw-1rem))] break-words rounded-lg border border-border/20 bg-foreground px-3 py-1.5 text-xs leading-relaxed text-background shadow-lg",
        tooltip.placement === "top" ? "-translate-x-1/2 -translate-y-full" : "-translate-x-1/2"
      )}
      style={{ left: tooltip.left, top: tooltip.top }}
    >
      <span
        className={cn(
          "absolute left-1/2 size-2 -translate-x-1/2 rotate-45 rounded-[2px] bg-foreground",
          tooltip.placement === "top" ? "-bottom-1" : "-top-1"
        )}
      />
      <span className="relative z-10 whitespace-pre-line">{tooltip.text}</span>
    </div>
  );
}
