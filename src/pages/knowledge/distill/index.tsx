import { useNavigate } from "react-router-dom";
import { DistillView, KnowledgeLayout } from "../../../views/Knowledge";
import type { FeatureType } from "../../../types";
import { queryKeys, useInvokeMutation, useInvokeQuery, useQueryClient } from "../../../hooks";
import { LabLayout } from "@/views/Lab";

export default function KnowledgeDistillPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { data: watchEnabled = true } = useInvokeQuery<boolean>(
    queryKeys.distillWatchEnabled,
    "get_distill_watch_enabled",
  );
  const setWatchMutation = useInvokeMutation<void, { enabled: boolean }>(
    "set_distill_watch_enabled",
    [queryKeys.distillWatchEnabled],
  );

  const handleFeatureClick = (feature: FeatureType) => {
    if (feature === "kb-distill") navigate("/knowledge/distill");
  };

  return (
    <LabLayout active="knowledge">
      <KnowledgeLayout
        currentFeature="kb-distill"
        onFeatureClick={handleFeatureClick}
        onSourceClick={(sourceId) => navigate(`/knowledge/source/${encodeURIComponent(sourceId)}`)}
      >
        <DistillView
          onSelect={(doc) => navigate(`/knowledge/distill/${encodeURIComponent(doc.file)}`)}
          watchEnabled={watchEnabled}
          onWatchToggle={(enabled) => {
            queryClient.setQueryData(queryKeys.distillWatchEnabled, enabled);
            setWatchMutation.mutate(
              { enabled },
              {
                onError: () => {
                  queryClient.setQueryData(queryKeys.distillWatchEnabled, !enabled);
                },
              },
            );
          }}
        />
      </KnowledgeLayout>
    </LabLayout>
  );
}
