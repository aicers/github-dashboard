import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { AttentionView } from "@/components/dashboard/attention-view";
import type {
  AttentionInsights,
  PullRequestAttentionItem,
  RepositoryReference,
  UserReference,
} from "@/lib/dashboard/attention";

const refreshMock = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    refresh: refreshMock,
  }),
}));

function buildUser(id: string, name: string, login: string): UserReference {
  return {
    id,
    name,
    login,
  } satisfies UserReference;
}

function buildRepository(
  id: string,
  name: string,
  nameWithOwner: string,
): RepositoryReference {
  return {
    id,
    name,
    nameWithOwner,
  } satisfies RepositoryReference;
}

function buildPullRequestItem(params: {
  id: string;
  number: number;
  title: string;
  url: string;
  repository: RepositoryReference;
  author: UserReference;
  reviewers: UserReference[];
  createdAt: string;
  updatedAt: string | null;
  ageDays: number;
  inactivityDays: number;
  waitingDays: number;
}): PullRequestAttentionItem {
  const {
    id,
    number,
    title,
    url,
    repository,
    author,
    reviewers,
    createdAt,
    updatedAt,
    ageDays,
    inactivityDays,
    waitingDays,
  } = params;

  return {
    id,
    number,
    title,
    url,
    repository,
    author,
    reviewers,
    linkedIssues: [],
    createdAt,
    updatedAt,
    ageDays,
    inactivityDays,
    waitingDays,
  } satisfies PullRequestAttentionItem;
}

describe("AttentionView reviewer-unassigned pull requests", () => {
  beforeEach(() => {
    refreshMock.mockReset();
  });

  it("shows reviewer-unassigned PR overview, waiting chips, filters, and refresh control", async () => {
    const user = userEvent.setup();

    const alice = buildUser("user-alice", "Alice", "alice");
    const bob = buildUser("user-bob", "Bob", "bob");
    const maintainerAlpha = buildUser(
      "user-maintainer-alpha",
      "Maintainer Alpha",
      "maintainer-alpha",
    );
    const maintainerBeta = buildUser(
      "user-maintainer-beta",
      "Maintainer Beta",
      "maintainer-beta",
    );

    const repoAlpha = buildRepository(
      "repo-alpha",
      "repo-alpha",
      "acme/repo-alpha",
    );
    const repoBeta = buildRepository(
      "repo-beta",
      "repo-beta",
      "acme/repo-beta",
    );

    const unassignedItems: PullRequestAttentionItem[] = [
      buildPullRequestItem({
        id: "pr-201",
        number: 201,
        title: "Improve notification batching",
        url: "https://github.com/acme/repo-alpha/pull/201",
        repository: repoAlpha,
        author: alice,
        reviewers: [],
        createdAt: "2023-12-01T00:00:00.000Z",
        updatedAt: "2024-02-01T10:00:00.000Z",
        ageDays: 40,
        inactivityDays: 15,
        waitingDays: 3,
      }),
      buildPullRequestItem({
        id: "pr-202",
        number: 202,
        title: "Refactor dashboard widgets",
        url: "https://github.com/acme/repo-beta/pull/202",
        repository: repoBeta,
        author: bob,
        reviewers: [],
        createdAt: "2024-01-12T00:00:00.000Z",
        updatedAt: "2024-02-05T08:00:00.000Z",
        ageDays: 25,
        inactivityDays: 12,
        waitingDays: 4,
      }),
    ];

    const insights: AttentionInsights = {
      generatedAt: "2024-02-20T00:00:00.000Z",
      timezone: "Asia/Seoul",
      dateTimeFormat: "auto",
      reviewerUnassignedPrs: unassignedItems,
      reviewStalledPrs: [],
      mergeDelayedPrs: [],
      stuckReviewRequests: [],
      backlogIssues: [],
      stalledInProgressIssues: [],
      unansweredMentions: [],
      repositoryMaintainersByRepository: {
        [repoAlpha.id]: [maintainerAlpha],
        [repoBeta.id]: [maintainerBeta],
      },
    } satisfies AttentionInsights;

    render(<AttentionView insights={insights} />);

    expect(
      screen.getByText("최다 작성자: 1위 Bob, 2위 Alice"),
    ).toBeInTheDocument();

    const unassignedButton = screen.getByRole("button", {
      name: /리뷰어 미지정 PR/,
    });
    await user.click(unassignedButton);

    expect(
      screen.getByText("2 업무일 이상 리뷰어 미지정 PR"),
    ).toBeInTheDocument();

    const firstItem = screen
      .getByText("Improve notification batching")
      .closest("li");
    const secondItem = screen
      .getByText("Refactor dashboard widgets")
      .closest("li");

    if (!firstItem || !secondItem) {
      throw new Error(
        "Expected reviewer-unassigned PR list items to be rendered",
      );
    }

    expect(within(firstItem).getByText("Age 3일")).toBeInTheDocument();
    expect(within(firstItem).getByText("Idle -")).toBeInTheDocument();
    expect(within(secondItem).getByText("Age 4일")).toBeInTheDocument();
    expect(within(secondItem).getByText("Idle -")).toBeInTheDocument();

    expect(
      screen.getByText("저장소 책임자 기준 경과일수 합계 순위"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("작성자 기준 경과일수 합계 순위"),
    ).toBeInTheDocument();

    const maintainerFilter = screen.getByLabelText("저장소 책임자 필터");
    await user.selectOptions(maintainerFilter, "user-maintainer-alpha");

    expect(
      screen.queryByText("Refactor dashboard widgets"),
    ).not.toBeInTheDocument();
    expect(
      screen.getByText("Improve notification batching"),
    ).toBeInTheDocument();

    await user.selectOptions(maintainerFilter, "all");

    const authorFilter = screen.getByLabelText("작성자 필터");
    await user.selectOptions(authorFilter, "user-bob");

    expect(screen.getByText("Refactor dashboard widgets")).toBeInTheDocument();
    expect(
      screen.queryByText("Improve notification batching"),
    ).not.toBeInTheDocument();

    await user.selectOptions(authorFilter, "all");

    const refreshButton = screen.getByRole("button", {
      name: "Follow-ups 통계 새로 고침",
    });
    await user.click(refreshButton);

    await waitFor(() => {
      expect(refreshMock).toHaveBeenCalledTimes(1);
    });
  });

  it("renders reviewer-unassigned PR empty state without reviewer filters", async () => {
    const user = userEvent.setup();
    const emptyInsights: AttentionInsights = {
      generatedAt: "2024-02-20T00:00:00.000Z",
      timezone: "UTC",
      dateTimeFormat: "auto",
      reviewerUnassignedPrs: [],
      reviewStalledPrs: [],
      mergeDelayedPrs: [],
      stuckReviewRequests: [],
      backlogIssues: [],
      stalledInProgressIssues: [],
      unansweredMentions: [],
      repositoryMaintainersByRepository: {},
    } satisfies AttentionInsights;

    render(<AttentionView insights={emptyInsights} />);

    const unassignedButton = screen.getByRole("button", {
      name: /리뷰어 미지정 PR/,
    });
    await user.click(unassignedButton);

    expect(
      screen.getByText("현재 조건을 만족하는 PR이 없습니다."),
    ).toBeInTheDocument();
    expect(
      screen.getByText("저장소 책임자 기준 경과일수 합계 순위"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("작성자 기준 경과일수 합계 순위"),
    ).toBeInTheDocument();
    expect(
      screen.getAllByText("저장소 책임자 데이터가 없습니다.").length,
    ).toBeGreaterThan(0);
    expect(
      screen.getAllByText("작성자 데이터가 없습니다.").length,
    ).toBeGreaterThan(0);
    expect(screen.getByLabelText("저장소 책임자 필터")).toBeInTheDocument();
    expect(screen.getByLabelText("작성자 필터")).toBeInTheDocument();
    expect(screen.queryByLabelText("리뷰어 필터")).not.toBeInTheDocument();
  });
});
