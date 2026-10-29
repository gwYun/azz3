import type { Metadata } from "next";
import { PolicyPage } from "@/components/legal/PolicyPage";

export const metadata: Metadata = { title: "서비스 이용약관 · ValueTrack" };

export default function Page() {
  return <PolicyPage id="terms" />;
}
