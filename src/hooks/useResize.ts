import { useCallback, useRef, useState, useEffect } from "react";

type Direction = "horizontal" | "vertical";

interface UseResizeOptions {
  direction: Direction;
  storageKey?: string;
  defaultValue: number;
  min?: number;
  max?: number;
  /** For ratio mode (0-1), set containerRef */
  containerRef?: React.RefObject<HTMLElement | null>;
}

export function useResize({
  direction,
  storageKey,
  defaultValue,
  min = 0,
  max = 1,
  containerRef,
}: UseResizeOptions) {
  const [value, setValue] = useState(() => {
    if (storageKey) {
      const saved = localStorage.getItem(storageKey);
      if (saved) return Number(saved);
    }
    return defaultValue;
  });

  const isDragging = useRef(false);

  useEffect(() => {
    if (storageKey) {
      localStorage.setItem(storageKey, String(value));
    }
  }, [storageKey, value]);

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      isDragging.current = true;

      const startPos = direction === "horizontal" ? e.clientX : e.clientY;
      const startValue = value;

      const container = containerRef?.current;
      const containerSize = container
        ? direction === "horizontal"
          ? container.getBoundingClientRect().width
          : container.getBoundingClientRect().height
        : 1;

      document.body.style.cursor = direction === "horizontal" ? "col-resize" : "row-resize";
      document.body.style.userSelect = "none";

      const handleMouseMove = (e: MouseEvent) => {
        const currentPos = direction === "horizontal" ? e.clientX : e.clientY;
        const delta = currentPos - startPos;

        let newValue: number;
        if (containerRef) {
          // Ratio mode
          const deltaRatio = delta / containerSize;
          newValue = Math.min(Math.max(startValue + deltaRatio, min), max);
        } else {
          // Absolute mode
          newValue = Math.min(Math.max(startValue + delta, min), max);
        }
        setValue(newValue);
      };

      const handleMouseUp = () => {
        isDragging.current = false;
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
        document.removeEventListener("mousemove", handleMouseMove);
        document.removeEventListener("mouseup", handleMouseUp);
      };

      document.addEventListener("mousemove", handleMouseMove);
      document.addEventListener("mouseup", handleMouseUp);
    },
    [direction, value, min, max, containerRef]
  );

  return { value, setValue, handleMouseDown };
}
