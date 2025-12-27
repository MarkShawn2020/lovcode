import { useState, useEffect, useMemo } from "react";
import { invoke } from "@tauri-apps/api/core";
import { save } from "@tauri-apps/plugin-dialog";
import {
  ChevronDownIcon,
  ChevronRightIcon,
  DotsHorizontalIcon,
  ResetIcon,
} from "@radix-ui/react-icons";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { CommitInfo, Feature } from "./types";

interface GitHistoryProps {
  projectPath: string;
  features: Feature[];
  onRefresh?: () => void;
}

type ViewMode = "feats" | "timeline";

export function GitHistory({ projectPath, features, onRefresh }: GitHistoryProps) {
  const [commits, setCommits] = useState<CommitInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [viewMode, setViewMode] = useState<ViewMode>("feats");
  const [expandedFeats, setExpandedFeats] = useState<Set<string>>(new Set());

  // Load commits
  useEffect(() => {
    async function loadCommits() {
      setLoading(true);
      try {
        const result = await invoke<CommitInfo[]>("git_log", {
          projectPath,
          limit: 100,
        });
        setCommits(result);
      } catch (e) {
        console.error("Failed to load commits:", e);
      } finally {
        setLoading(false);
      }
    }
    loadCommits();
  }, [projectPath]);

  // Group commits by feat
  const commitsByFeat = useMemo(() => {
    const grouped: Record<string, CommitInfo[]> = {};
    const unassociated: CommitInfo[] = [];

    for (const commit of commits) {
      if (commit.feat_name) {
        if (!grouped[commit.feat_name]) {
          grouped[commit.feat_name] = [];
        }
        grouped[commit.feat_name].push(commit);
      } else {
        unassociated.push(commit);
      }
    }

    return { grouped, unassociated };
  }, [commits]);

  // Get feat names from features for ordering
  const featOrder = useMemo(() => {
    return features
      .filter((f) => !f.archived)
      .map((f) => f.name.toLowerCase().replace(/\s+/g, "-"));
  }, [features]);

  const toggleFeat = (featName: string) => {
    setExpandedFeats((prev) => {
      const next = new Set(prev);
      if (next.has(featName)) {
        next.delete(featName);
      } else {
        next.add(featName);
      }
      return next;
    });
  };

  const handleRevert = async (commit: CommitInfo) => {
    try {
      await invoke("git_revert", {
        projectPath,
        commitHash: commit.hash,
      });
      // Reload commits
      const result = await invoke<CommitInfo[]>("git_log", {
        projectPath,
        limit: 100,
      });
      setCommits(result);
      onRefresh?.();
    } catch (e) {
      console.error("Failed to revert:", e);
      alert(`Revert failed: ${e}`);
    }
  };

  const handleExportChangelog = async () => {
    try {
      const featNames = Object.keys(commitsByFeat.grouped);
      const changelog = await invoke<string>("git_generate_changelog", {
        projectPath,
        featNames,
        fromDate: null,
      });

      const path = await save({
        defaultPath: "CHANGELOG.md",
        filters: [{ name: "Markdown", extensions: ["md"] }],
      });

      if (path) {
        await invoke("write_file", { path, content: changelog });
      }
    } catch (e) {
      console.error("Failed to export changelog:", e);
      alert(`Export failed: ${e}`);
    }
  };

  const formatTime = (timestamp: number) => {
    const date = new Date(timestamp * 1000);
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    const hours = Math.floor(diff / (1000 * 60 * 60));
    const days = Math.floor(hours / 24);

    if (hours < 1) return "just now";
    if (hours < 24) return `${hours}h ago`;
    if (days < 7) return `${days}d ago`;
    return date.toLocaleDateString();
  };

  if (loading) {
    return (
      <div className="p-4 text-muted-foreground text-sm">
        Loading git history...
      </div>
    );
  }

  if (commits.length === 0) {
    return (
      <div className="p-4 text-muted-foreground text-sm">
        No commits found
      </div>
    );
  }

  return (
    <div className="border-t border-border">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-border bg-muted/30">
        <div className="flex items-center gap-3">
          <h3 className="text-sm font-medium text-ink">Git History</h3>
          <Tabs value={viewMode} onValueChange={(v) => setViewMode(v as ViewMode)}>
            <TabsList className="h-7">
              <TabsTrigger value="feats" className="text-xs px-2 py-1">
                Feats
              </TabsTrigger>
              <TabsTrigger value="timeline" className="text-xs px-2 py-1">
                Timeline
              </TabsTrigger>
            </TabsList>
          </Tabs>
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger className="p-1 hover:bg-muted rounded">
            <DotsHorizontalIcon className="w-4 h-4 text-muted-foreground" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={handleExportChangelog}>
              Export Changelog
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* Content */}
      <div className="max-h-[300px] overflow-y-auto">
        {viewMode === "feats" ? (
          <FeatsView
            commitsByFeat={commitsByFeat}
            featOrder={featOrder}
            expandedFeats={expandedFeats}
            onToggleFeat={toggleFeat}
            onRevert={handleRevert}
            formatTime={formatTime}
          />
        ) : (
          <TimelineView
            commits={commits}
            onRevert={handleRevert}
            formatTime={formatTime}
          />
        )}
      </div>
    </div>
  );
}

// ============================================================================
// Feats View
// ============================================================================

interface FeatsViewProps {
  commitsByFeat: {
    grouped: Record<string, CommitInfo[]>;
    unassociated: CommitInfo[];
  };
  featOrder: string[];
  expandedFeats: Set<string>;
  onToggleFeat: (featName: string) => void;
  onRevert: (commit: CommitInfo) => void;
  formatTime: (timestamp: number) => string;
}

function FeatsView({
  commitsByFeat,
  featOrder,
  expandedFeats,
  onToggleFeat,
  onRevert,
  formatTime,
}: FeatsViewProps) {
  const { grouped, unassociated } = commitsByFeat;

  // Sort feats: known feats first (by order), then unknown
  const sortedFeats = useMemo(() => {
    const known: string[] = [];
    const unknown: string[] = [];

    for (const feat of Object.keys(grouped)) {
      if (featOrder.includes(feat)) {
        known.push(feat);
      } else {
        unknown.push(feat);
      }
    }

    known.sort((a, b) => featOrder.indexOf(a) - featOrder.indexOf(b));
    unknown.sort();

    return [...known, ...unknown];
  }, [grouped, featOrder]);

  return (
    <div className="divide-y divide-border">
      {sortedFeats.map((feat) => {
        const commits = grouped[feat];
        const isExpanded = expandedFeats.has(feat);

        return (
          <div key={feat}>
            <button
              onClick={() => onToggleFeat(feat)}
              className="w-full flex items-center gap-2 px-4 py-2 text-left hover:bg-muted/50 transition-colors"
            >
              {isExpanded ? (
                <ChevronDownIcon className="w-4 h-4 text-muted-foreground" />
              ) : (
                <ChevronRightIcon className="w-4 h-4 text-muted-foreground" />
              )}
              <span className="text-sm font-medium text-ink">{feat}</span>
              <span className="text-xs text-muted-foreground">
                ({commits.length} commits)
              </span>
            </button>
            {isExpanded && (
              <div className="pl-8 pr-4 pb-2">
                {commits.map((commit) => (
                  <CommitRow
                    key={commit.hash}
                    commit={commit}
                    onRevert={onRevert}
                    formatTime={formatTime}
                  />
                ))}
              </div>
            )}
          </div>
        );
      })}
      {unassociated.length > 0 && (
        <div>
          <button
            onClick={() => onToggleFeat("__unassociated__")}
            className="w-full flex items-center gap-2 px-4 py-2 text-left hover:bg-muted/50 transition-colors"
          >
            {expandedFeats.has("__unassociated__") ? (
              <ChevronDownIcon className="w-4 h-4 text-muted-foreground" />
            ) : (
              <ChevronRightIcon className="w-4 h-4 text-muted-foreground" />
            )}
            <span className="text-sm font-medium text-muted-foreground italic">
              Unassociated
            </span>
            <span className="text-xs text-muted-foreground">
              ({unassociated.length} commits)
            </span>
          </button>
          {expandedFeats.has("__unassociated__") && (
            <div className="pl-8 pr-4 pb-2">
              {unassociated.map((commit) => (
                <CommitRow
                  key={commit.hash}
                  commit={commit}
                  onRevert={onRevert}
                  formatTime={formatTime}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ============================================================================
// Timeline View
// ============================================================================

interface TimelineViewProps {
  commits: CommitInfo[];
  onRevert: (commit: CommitInfo) => void;
  formatTime: (timestamp: number) => string;
}

function TimelineView({ commits, onRevert, formatTime }: TimelineViewProps) {
  return (
    <div className="divide-y divide-border">
      {commits.map((commit) => (
        <CommitRow
          key={commit.hash}
          commit={commit}
          onRevert={onRevert}
          formatTime={formatTime}
          showFeat
        />
      ))}
    </div>
  );
}

// ============================================================================
// Commit Row
// ============================================================================

interface CommitRowProps {
  commit: CommitInfo;
  onRevert: (commit: CommitInfo) => void;
  formatTime: (timestamp: number) => string;
  showFeat?: boolean;
}

function CommitRow({ commit, onRevert, formatTime, showFeat }: CommitRowProps) {
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div className="flex items-center gap-3 px-4 py-1.5 hover:bg-muted/50 cursor-default">
          <code className="text-xs text-primary font-mono">
            {commit.short_hash}
          </code>
          <span className="text-sm text-ink flex-1 truncate">
            {commit.message}
          </span>
          {showFeat && commit.feat_name && (
            <span className="text-xs px-1.5 py-0.5 bg-primary/10 text-primary rounded">
              {commit.feat_name}
            </span>
          )}
          <span className="text-xs text-muted-foreground">
            {formatTime(commit.timestamp)}
          </span>
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem
          onClick={() => onRevert(commit)}
          className="gap-2 text-destructive"
        >
          <ResetIcon className="w-3.5 h-3.5" />
          Revert this commit
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}
