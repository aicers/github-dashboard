"use client";

import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";
import { useMemo, useState } from "react";
import {
  formatDuration,
  formatNumber,
} from "@/components/dashboard/metric-utils";
import type { RepoComparisonRow } from "@/lib/dashboard/types";

type RepoActivitySortKey =
  | "issuesCreated"
  | "issuesResolved"
  | "pullRequestsCreated"
  | "pullRequestsMerged"
  | "pullRequestsMergedBy"
  | "reviews"
  | "comments"
  | "avgFirstReviewHours";
type RepoActivitySortDirection = "asc" | "desc";

type RepoActivityTableProps = {
  items: RepoComparisonRow[];
};

const repoActivityColumns: Array<{
  key: RepoActivitySortKey;
  label: string;
  render: (row: RepoComparisonRow) => string;
}> = [
  {
    key: "issuesCreated",
    label: "이슈 생성",
    render: (row) => formatNumber(row.issuesCreated),
  },
  {
    key: "issuesResolved",
    label: "이슈 해결",
    render: (row) => formatNumber(row.issuesResolved),
  },
  {
    key: "pullRequestsCreated",
    label: "PR 생성",
    render: (row) => formatNumber(row.pullRequestsCreated),
  },
  {
    key: "pullRequestsMerged",
    label: "PR 머지",
    render: (row) => formatNumber(row.pullRequestsMerged),
  },
  {
    key: "pullRequestsMergedBy",
    label: "PR 머지 수행",
    render: (row) => formatNumber(row.pullRequestsMergedBy),
  },
  {
    key: "reviews",
    label: "리뷰",
    render: (row) => formatNumber(row.reviews),
  },
  {
    key: "comments",
    label: "댓글",
    render: (row) => formatNumber(row.comments),
  },
  {
    key: "avgFirstReviewHours",
    label: "평균 첫 리뷰",
    render: (row) =>
      row.avgFirstReviewHours == null
        ? "–"
        : formatDuration(row.avgFirstReviewHours, "hours"),
  },
];

const REPO_ACTIVITY_SORT_DEFAULT_DIRECTION: Record<
  RepoActivitySortKey,
  RepoActivitySortDirection
> = {
  issuesCreated: "desc",
  issuesResolved: "desc",
  pullRequestsCreated: "desc",
  pullRequestsMerged: "desc",
  pullRequestsMergedBy: "desc",
  reviews: "desc",
  comments: "desc",
  avgFirstReviewHours: "asc",
};

function getSortValue(
  row: RepoComparisonRow,
  key: RepoActivitySortKey,
): number | null {
  switch (key) {
    case "issuesCreated":
      return row.issuesCreated;
    case "issuesResolved":
      return row.issuesResolved;
    case "pullRequestsCreated":
      return row.pullRequestsCreated;
    case "pullRequestsMerged":
      return row.pullRequestsMerged;
    case "pullRequestsMergedBy":
      return row.pullRequestsMergedBy;
    case "reviews":
      return row.reviews;
    case "comments":
      return row.comments;
    case "avgFirstReviewHours":
      return row.avgFirstReviewHours;
    default:
      return null;
  }
}

export function RepoActivityTable({ items }: RepoActivityTableProps) {
  const [sort, setSort] = useState<{
    key: RepoActivitySortKey;
    direction: RepoActivitySortDirection;
  }>(() => ({
    key: "issuesResolved",
    direction: REPO_ACTIVITY_SORT_DEFAULT_DIRECTION.issuesResolved,
  }));

  const sortedItems = useMemo(() => {
    if (!items.length) {
      return [];
    }

    const { key, direction } = sort;

    return [...items].sort((first, second) => {
      const valueA = getSortValue(first, key);
      const valueB = getSortValue(second, key);

      if (valueA == null && valueB == null) {
        const nameA = first.repository?.nameWithOwner ?? first.repositoryId;
        const nameB = second.repository?.nameWithOwner ?? second.repositoryId;
        return nameA.localeCompare(nameB);
      }

      if (valueA == null) {
        return 1;
      }

      if (valueB == null) {
        return -1;
      }

      if (valueA === valueB) {
        const nameA = first.repository?.nameWithOwner ?? first.repositoryId;
        const nameB = second.repository?.nameWithOwner ?? second.repositoryId;
        return nameA.localeCompare(nameB);
      }

      return direction === "asc" ? valueA - valueB : valueB - valueA;
    });
  }, [items, sort]);

  const toggleSort = (key: RepoActivitySortKey) => {
    setSort((previous) => {
      if (previous.key === key) {
        return {
          key,
          direction: previous.direction === "asc" ? "desc" : "asc",
        };
      }

      return {
        key,
        direction: REPO_ACTIVITY_SORT_DEFAULT_DIRECTION[key],
      };
    });
  };

  const getAriaSort = (
    key: RepoActivitySortKey,
  ): "ascending" | "descending" | "none" => {
    if (sort.key !== key) {
      return "none";
    }

    return sort.direction === "asc" ? "ascending" : "descending";
  };

  const renderSortIcon = (key: RepoActivitySortKey) => {
    if (sort.key !== key) {
      return <ArrowUpDown className="h-3 w-3" aria-hidden="true" />;
    }

    return sort.direction === "asc" ? (
      <ArrowUp className="h-3 w-3" aria-hidden="true" />
    ) : (
      <ArrowDown className="h-3 w-3" aria-hidden="true" />
    );
  };

  if (!items.length) {
    return <p className="text-sm text-muted-foreground">데이터가 없습니다.</p>;
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[1100px] text-sm">
        <thead className="text-left text-xs uppercase text-muted-foreground">
          <tr>
            <th className="pb-3" scope="col">
              리포지토리
            </th>
            {repoActivityColumns.map((column) => (
              <th
                key={column.key}
                className="pb-3 text-right"
                aria-sort={getAriaSort(column.key)}
                scope="col"
              >
                <button
                  type="button"
                  onClick={() => toggleSort(column.key)}
                  className="flex w-full items-center justify-end gap-1 whitespace-nowrap text-muted-foreground transition-colors hover:text-foreground focus-visible:text-foreground"
                >
                  <span>{column.label}</span>
                  {renderSortIcon(column.key)}
                </button>
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-border/40">
          {sortedItems.map((row) => (
            <tr key={row.repositoryId} className="h-14">
              <td className="pr-4">
                {row.repository?.nameWithOwner ?? row.repositoryId}
              </td>
              {repoActivityColumns.map((column) => (
                <td key={column.key} className="text-right">
                  {column.render(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
