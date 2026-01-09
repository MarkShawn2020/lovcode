import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { DistillDocument, Session } from "../../types";
import { useAppConfig } from "../../context";
import {
  LoadingState,
  DetailHeader,
  DetailCard,
  ContentCard,
  ConfigPage,
} from "../../components/config";

interface DistillDetailViewProps {
  document: DistillDocument;
  onBack: () => void;
  onNavigateSession: (projectId: string, projectPath: string, sessionId: string, summary: string | null) => void;
}

export function DistillDetailView({
  document,
  onBack,
  onNavigateSession,
}: DistillDetailViewProps) {
  const { homeDir } = useAppConfig();
  const [content, setContent] = useState<string>("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const path = `${homeDir}/.lovstudio/docs/distill/${document.file}`;
    invoke<string>("read_file", { path })
      .then(setContent)
      .finally(() => setLoading(false));
  }, [document.file, homeDir]);

  const handleNavigateSession = async () => {
    if (!document.session) return;
    const session = await invoke<Session | null>("find_session_project", {
      sessionId: document.session,
    });
    if (session) {
      onNavigateSession(session.project_id, session.project_path || '', session.id, session.summary);
    }
  };

  if (loading) return <LoadingState message="Loading document..." />;

  const distillPath = `~/.lovstudio/docs/distill/${document.file}`;

  return (
    <ConfigPage>
      <DetailHeader
        title={document.title}
        description={document.tags.map((t) => `#${t}`).join(" · ")}
        backLabel="Distill"
        onBack={onBack}
        path={distillPath}
        onOpenPath={(p) => invoke("open_in_editor", { path: p.replace("~", homeDir) })}
        onNavigateSession={handleNavigateSession}
      />
      <div className="space-y-4">
        <DetailCard label="Metadata">
          <div className="space-y-2 text-sm">
            <p className="text-muted-foreground">
              Date: <span className="text-ink">{document.date}</span>
            </p>
            {document.session ? (
              <p className="text-muted-foreground">
                Session:{" "}
                <button
                  onClick={handleNavigateSession}
                  className="font-mono text-xs text-primary hover:underline"
                >
                  {document.session.slice(0, 8)}...
                </button>
              </p>
            ) : (
              <p className="text-muted-foreground">
                Session: <span className="text-xs text-muted-foreground italic">N/A</span>
              </p>
            )}
          </div>
        </DetailCard>
        <ContentCard label="Content" content={content} />
      </div>
    </ConfigPage>
  );
}
