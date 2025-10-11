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
  } = params;

  return {
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
  } satisfies PullRequestAttentionItem;
}

describe("AttentionView idle pull requests", () => {
  beforeEach(() => {
    refreshMock.mockReset();
  });

  it("shows idle PR overview, inactivity chips, filters, and refresh control", async () => {
    const user = userEvent.setup();

    const alice = buildUser("user-alice", "Alice", "alice");
    const bob = buildUser("user-bob", "Bob", "bob");
    const carol = buildUser("user-carol", "Carol", "carol");

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

    const idleItems: PullRequestAttentionItem[] = [
      buildPullRequestItem({
        id: "pr-201",
        number: 201,
        title: "Improve notification batching",
        url: "https://github.com/acme/repo-alpha/pull/201",
        repository: repoAlpha,
        author: alice,
        reviewers: [bob],
        createdAt: "2023-12-01T00:00:00.000Z",
        updatedAt: "2024-02-01T10:00:00.000Z",
        ageDays: 40,
        inactivityDays: 15,
      }),
      buildPullRequestItem({
        id: "pr-202",
        number: 202,
        title: "Refactor dashboard widgets",
        url: "https://github.com/acme/repo-beta/pull/202",
        repository: repoBeta,
        author: bob,
        reviewers: [carol],
        createdAt: "2024-01-12T00:00:00.000Z",
        updatedAt: "2024-02-05T08:00:00.000Z",
        ageDays: 25,
        inactivityDays: 12,
      }),
    ];

    const insights: AttentionInsights = {
      generatedAt: "2024-02-20T00:00:00.000Z",
      timezone: "Asia/Seoul",
      staleOpenPrs: [],
      idleOpenPrs: idleItems,
      stuckReviewRequests: [],
      backlogIssues: [],
      stalledInProgressIssues: [],
      unansweredMentions: [],
    } satisfies AttentionInsights;

    render(<AttentionView insights={insights} />);

    expect(
      screen.getByRole("heading", { name: "Follow-ups" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText("최다 생성자: 1위 Alice, 2위 Bob"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("최다 리뷰어: 1위 Bob, 2위 Carol"),
    ).toBeInTheDocument();

    const idleButton = screen.getByRole("button", { name: /업데이트 없는 PR/ });
    await user.click(idleButton);

    expect(
      screen.getByText(
        "10일 이상 (주말과 공휴일 제외) 업데이트가 없는 열린 PR",
      ),
    ).toBeInTheDocument();

    const firstItem = screen
      .getByText("Improve notification batching")
      .closest("li");
    const secondItem = screen
      .getByText("Refactor dashboard widgets")
      .closest("li");

    if (!firstItem || !secondItem) {
      throw new Error("Expected idle PR list items to be rendered");
    }

    expect(within(firstItem).getByText("Age 40일")).toBeInTheDocument();
    expect(within(firstItem).getByText("Idle 15일")).toBeInTheDocument();
    expect(within(secondItem).getByText("Age 25일")).toBeInTheDocument();
    expect(within(secondItem).getByText("Idle 12일")).toBeInTheDocument();

    expect(
      screen.getByText("생성자 미업데이트 경과일수 합계 순위"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("리뷰어 미업데이트 경과일수 합계 순위"),
    ).toBeInTheDocument();

    const authorFilter = screen.getByLabelText("생성자 필터");
    await user.selectOptions(authorFilter, "user-bob");

    expect(screen.getByText("Refactor dashboard widgets")).toBeInTheDocument();
    expect(
      screen.queryByText("Improve notification batching"),
    ).not.toBeInTheDocument();

    await user.selectOptions(authorFilter, "all");

    const reviewerFilter = screen.getByLabelText("리뷰어 필터");
    await user.selectOptions(reviewerFilter, "user-bob");

    expect(
      screen.getByText("Improve notification batching"),
    ).toBeInTheDocument();
    expect(
      screen.queryByText("Refactor dashboard widgets"),
    ).not.toBeInTheDocument();

    await user.selectOptions(reviewerFilter, "all");

    const refreshButton = screen.getByRole("button", {
      name: "Follow-ups 통계 새로 고침",
    });
    await user.click(refreshButton);

    await waitFor(() => {
      expect(refreshMock).toHaveBeenCalledTimes(1);
    });
  });

  it("renders idle PR empty state without rankings or filters", async () => {
    const user = userEvent.setup();
    const emptyInsights: AttentionInsights = {
      generatedAt: "2024-02-20T00:00:00.000Z",
      timezone: "UTC",
      staleOpenPrs: [],
      idleOpenPrs: [],
      stuckReviewRequests: [],
      backlogIssues: [],
      stalledInProgressIssues: [],
      unansweredMentions: [],
    } satisfies AttentionInsights;

    render(<AttentionView insights={emptyInsights} />);

    const idleButton = screen.getByRole("button", { name: /업데이트 없는 PR/ });
    await user.click(idleButton);

    expect(
      screen.getByText("현재 조건을 만족하는 PR이 없습니다."),
    ).toBeInTheDocument();
    expect(
      screen.queryByText("생성자 미업데이트 경과일수 합계 순위"),
    ).not.toBeInTheDocument();
    expect(screen.queryByLabelText("생성자 필터")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("리뷰어 필터")).not.toBeInTheDocument();
  });
});
