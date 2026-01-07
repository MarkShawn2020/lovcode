import { useNavigate } from "react-router-dom";
import { ReferenceView, KnowledgeLayout } from "../../views/Knowledge";
import type { FeatureType } from "../../types";

export default function KnowledgeReferencePage() {
  const navigate = useNavigate();

  const handleFeatureClick = (feature: FeatureType) => {
    if (feature === "kb-distill") navigate("/knowledge/distill");
    else if (feature === "kb-reference") navigate("/knowledge/reference");
  };

  return (
    <KnowledgeLayout currentFeature="kb-reference" onFeatureClick={handleFeatureClick}>
      <ReferenceView
        onDocOpen={(source) => navigate(`/knowledge/reference/${encodeURIComponent(source)}`)}
        onDocClose={() => navigate("/knowledge/reference")}
      />
    </KnowledgeLayout>
  );
}
