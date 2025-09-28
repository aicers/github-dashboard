import { AttentionView } from "@/components/dashboard/attention-view";
import { getAttentionInsights } from "@/lib/dashboard/attention";

export const dynamic = "force-dynamic";

export default async function AttentionPage() {
  const insights = await getAttentionInsights();
  return <AttentionView insights={insights} />;
}
