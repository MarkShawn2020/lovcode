import { useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { SearchUI } from "@/components/SearchUI";

export default function SearchOverlay() {
  // Escape closes the palette.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        invoke("toggle_search_overlay").catch(() => {});
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  return (
    <div className="h-screen overflow-hidden rounded-xl border border-border bg-card/95 backdrop-blur">
      <SearchUI compact />
    </div>
  );
}
