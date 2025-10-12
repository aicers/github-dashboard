import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { AttentionView } from "@/components/dashboard/attention-view";
import type {
  AttentionInsights,
  MentionAttentionItem,
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

function buildMentionItem(params: {
  commentId: string;
  url: string;
  mentionedAt: string;
  waitingDays: number;
  author: UserReference;
  target: UserReference;
  container: {
    type: "issue" | "pull_request" | "discussion";
    id: string;
    number: number;
    title: string;
    url: string;
    repository: RepositoryReference;
  };
  commentExcerpt: string;
}): MentionAttentionItem {
  const {
    commentId,
    url,
    mentionedAt,
    waitingDays,
    author,
    target,
    container,
    commentExcerpt,
  } = params;

  return {
    commentId,
    url,
    mentionedAt,
    waitingDays,
    author,
    target,
    container,
    commentExcerpt,
  } satisfies MentionAttentionItem;
}

describe("AttentionView unanswered mentions", () => {
  beforeEach(() => {
    refreshMock.mockReset();
  });

  it("renders unanswered mention overview, rankings, filters, and list interactions", async () => {
    const user = userEvent.setup();

    const repo = buildRepository(
      "repo-main",
      "github-dashboard",
      "acme/github-dashboard",
    );

    const alice = buildUser("user-alice", "Alice", "alice");
    const bob = buildUser("user-bob", "Bob", "bob");
    const carol = buildUser("user-carol", "Carol", "carol");
    const dave = buildUser("user-dave", "Dave", "dave");

    const primaryMention = buildMentionItem({
      commentId: "comment-primary",
      url: "https://github.com/acme/github-dashboard/pull/58#discussion_r1",
      mentionedAt: "2024-02-01T09:00:00.000Z",
      waitingDays: 11,
      author: alice,
      target: bob,
      container: {
        type: "pull_request",
        id: "pr-58",
        number: 58,
        title: "Refine caching behavior",
        url: "https://github.com/acme/github-dashboard/pull/58",
        repository: repo,
      },
      commentExcerpt: "Please review the API contract update before release.",
    });

    const issueMention = buildMentionItem({
      commentId: "comment-issue",
      url: "https://github.com/acme/github-dashboard/issues/99#issuecomment-1",
      mentionedAt: "2024-02-02T10:00:00.000Z",
      waitingDays: 9,
      author: alice,
      target: carol,
      container: {
        type: "issue",
        id: "issue-99",
        number: 99,
        title: "Production rollout checklist",
        url: "https://github.com/acme/github-dashboard/issues/99",
        repository: repo,
      },
      commentExcerpt: "Need a final sign-off on the rollout checklist items.",
    });

    const discussionMention = buildMentionItem({
      commentId: "comment-discussion",
      url: "https://github.com/acme/github-dashboard/discussions/42#discussioncomment-1",
      mentionedAt: "2024-02-03T12:00:00.000Z",
      waitingDays: 7,
      author: alice,
      target: bob,
      container: {
        type: "discussion",
        id: "discussion-42",
        number: 42,
        title: "Q1 release coordination",
        url: "https://github.com/acme/github-dashboard/discussions/42",
        repository: repo,
      },
      commentExcerpt: "Looping in @bob for additional context on the rollout.",
    });

    const secondaryMention = buildMentionItem({
      commentId: "comment-secondary",
      url: "https://github.com/acme/github-dashboard/pull/70#discussion_r2",
      mentionedAt: "2024-02-05T11:00:00.000Z",
      waitingDays: 6,
      author: dave,
      target: bob,
      container: {
        type: "pull_request",
        id: "pr-70",
        number: 70,
        title: "Fix metrics export",
        url: "https://github.com/acme/github-dashboard/pull/70",
        repository: repo,
      },
      commentExcerpt:
        "Could you add integration tests to cover the metrics export?",
    });

    const insights: AttentionInsights = {
      generatedAt: "2024-02-20T00:00:00.000Z",
      timezone: "Asia/Seoul",
      staleOpenPrs: [],
      idleOpenPrs: [],
      stuckReviewRequests: [],
      backlogIssues: [],
      stalledInProgressIssues: [],
      unansweredMentions: [
        primaryMention,
        issueMention,
        discussionMention,
        secondaryMention,
      ],
    } satisfies AttentionInsights;

    render(<AttentionView insights={insights} />);

    expect(
      screen.getByText("최다 멘션 대상: 1위 Bob, 2위 Carol"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("최다 요청자: 1위 Alice, 2위 Dave"),
    ).toBeInTheDocument();

    const menuButton = screen.getByRole("button", {
      name: /응답 없는 멘션/,
    });
    await user.click(menuButton);

    expect(
      screen.getByText(
        "주말과 공휴일을 제외하고 5일 넘게 리뷰 제출, 댓글, 리액션 중 어떤 응답도 없었던 멘션을 모았습니다.",
      ),
    ).toBeInTheDocument();

    expect(
      screen.getByText("멘션 대상 경과일수 합계 순위"),
    ).toBeInTheDocument();
    expect(screen.getByText("멘션 대상 건수 순위")).toBeInTheDocument();
    expect(screen.getByText("요청자 경과일수 합계 순위")).toBeInTheDocument();
    expect(screen.getByText("요청자 건수 순위")).toBeInTheDocument();

    const targetTotalCard = screen.getByText(
      "멘션 대상 경과일수 합계 순위",
    ).parentElement;
    const authorTotalCard = screen.getByText(
      "요청자 경과일수 합계 순위",
    ).parentElement;

    if (!targetTotalCard || !authorTotalCard) {
      throw new Error("Expected ranking cards to be present");
    }

    const [targetRankTop] = within(targetTotalCard).getAllByRole("listitem");
    const [authorRankTop] = within(authorTotalCard).getAllByRole("listitem");

    expect(targetRankTop).toHaveTextContent("1. Bob (@bob)");
    expect(targetRankTop).toHaveTextContent("24일");
    expect(authorRankTop).toHaveTextContent("1. Alice (@alice)");
    expect(authorRankTop).toHaveTextContent("27일");

    const targetFilter = screen.getByLabelText("멘션 대상 필터");
    const authorFilter = screen.getByLabelText("요청자 필터");

    const primaryItem = screen
      .getByText("acme/github-dashboard#58 코멘트")
      .closest("li");
    const issueItem = screen
      .getByText("acme/github-dashboard#99 코멘트")
      .closest("li");
    const discussionItem = screen
      .getByText("acme/github-dashboard#42 코멘트")
      .closest("li");
    const secondaryItem = screen
      .getByText("acme/github-dashboard#70 코멘트")
      .closest("li");

    expect(primaryItem).not.toBeNull();
    expect(issueItem).not.toBeNull();
    expect(discussionItem).not.toBeNull();
    expect(secondaryItem).not.toBeNull();

    if (!primaryItem || !issueItem || !discussionItem || !secondaryItem) {
      throw new Error("Expected unanswered mention list items to exist");
    }

    expect(within(primaryItem).getByText("Idle 11일")).toBeInTheDocument();
    expect(
      within(primaryItem).getByText("멘션 대상 Bob (@bob)"),
    ).toBeInTheDocument();
    expect(
      within(primaryItem).getByText("요청자 Alice (@alice)"),
    ).toBeInTheDocument();
    expect(
      within(primaryItem).getByText("Mention @bob 11일"),
    ).toBeInTheDocument();

    expect(within(issueItem).getByText("Idle 9일")).toBeInTheDocument();
    expect(
      within(issueItem).getByText("Mention @carol 9일"),
    ).toBeInTheDocument();

    expect(within(discussionItem).getByText("Idle 7일")).toBeInTheDocument();
    expect(
      within(discussionItem).getByText("Mention @bob 7일"),
    ).toBeInTheDocument();

    expect(within(secondaryItem).getByText("Idle 6일")).toBeInTheDocument();
    expect(
      within(secondaryItem).getByText("Mention @bob 6일"),
    ).toBeInTheDocument();

    await user.selectOptions(targetFilter, "user-carol");

    await waitFor(() => {
      expect(
        screen.getByText("acme/github-dashboard#99 코멘트"),
      ).toBeInTheDocument();
      expect(
        screen.queryByText("acme/github-dashboard#58 코멘트"),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByText("acme/github-dashboard#70 코멘트"),
      ).not.toBeInTheDocument();
    });

    await user.selectOptions(authorFilter, "user-dave");

    await waitFor(() => {
      expect(
        screen.getByText("선택한 조건에 해당하는 멘션이 없습니다."),
      ).toBeInTheDocument();
    });

    await user.selectOptions(targetFilter, "all");

    await waitFor(() => {
      expect(
        screen.getByText("acme/github-dashboard#70 코멘트"),
      ).toBeInTheDocument();
      expect(
        screen.queryByText("acme/github-dashboard#42 코멘트"),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByText("acme/github-dashboard#99 코멘트"),
      ).not.toBeInTheDocument();
    });

    await user.selectOptions(authorFilter, "all");

    await waitFor(() => {
      expect(
        screen.getByText("acme/github-dashboard#58 코멘트"),
      ).toBeInTheDocument();
      expect(
        screen.getByText("acme/github-dashboard#99 코멘트"),
      ).toBeInTheDocument();
      expect(
        screen.getByText("acme/github-dashboard#42 코멘트"),
      ).toBeInTheDocument();
      expect(
        screen.getByText("acme/github-dashboard#70 코멘트"),
      ).toBeInTheDocument();
    });
  });
});
