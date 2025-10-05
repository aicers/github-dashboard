import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { RepoActivityTable } from "@/components/dashboard/repo-activity-table";
import type { RepoComparisonRow } from "@/lib/dashboard/types";

function getRepositoryOrder() {
  const rows = screen.getAllByRole("row").slice(1);
  return rows.map((row) => {
    const cells = within(row).getAllByRole("cell");
    return cells[0]?.textContent?.trim() ?? "";
  });
}

describe("RepoActivityTable sorting", () => {
  const items: RepoComparisonRow[] = [
    {
      repositoryId: "repo-alpha",
      repository: {
        id: "repo-alpha",
        name: "alpha",
        nameWithOwner: "org/alpha",
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

  it("sorts rows for each metric column", async () => {
    const user = userEvent.setup();

    render(<RepoActivityTable items={items} />);

    expect(getRepositoryOrder()).toEqual([
      "org/alpha",
      "org/beta",
      "org/gamma",
    ]);

    const sortExpectations: Array<{
      label: string;
      firstOrder: string[];
      secondOrder: string[];
    }> = [
      {
        label: "이슈 해결",
        firstOrder: ["org/gamma", "org/beta", "org/alpha"],
        secondOrder: ["org/alpha", "org/beta", "org/gamma"],
      },
      {
        label: "이슈 생성",
        firstOrder: ["org/gamma", "org/alpha", "org/beta"],
        secondOrder: ["org/beta", "org/alpha", "org/gamma"],
      },
      {
        label: "PR 생성",
        firstOrder: ["org/beta", "org/alpha", "org/gamma"],
        secondOrder: ["org/gamma", "org/alpha", "org/beta"],
      },
      {
        label: "PR 머지",
        firstOrder: ["org/gamma", "org/alpha", "org/beta"],
        secondOrder: ["org/beta", "org/alpha", "org/gamma"],
      },
      {
        label: "PR 머지 수행",
        firstOrder: ["org/gamma", "org/alpha", "org/beta"],
        secondOrder: ["org/beta", "org/alpha", "org/gamma"],
      },
      {
        label: "리뷰",
        firstOrder: ["org/alpha", "org/gamma", "org/beta"],
        secondOrder: ["org/beta", "org/gamma", "org/alpha"],
      },
      {
        label: "적극 리뷰",
        firstOrder: ["org/alpha", "org/gamma", "org/beta"],
        secondOrder: ["org/beta", "org/gamma", "org/alpha"],
      },
      {
        label: "댓글",
        firstOrder: ["org/alpha", "org/beta", "org/gamma"],
        secondOrder: ["org/gamma", "org/beta", "org/alpha"],
      },
      {
        label: "평균 첫 리뷰",
        firstOrder: ["org/alpha", "org/gamma", "org/beta"],
        secondOrder: ["org/gamma", "org/alpha", "org/beta"],
      },
    ];

    for (const { label, firstOrder, secondOrder } of sortExpectations) {
      const button = screen.getByRole("button", { name: label });
      await user.click(button);
      expect(getRepositoryOrder()).toEqual(firstOrder);
      await user.click(button);
      expect(getRepositoryOrder()).toEqual(secondOrder);
    }
  });
});
