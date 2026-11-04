"use client";

import { createContext, useContext } from "react";
import type { FeatureId } from "@/lib/features";

// The signed-in student's features (src/lib/features.ts), for client
// components deep in a page (say, an assignment row's "Break down" button)
// without passing them down through every component. AppShell provides it.
const FeaturesContext = createContext<ReadonlySet<FeatureId> | null>(null);

export function FeaturesProvider({ features, children }: { features: FeatureId[]; children: React.ReactNode }) {
  return <FeaturesContext.Provider value={new Set(features)}>{children}</FeaturesContext.Provider>;
}

/** Whether the student has this feature on. Outside AppShell (no provider), everything is on. */
export function useFeature(id: FeatureId): boolean {
  const features = useContext(FeaturesContext);
  return features ? features.has(id) : true;
}
