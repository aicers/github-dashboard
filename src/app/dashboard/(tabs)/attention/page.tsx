import { AttentionView } from "@/components/dashboard/attention-view";
import { readActiveSession } from "@/lib/auth/session";
import { getAttentionInsights } from "@/lib/dashboard/attention";

export const dynamic = "force-dynamic";

export default async function AttentionPage() {
  const session = await readActiveSession();
  const insights = await getAttentionInsights({
    userId: session?.userId ?? null,
  });
  return (
    <AttentionView insights={insights} isAdmin={session?.isAdmin ?? false} />
  );
}
