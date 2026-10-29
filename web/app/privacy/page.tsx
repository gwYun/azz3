import type { Metadata } from "next";
import { PolicyPage } from "@/components/legal/PolicyPage";

export const metadata: Metadata = { title: "개인정보 처리방침 · ValueTrack" };

export default function Page() {
  return <PolicyPage id="privacy" />;
}
