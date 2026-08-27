import { redirect } from "next/navigation";
import { NEWS_DEFAULT } from "@/lib/news/leagues";

/** The News section lands on its first live sub-tab. */
export default function NewsIndexPage() {
  redirect(`/news/${NEWS_DEFAULT}`);
}
