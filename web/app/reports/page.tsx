import { redirect } from "next/navigation";
import { NEWS_DEFAULT } from "@/lib/news/leagues";

/** The Report section lands on its first live sub-tab. */
export default function ReportIndexPage() {
  redirect(`/reports/${NEWS_DEFAULT}`);
}
