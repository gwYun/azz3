import { Suspense } from "react";
import { PremiumView } from "@/components/PremiumView";

// PremiumView reads the ?pay= notice via useSearchParams — wrap in Suspense so
// it doesn't de-opt the rest of the app's static rendering.
export default function PremiumPage() {
  return (
    <Suspense fallback={null}>
      <PremiumView />
    </Suspense>
  );
}
