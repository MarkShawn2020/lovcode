import { useEffect, useMemo } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { DistillDetailView, KnowledgeLayout } from "../../../views/Knowledge";
import { LoadingState } from "../../../components/config";
import type { DistillDocument, FeatureType } from "../../../types";
import { queryKeys, useInvokeQuery } from "../../../hooks";
import { LabLayout } from "@/views/Lab";

export default function DistillDetailPage() {
  const navigate = useNavigate();
  const params = useParams();
  const file = params["*"] ? decodeURIComponent(params["*"]) : "";

  const {
    data: documents = [],
    isFetched,
    isLoading: loading,
  } = useInvokeQuery<DistillDocument[]>(
    queryKeys.distillDocuments,
    "list_distill_documents",
    undefined,
    { enabled: Boolean(file) },
  );
  const document = useMemo(
    () => documents.find((item) => item.file === file) ?? null,
    [documents, file],
  );

  useEffect(() => {
    if (!file) {
      navigate("/knowledge/distill");
      return;
    }

    if (isFetched && !document) {
      navigate("/knowledge/distill");
    }
  }, [document, file, isFetched, navigate]);

  const handleFeatureClick = (feature: FeatureType) => {
    if (feature === "kb-distill") navigate("/knowledge/distill");
  };
  const handleSourceClick = (sourceId: string) =>
    navigate(`/knowledge/source/${encodeURIComponent(sourceId)}`);

  const handleNavigateSession = (projectId: string, projectPath: string, sessionId: string, summary: string | null) => {
    const params = new URLSearchParams();
    params.set("projectId", projectId);
    params.set("projectPath", projectPath);
    params.set("sessionId", sessionId);
    if (summary) params.set("summary", summary);
    navigate(`/sessions?${params.toString()}`);
  };

  if (loading) {
    return (
      <LabLayout active="knowledge">
        <KnowledgeLayout currentFeature="kb-distill" onFeatureClick={handleFeatureClick} onSourceClick={handleSourceClick}>
          <LoadingState message="Loading document..." />
        </KnowledgeLayout>
      </LabLayout>
    );
  }

  if (!document) return null;

  return (
    <LabLayout active="knowledge">
      <KnowledgeLayout currentFeature="kb-distill" onFeatureClick={handleFeatureClick} onSourceClick={handleSourceClick}>
        <DistillDetailView
          document={document}
          onBack={() => navigate("/knowledge/distill")}
          onNavigateSession={handleNavigateSession}
        />
      </KnowledgeLayout>
    </LabLayout>
  );
}
