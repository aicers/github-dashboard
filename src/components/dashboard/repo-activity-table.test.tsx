import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import {
  REPO_ACTIVITY_SORT_DEFAULT_DIRECTION,
  type RepoActivitySortKey,
  RepoActivityTable,
  sortRepoActivityItems,
} from "@/components/dashboard/repo-activity-table";
import type { RepoComparisonRow } from "@/lib/dashboard/types";

function getRepositoryOrder() {
  const rows = screen.getAllByRole("row").slice(1);
  return rows.map((row) => {
    const cells = within(row).getAllByRole("cell");
    return cells[0]?.textContent?.trim() ?? "";
  });
}

const items: RepoComparisonRow[] = [
  {
    repositoryId: "repo-alpha",
    repository: {
      id: "repo-alpha",
      name: "alpha",
      nameWithOwner: "org/alpha",
      maintainerIds: [],
    },
    issuesCreated: 5,
    issuesResolved: 7,
    pullRequestsCreated: 6,
    pullRequestsMerged: 4,
    pullRequestsMergedBy: 3,
    reviews: 10,
    activeReviews: 8,
    comments: 12,
    avgFirstReviewHours: 2,
  },
  {
    repositoryId: "repo-beta",
    repository: {
      id: "repo-beta",
      name: "beta",
      nameWithOwner: "org/beta",
      maintainerIds: [],
    },
    issuesCreated: 3,
    issuesResolved: 5,
    pullRequestsCreated: 9,
    pullRequestsMerged: 1,
    pullRequestsMergedBy: 1,
    reviews: 2,
    activeReviews: 1,
    comments: 4,
    avgFirstReviewHours: null,
  },
  {
    repositoryId: "repo-gamma",
    repository: {
      id: "repo-gamma",
      name: "gamma",
      nameWithOwner: "org/gamma",
      maintainerIds: [],
    },
    issuesCreated: 8,
    issuesResolved: 2,
    pullRequestsCreated: 4,
    pullRequestsMerged: 7,
    pullRequestsMergedBy: 5,
    reviews: 5,
    activeReviews: 5,
    comments: 1,
    avgFirstReviewHours: 6,
  },
];

describe("sortRepoActivityItems", () => {
  const repoNameOrder = (rows: RepoComparisonRow[]) =>
    rows.map((row) => row.repository?.nameWithOwner ?? row.repositoryId);

  const expectations: Array<{
    key: RepoActivitySortKey;
    descending: string[];
    ascending: string[];
  }> = [
    {
      key: "issuesResolved",
      descending: ["org/alpha", "org/beta", "org/gamma"],
      ascending: ["org/gamma", "org/beta", "org/alpha"],
    },
    {
      key: "issuesCreated",
      descending: ["org/gamma", "org/alpha", "org/beta"],
      ascending: ["org/beta", "org/alpha", "org/gamma"],
    },
    {
      key: "pullRequestsCreated",
      descending: ["org/beta", "org/alpha", "org/gamma"],
      ascending: ["org/gamma", "org/alpha", "org/beta"],
    },
    {
      key: "pullRequestsMerged",
      descending: ["org/gamma", "org/alpha", "org/beta"],
      ascending: ["org/beta", "org/alpha", "org/gamma"],
    },
    {
      key: "pullRequestsMergedBy",
      descending: ["org/gamma", "org/alpha", "org/beta"],
      ascending: ["org/beta", "org/alpha", "org/gamma"],
    },
    {
      key: "reviews",
      descending: ["org/alpha", "org/gamma", "org/beta"],
      ascending: ["org/beta", "org/gamma", "org/alpha"],
    },
    {
      key: "activeReviews",
      descending: ["org/alpha", "org/gamma", "org/beta"],
      ascending: ["org/beta", "org/gamma", "org/alpha"],
    },
    {
      key: "comments",
      descending: ["org/alpha", "org/beta", "org/gamma"],
      ascending: ["org/gamma", "org/beta", "org/alpha"],
    },
    {
      key: "avgFirstReviewHours",
      descending: ["org/gamma", "org/alpha", "org/beta"],
      ascending: ["org/alpha", "org/gamma", "org/beta"],
    },
  ];

  it("orders repositories for each metric", () => {
    expectations.forEach(({ key, descending, ascending }) => {
      const defaultDirection = REPO_ACTIVITY_SORT_DEFAULT_DIRECTION[key];
      const initial = sortRepoActivityItems(items, {
        key,
        direction: defaultDirection,
      });
      expect(repoNameOrder(initial)).toEqual(
        defaultDirection === "desc" ? descending : ascending,
      );

      const toggled = sortRepoActivityItems(items, {
        key,
        direction: defaultDirection === "desc" ? "asc" : "desc",
      });
      expect(repoNameOrder(toggled)).toEqual(
        defaultDirection === "desc" ? ascending : descending,
      );
    });
  });
});

describe("RepoActivityTable sorting", () => {
  it("toggles ordering when column headers are clicked", () => {
    render(<RepoActivityTable items={items} />);

    expect(getRepositoryOrder()).toEqual([
      "org/alpha",
      "org/beta",
      "org/gamma",
    ]);

    const button = screen.getByRole("button", { name: "이슈 해결" });
    fireEvent.click(button);
    expect(getRepositoryOrder()).toEqual([
      "org/gamma",
      "org/beta",
      "org/alpha",
    ]);
    fireEvent.click(button);
    expect(getRepositoryOrder()).toEqual([
      "org/alpha",
      "org/beta",
      "org/gamma",
    ]);
  });
});
