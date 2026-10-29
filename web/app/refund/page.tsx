import type { Metadata } from "next";
import { PolicyPage } from "@/components/legal/PolicyPage";

export const metadata: Metadata = { title: "환불 및 취소 규정 · ValueTrack" };

export default function Page() {
  return <PolicyPage id="refund" />;
}
