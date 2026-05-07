import type { ReactNode } from "react";
import { SidebarLayout } from "@/components/shared";
import { KnowledgeSidebar } from "./KnowledgeSidebar";
import type { FeatureType } from "@/types";

interface KnowledgeLayoutProps {
  children: ReactNode;
  currentFeature: FeatureType | null;
  currentSourceId?: string | null;
  onFeatureClick: (feature: FeatureType) => void;
  onSourceClick?: (sourceId: string) => void;
}

export function KnowledgeLayout({
  children,
  currentFeature,
  currentSourceId,
  onFeatureClick,
  onSourceClick,
}: KnowledgeLayoutProps) {
  return (
    <SidebarLayout
      sidebar={
        <KnowledgeSidebar
          currentFeature={currentFeature}
          currentSourceId={currentSourceId}
          onFeatureClick={onFeatureClick}
          onSourceClick={onSourceClick}
        />
      }
    >
      {children}
    </SidebarLayout>
  );
}
