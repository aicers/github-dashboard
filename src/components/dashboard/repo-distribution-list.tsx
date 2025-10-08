import { formatNumber } from "@/lib/dashboard/metric-formatters";
import type { RepoDistributionItem } from "@/lib/dashboard/types";

type RepoDistributionListProps = {
  items: RepoDistributionItem[];
  limit?: number;
};

export function RepoDistributionList({
  items,
  limit = items.length,
}: RepoDistributionListProps) {
  const sliced = items.slice(0, limit);
  const total = sliced.reduce((acc, item) => acc + item.totalEvents, 0);

  return (
    <div className="space-y-3">
      {sliced.map((item) => {
        const share = total > 0 ? (item.totalEvents / total) * 100 : 0;
        return (
          <div key={item.repositoryId} className="space-y-1">
            <div className="flex justify-between gap-2 text-sm font-medium">
              <span>{item.repository?.nameWithOwner ?? item.repositoryId}</span>
              <span>{formatNumber(item.totalEvents)}</span>
            </div>
            <div className="h-2 rounded-full bg-muted">
              <div
                className="h-2 rounded-full bg-primary"
                style={{ width: `${share.toFixed(1)}%` }}
              />
            </div>
            <p className="text-xs text-muted-foreground">
              이슈 {formatNumber(item.issues)} • PR{" "}
              {formatNumber(item.pullRequests)} • 리뷰{" "}
              {formatNumber(item.reviews)} • 댓글 {formatNumber(item.comments)}
            </p>
          </div>
        );
      })}
      {sliced.length === 0 && (
        <p className="text-sm text-muted-foreground">데이터가 없습니다.</p>
      )}
    </div>
  );
}
