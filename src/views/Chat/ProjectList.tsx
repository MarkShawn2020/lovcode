import { useState, useCallback, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { FileIcon, ChatBubbleIcon, ReloadIcon } from "@radix-ui/react-icons";
import { Switch } from "../../components/ui/switch";
import { useAtom } from "jotai";
import { chatViewModeAtom, allProjectsSortByAtom, hideEmptySessionsAllAtom } from "../../store";
import { useAppConfig } from "../../context";
import { VirtualChatList } from "./VirtualChatList";
import { formatRelativeTime, useReadableText } from "./utils";
import { useInvokeQuery } from "../../hooks";
import type { Project, Session, ChatMessage, SearchResult, ChatsResponse } from "../../types";

interface ProjectListProps {
  onSelectProject: (p: Project) => void;
  onSelectSession: (s: Session) => void;
  onSelectChat: (c: ChatMessage) => void;
}

export function ProjectList({ onSelectProject, onSelectSession, onSelectChat }: ProjectListProps) {
  const { formatPath } = useAppConfig();
  const [viewMode, setViewMode] = useAtom(chatViewModeAtom);
  const toReadable = useReadableText();

  // Use react-query for cached data fetching
  const { data: projects, isLoading: loadingProjects } = useInvokeQuery<Project[]>(["projects"], "list_projects");
  const { data: allSessions, isLoading: loadingSessions } = useInvokeQuery<Session[]>(["sessions"], "list_all_sessions");
  const { data: chatsResponse, isLoading: loadingChats } = useInvokeQuery<ChatsResponse>(["chats"], "list_all_chats", { limit: 50 });

  // Local state for pagination (chats loaded beyond initial fetch)
  const [extraChats, setExtraChats] = useState<ChatMessage[]>([]);
  const [loadingMoreChats, setLoadingMoreChats] = useState(false);

  const allChats = chatsResponse ? [...chatsResponse.items, ...extraChats] : null;
  const totalChats = chatsResponse?.total ?? 0;
  const CHATS_PAGE_SIZE = 50;

  const [sortBy, setSortBy] = useAtom(allProjectsSortByAtom);
  const [hideEmptySessions, setHideEmptySessions] = useAtom(hideEmptySessionsAllAtom);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<SearchResult[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [indexBuilding, setIndexBuilding] = useState(false);
  const [indexStatus, setIndexStatus] = useState<string | null>(null);
  const [indexBuilt, setIndexBuilt] = useState(false);

  const loadMoreChats = useCallback(async () => {
    if (loadingMoreChats || !allChats || allChats.length >= totalChats) return;
    setLoadingMoreChats(true);
    try {
      const res = await invoke<ChatsResponse>("list_all_chats", {
        limit: CHATS_PAGE_SIZE,
        offset: allChats.length,
      });
      setExtraChats((prev) => [...prev, ...res.items]);
    } finally {
      setLoadingMoreChats(false);
    }
  }, [allChats, totalChats, loadingMoreChats]);

  const loading =
    viewMode === "projects" ? loadingProjects : viewMode === "sessions" ? loadingSessions : loadingChats;

  const handleBuildIndex = async () => {
    setIndexBuilding(true);
    setIndexStatus(null);
    try {
      await invoke<number>("build_search_index");
      setIndexBuilt(true);
    } catch (e) {
      setIndexStatus(`Error: ${e}`);
    } finally {
      setIndexBuilding(false);
    }
  };

  useEffect(() => {
    if (!indexBuilt && !indexBuilding) {
      handleBuildIndex();
    }
  }, [indexBuilt, indexBuilding]);

  useEffect(() => {
    if (viewMode !== "chats") return;
    if (!searchQuery.trim()) {
      setSearchResults(null);
      return;
    }
    const timer = setTimeout(async () => {
      setSearching(true);
      try {
        const results = await invoke<SearchResult[]>("search_chats", { query: searchQuery, limit: 50 });
        setSearchResults(results);
      } catch (e) {
        if (String(e).includes("not built")) {
          setIndexStatus("Search index not built. Click 'Build Index' to create it.");
        }
        setSearchResults([]);
      } finally {
        setSearching(false);
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [searchQuery, viewMode]);

  const sortedProjects = [...(projects || [])].sort((a, b) => {
    switch (sortBy) {
      case "recent":
        return b.last_active - a.last_active;
      case "sessions":
        return b.session_count - a.session_count;
      case "name":
        return a.path.localeCompare(b.path);
    }
  });

  const filteredSessions = hideEmptySessions
    ? (allSessions || []).filter((s) => s.message_count > 0)
    : allSessions || [];

  const sortedSessions = [...filteredSessions].sort((a, b) => {
    switch (sortBy) {
      case "recent":
        return b.last_modified - a.last_modified;
      case "sessions":
        return b.message_count - a.message_count;
      case "name":
        return (a.summary || "").localeCompare(b.summary || "");
    }
  });

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-muted-foreground">Loading {viewMode}...</p>
      </div>
    );
  }

  return (
    <div className="px-6 py-8">
      <header className="mb-6">
        <h1 className="font-serif text-3xl font-semibold text-ink">Vibe Coding Chat History</h1>
        <p className="text-muted-foreground mt-1">
          {(projects || []).length} projects · {(allSessions || []).length} sessions · {totalChats} chats
        </p>
      </header>

      <div className="flex border-b border-border mb-4">
        <button
          onClick={() => setViewMode("projects")}
          className={`px-4 py-2 text-sm font-medium transition-colors ${
            viewMode === "projects"
              ? "text-primary border-b-2 border-primary -mb-px"
              : "text-muted-foreground hover:text-ink"
          }`}
        >
          <FileIcon className="w-4 h-4 inline mr-1.5" />
          Projects
        </button>
        <button
          onClick={() => setViewMode("sessions")}
          className={`px-4 py-2 text-sm font-medium transition-colors ${
            viewMode === "sessions"
              ? "text-primary border-b-2 border-primary -mb-px"
              : "text-muted-foreground hover:text-ink"
          }`}
        >
          <ChatBubbleIcon className="w-4 h-4 inline mr-1.5" />
          Sessions
        </button>
        <button
          onClick={() => setViewMode("chats")}
          className={`px-4 py-2 text-sm font-medium transition-colors ${
            viewMode === "chats"
              ? "text-primary border-b-2 border-primary -mb-px"
              : "text-muted-foreground hover:text-ink"
          }`}
        >
          <ChatBubbleIcon className="w-4 h-4 inline mr-1.5" />
          Chats
        </button>
      </div>

      {viewMode !== "chats" && (
        <div className="flex items-center justify-between gap-2 mb-6">
          <div className="flex gap-2">
            {(
              [
                ["recent", "Recent"],
                ["sessions", viewMode === "projects" ? "Sessions" : "Messages"],
                ["name", "Name"],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                onClick={() => setSortBy(key)}
                className={`px-3 py-1.5 rounded-lg text-sm transition-colors ${
                  sortBy === key
                    ? "bg-primary text-primary-foreground"
                    : "bg-card-alt text-muted-foreground hover:text-ink"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          {viewMode === "sessions" && (
            <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer">
              <Switch checked={hideEmptySessions} onCheckedChange={setHideEmptySessions} />
              <span>Hide empty</span>
            </label>
          )}
        </div>
      )}

      {viewMode === "chats" && (
        <div className="mb-6 space-y-3">
          <div className="flex gap-2">
            <div className="flex-1 relative">
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search messages..."
                className="w-full px-3 py-2 pr-8 rounded-lg bg-card border border-border text-ink placeholder:text-muted-foreground focus:outline-none focus:border-primary"
              />
              {searching && (
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">...</span>
              )}
            </div>
            <button
              onClick={handleBuildIndex}
              disabled={indexBuilding}
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-card-alt text-muted-foreground hover:text-ink border border-border transition-colors disabled:opacity-50"
              title="Rebuild search index"
            >
              <ReloadIcon className={`w-4 h-4 ${indexBuilding ? "animate-spin" : ""}`} />
              {indexBuilding ? "Building..." : "Rebuild"}
            </button>
          </div>
          {indexStatus && <p className="text-xs text-muted-foreground">{indexStatus}</p>}
          {searchQuery.trim() && searchResults !== null && (
            <p className="text-xs text-muted-foreground">
              {searchResults.length} result{searchResults.length !== 1 ? "s" : ""} found
            </p>
          )}
        </div>
      )}

      {viewMode === "projects" ? (
        <div className="space-y-3">
          {sortedProjects.map((project) => (
            <button
              key={project.id}
              onClick={() => onSelectProject(project)}
              className="w-full text-left bg-card rounded-xl p-4 border border-border hover:border-primary transition-colors"
            >
              <p className="font-medium text-ink truncate">{formatPath(project.path)}</p>
              <p className="text-sm text-muted-foreground mt-1">
                {project.session_count} session{project.session_count !== 1 ? "s" : ""} ·{" "}
                {formatRelativeTime(project.last_active)}
              </p>
            </button>
          ))}
        </div>
      ) : viewMode === "sessions" ? (
        <div className="space-y-3">
          {sortedSessions.map((session) => (
            <button
              key={`${session.project_id}-${session.id}`}
              onClick={() => onSelectSession(session)}
              className="w-full text-left bg-card rounded-xl p-4 border border-border hover:border-primary transition-colors"
            >
              <p className="font-medium text-ink line-clamp-2">{toReadable(session.summary) || "Untitled session"}</p>
              <p className="text-sm text-muted-foreground mt-1 truncate">
                {session.project_path ? formatPath(session.project_path) : session.project_id}
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                {session.message_count} messages · {formatRelativeTime(session.last_modified)}
              </p>
            </button>
          ))}
        </div>
      ) : (
        <VirtualChatList
          chats={
            searchResults !== null
              ? [...searchResults].sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
              : allChats || []
          }
          onSelectChat={onSelectChat}
          formatPath={formatPath}
          hasMore={searchResults === null && (allChats?.length || 0) < totalChats}
          loadMore={loadMoreChats}
          loadingMore={loadingMoreChats}
        />
      )}
    </div>
  );
}
