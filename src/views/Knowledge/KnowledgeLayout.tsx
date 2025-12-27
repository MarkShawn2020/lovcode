import type { ReactNode } from "react";
import { KnowledgeSidebar } from "./KnowledgeSidebar";
import type { FeatureType } from "@/types";

interface KnowledgeLayoutProps {
  children: ReactNode;
  currentFeature: FeatureType | null;
  onFeatureClick: (feature: FeatureType) => void;
}

export function KnowledgeLayout({ children, currentFeature, onFeatureClick }: KnowledgeLayoutProps) {
  return (
    <div className="flex h-full">
      <KnowledgeSidebar currentFeature={currentFeature} onFeatureClick={onFeatureClick} />
      <main className="flex-1 overflow-auto">
        {children}
      </main>
    </div>
  );
}
