import { Suspense } from "react";
import { CreditsView } from "@/components/CreditsView";

// CreditsView reads the ?pay= notice via useSearchParams — wrap in Suspense so
// it doesn't de-opt the rest of the app's static rendering.
export default function CreditsPage() {
  return (
    <Suspense fallback={null}>
      <CreditsView />
    </Suspense>
  );
}
