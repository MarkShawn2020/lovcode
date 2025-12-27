import type { ReactNode } from "react";
import { FeaturesSidebar } from "./FeaturesSidebar";
import type { FeatureType } from "@/types";

interface FeaturesLayoutProps {
  children: ReactNode;
  currentFeature: FeatureType | null;
  onFeatureClick: (feature: FeatureType) => void;
}

export function FeaturesLayout({ children, currentFeature, onFeatureClick }: FeaturesLayoutProps) {
  return (
    <div className="flex h-full">
      <FeaturesSidebar currentFeature={currentFeature} onFeatureClick={onFeatureClick} />
      <main className="flex-1 overflow-auto">
        {children}
      </main>
    </div>
  );
}
