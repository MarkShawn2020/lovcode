import { useState, useCallback } from "react";
import type { View, FeatureType, TemplateCategory } from "../types";

const MAX_HISTORY = 50;

export function useNavigation(
  initialView: View = { type: "home" },
  marketplaceCategory: TemplateCategory = "commands"
) {
  const [view, setView] = useState<View>(() => {
    const saved = localStorage.getItem("lovcode-view");
    if (saved) {
      try {
        return JSON.parse(saved) as View;
      } catch {
        return initialView;
      }
    }
    return initialView;
  });

  const [viewHistory, setViewHistory] = useState<View[]>(() => {
    const saved = localStorage.getItem("lovcode-view");
    if (saved) {
      try {
        return [JSON.parse(saved) as View];
      } catch {
        return [initialView];
      }
    }
    return [initialView];
  });

  const [historyIndex, setHistoryIndex] = useState(0);

  const navigate = useCallback(
    (newView: View) => {
      setViewHistory((prev) => {
        const newHistory = prev.slice(0, historyIndex + 1);
        newHistory.push(newView);
        if (newHistory.length > MAX_HISTORY) newHistory.shift();
        return newHistory;
      });
      setHistoryIndex((prev) => Math.min(prev + 1, MAX_HISTORY - 1));
      setView(newView);
    },
    [historyIndex]
  );

  const canGoBack = historyIndex > 0;
  const canGoForward = historyIndex < viewHistory.length - 1;

  const goBack = useCallback(() => {
    if (canGoBack) {
      const newIndex = historyIndex - 1;
      setHistoryIndex(newIndex);
      setView(viewHistory[newIndex]);
    }
  }, [canGoBack, historyIndex, viewHistory]);

  const goForward = useCallback(() => {
    if (canGoForward) {
      const newIndex = historyIndex + 1;
      setHistoryIndex(newIndex);
      setView(viewHistory[newIndex]);
    }
  }, [canGoForward, historyIndex, viewHistory]);

  const handleFeatureClick = useCallback(
    (feature: FeatureType) => {
      switch (feature) {
        case "chat":
          navigate({ type: "chat-projects" });
          break;
        case "workspace":
          navigate({ type: "workspace" });
          break;
        case "settings":
          navigate({ type: "settings" });
          break;
        case "commands":
          navigate({ type: "commands" });
          break;
        case "mcp":
          navigate({ type: "mcp" });
          break;
        case "skills":
          navigate({ type: "skills" });
          break;
        case "hooks":
          navigate({ type: "hooks" });
          break;
        case "sub-agents":
          navigate({ type: "sub-agents" });
          break;
        case "output-styles":
          navigate({ type: "output-styles" });
          break;
        case "kb-distill":
          navigate({ type: "kb-distill" });
          break;
        case "kb-reference":
          navigate({ type: "kb-reference" });
          break;
        case "marketplace":
          navigate({ type: "marketplace", category: marketplaceCategory });
          break;
        default:
          navigate({ type: "feature-todo", feature });
      }
    },
    [navigate, marketplaceCategory]
  );

  // Compute current feature from view
  const currentFeature: FeatureType | null =
    view.type === "chat-projects" ||
    view.type === "chat-sessions" ||
    view.type === "chat-messages"
      ? "chat"
      : view.type === "workspace"
        ? "workspace"
        : view.type === "settings"
          ? "settings"
          : view.type === "commands" || view.type === "command-detail"
            ? "commands"
            : view.type === "mcp"
              ? "mcp"
              : view.type === "skills"
                ? "skills"
                : view.type === "hooks"
                  ? "hooks"
                  : view.type === "sub-agents" || view.type === "sub-agent-detail"
                    ? "sub-agents"
                    : view.type === "output-styles"
                      ? "output-styles"
                      : view.type === "kb-distill" || view.type === "kb-distill-detail"
                        ? "kb-distill"
                        : view.type === "kb-reference" || view.type === "kb-reference-doc"
                          ? "kb-reference"
                          : view.type === "marketplace" || view.type === "template-detail"
                            ? "marketplace"
                            : view.type === "feature-todo"
                              ? view.feature
                              : null;

  return {
    view,
    navigate,
    canGoBack,
    canGoForward,
    goBack,
    goForward,
    handleFeatureClick,
    currentFeature,
  };
}
