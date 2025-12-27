import { useState, useEffect, useMemo, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useInvokeQuery } from "../../hooks";
import { BookmarkIcon, ChevronDownIcon } from "@radix-ui/react-icons";
import { useAtom } from "jotai";
import { referenceCollapsedGroupsAtom, referenceExpandedSourceAtom } from "../../store";
import { LoadingState, EmptyState, ConfigPage } from "../../components/config";
import { DocumentReader } from "../../components/DocumentReader";

interface ReferenceSource {
  name: string;
  path: string;
  doc_count: number;
}

interface ReferenceDoc {
  name: string;
  path: string;
  group: string | null;
}

function ReferenceDocTree({
  docs,
  sourceName,
  onDocClick,
}: {
  docs: ReferenceDoc[];
  sourceName: string;
  onDocClick: (source: string, doc: ReferenceDoc, index: number) => void;
}) {
  const [allCollapsed, setAllCollapsed] = useAtom(referenceCollapsedGroupsAtom);
  const collapsedGroups = useMemo(
    () => new Set(allCollapsed[sourceName] ?? []),
    [allCollapsed, sourceName]
  );
  const setCollapsedGroups = useCallback(
    (updater: (prev: Set<string>) => Set<string>) => {
      setAllCollapsed((prev) => ({
        ...prev,
        [sourceName]: Array.from(updater(new Set(prev[sourceName] ?? []))),
      }));
    },
    [sourceName, setAllCollapsed]
  );

  // Group docs by their group field
  const grouped = useMemo(() => {
    const groups: { name: string | null; docs: { doc: ReferenceDoc; index: number }[] }[] = [];
    let currentGroup: string | null = null;
    let currentDocs: { doc: ReferenceDoc; index: number }[] = [];

    docs.forEach((doc, index) => {
      if (doc.group !== currentGroup) {
        if (currentDocs.length > 0) {
          groups.push({ name: currentGroup, docs: currentDocs });
        }
        currentGroup = doc.group;
        currentDocs = [];
      }
      currentDocs.push({ doc, index });
    });

    if (currentDocs.length > 0) {
      groups.push({ name: currentGroup, docs: currentDocs });
    }

    return groups;
  }, [docs]);

  const toggleGroup = (groupName: string) => {
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(groupName)) {
        next.delete(groupName);
      } else {
        next.add(groupName);
      }
      return next;
    });
  };

  return (
    <div className="space-y-1">
      {grouped.map((group, groupIdx) => (
        <div key={group.name ?? `ungrouped-${groupIdx}`}>
          {group.name && (
            <button
              onClick={() => toggleGroup(group.name!)}
              className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-muted-foreground hover:text-ink transition-colors"
            >
              <ChevronDownIcon
                className={`w-3 h-3 transition-transform ${collapsedGroups.has(group.name) ? "-rotate-90" : ""}`}
              />
              <span className="font-medium">{group.name}</span>
              <span className="text-muted-foreground/60">({group.docs.length})</span>
            </button>
          )}
          {!collapsedGroups.has(group.name ?? "") && (
            <div className={group.name ? "ml-3" : ""}>
              {group.docs.map(({ doc, index }) => (
                <button
                  key={doc.path}
                  onClick={() => onDocClick(sourceName, doc, index)}
                  className="w-full flex items-center gap-2 px-4 py-1.5 rounded-lg text-left text-sm hover:bg-card-alt transition-colors"
                >
                  <span className="text-muted-foreground text-xs">📄</span>
                  <span className="truncate">{doc.name}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

interface ReferenceViewProps {
  initialSource?: string;
  initialDocIndex?: number;
  onDocOpen: (source: string, docIndex: number) => void;
  onDocClose: () => void;
}

export function ReferenceView({
  initialSource,
  initialDocIndex,
  onDocOpen,
  onDocClose,
}: ReferenceViewProps) {
  const { data: sources = [], isLoading: loading } = useInvokeQuery<ReferenceSource[]>(["referenceSources"], "list_reference_sources");
  const [persistedSource, setPersistedSource] = useAtom(referenceExpandedSourceAtom);
  const [expandedSource, setExpandedSource] = useState<string | null>(
    initialSource ?? persistedSource
  );

  // Sync to persisted state when expandedSource changes
  useEffect(() => {
    if (expandedSource !== persistedSource) {
      setPersistedSource(expandedSource);
    }
  }, [expandedSource, persistedSource, setPersistedSource]);

  const [docs, setDocs] = useState<ReferenceDoc[]>([]);
  const [docsLoading, setDocsLoading] = useState(false);
  const [docContent, setDocContent] = useState<string>("");
  const [docLoading, setDocLoading] = useState(false);

  const isDocView = initialSource !== undefined && initialDocIndex !== undefined;

  // Load docs when source is expanded or when initial source is provided
  useEffect(() => {
    if (!expandedSource) return;
    setDocsLoading(true);
    invoke<ReferenceDoc[]>("list_reference_docs", { source: expandedSource })
      .then(setDocs)
      .finally(() => setDocsLoading(false));
  }, [expandedSource]);

  // Load doc content when in doc view
  useEffect(() => {
    if (!isDocView || docs.length === 0) return;
    const doc = docs[initialDocIndex];
    if (!doc) return;
    setDocLoading(true);
    invoke<string>("read_file", { path: doc.path })
      .then(setDocContent)
      .finally(() => setDocLoading(false));
  }, [isDocView, initialDocIndex, docs]);

  const handleSourceClick = (source: ReferenceSource) => {
    if (expandedSource === source.name) {
      setExpandedSource(null);
      setDocs([]);
      return;
    }
    setExpandedSource(source.name);
  };

  const handleDocClick = (source: string, _doc: ReferenceDoc, index: number) => {
    onDocOpen(source, index);
  };

  const handleNavigate = async (index: number) => {
    if (!initialSource) return;
    // Save scroll position before navigating
    const scrollKey = `lovcode:ref-scroll:${initialSource}:${initialDocIndex}`;
    const scrollContainer = document.querySelector("[data-ref-scroll]");
    if (scrollContainer) {
      localStorage.setItem(scrollKey, String(scrollContainer.scrollTop));
    }
    onDocOpen(initialSource, index);
  };

  if (loading) return <LoadingState message="Loading reference sources..." />;

  if (isDocView && docs.length > 0) {
    return (
      <DocumentReader
        documents={docs}
        currentIndex={initialDocIndex}
        content={docContent}
        loading={docLoading}
        sourceName={initialSource}
        onNavigate={handleNavigate}
        onBack={onDocClose}
      />
    );
  }

  return (
    <ConfigPage>
      <div className="space-y-2">
        {sources.length > 0 ? (
          sources.map((source) => (
            <div key={source.name}>
              <button
                onClick={() => handleSourceClick(source)}
                className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl text-left transition-colors ${
                  expandedSource === source.name
                    ? "bg-primary/10 text-primary"
                    : "bg-card hover:bg-card-alt"
                }`}
              >
                <BookmarkIcon className="w-5 h-5" />
                <div className="flex-1 min-w-0">
                  <div className="font-medium text-sm">{source.name}</div>
                  <div className="text-xs text-muted-foreground">{source.doc_count} docs</div>
                </div>
                <ChevronDownIcon
                  className={`w-4 h-4 transition-transform ${expandedSource === source.name ? "rotate-180" : ""}`}
                />
              </button>
              {expandedSource === source.name && (
                <div className="ml-4 mt-1 space-y-1">
                  {docsLoading ? (
                    <div className="px-4 py-2 text-sm text-muted-foreground">Loading...</div>
                  ) : docs.length > 0 ? (
                    <ReferenceDocTree
                      docs={docs}
                      sourceName={source.name}
                      onDocClick={handleDocClick}
                    />
                  ) : (
                    <div className="px-4 py-2 text-sm text-muted-foreground">No documents</div>
                  )}
                </div>
              )}
            </div>
          ))
        ) : (
          <EmptyState
            icon={BookmarkIcon}
            message="No reference sources"
            hint="Add documentation symlinks to ~/.lovstudio/docs/reference/"
          />
        )}
      </div>
    </ConfigPage>
  );
}
