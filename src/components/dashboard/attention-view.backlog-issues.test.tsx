import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { AttentionView } from "@/components/dashboard/attention-view";
import type {
  AttentionInsights,
  IssueAttentionItem,
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

function buildIssueItem(params: {
  id: string;
  number: number;
  title: string;
  url: string;
  repository: RepositoryReference;
  author: UserReference;
  assignees: UserReference[];
  createdAt: string;
  updatedAt: string | null;
  ageDays: number;
}): IssueAttentionItem {
  const {
    id,
    number,
    title,
    url,
    repository,
    author,
    assignees,
    createdAt,
    updatedAt,
    ageDays,
  } = params;

  return {
    id,
    number,
    title,
    url,
    repository,
    author,
    assignees,
    linkedPullRequests: [],
    createdAt,
    updatedAt,
    ageDays,
    startedAt: null,
    inProgressAgeDays: undefined,
  } satisfies IssueAttentionItem;
}

describe("AttentionView backlog issues", () => {
  beforeEach(() => {
    refreshMock.mockReset();
  });

  it("shows backlog issue overview, ranking summaries, and interactive filters", async () => {
    const user = userEvent.setup();

    const alice = buildUser("user-alice", "Alice", "alice");
    const bob = buildUser("user-bob", "Bob", "bob");
    const carol = buildUser("user-carol", "Carol", "carol");

    const repositoryOne = buildRepository(
      "repo-one",
      "Repo One",
      "acme/repo-one",
    );
    const repositoryTwo = buildRepository(
      "repo-two",
      "Repo Two",
      "acme/repo-two",
    );

    const backlogItems: IssueAttentionItem[] = [
      buildIssueItem({
        id: "issue-1",
        number: 101,
        title: "Refactor backlog workflows",
        url: "https://github.com/acme/repo-one/issues/101",
        repository: repositoryOne,
        author: alice,
        assignees: [bob, carol],
        createdAt: "2023-12-01T00:00:00.000Z",
        updatedAt: "2024-02-15T12:00:00.000Z",
        ageDays: 60,
      }),
      buildIssueItem({
        id: "issue-2",
        number: 202,
        title: "Improve deployment configurables",
        url: "https://github.com/acme/repo-two/issues/202",
        repository: repositoryTwo,
        author: carol,
        assignees: [bob],
        createdAt: "2023-12-18T00:00:00.000Z",
        updatedAt: "2024-02-12T12:00:00.000Z",
        ageDays: 35,
      }),
    ];

    const insights: AttentionInsights = {
      generatedAt: "2024-02-20T00:00:00.000Z",
      timezone: "Asia/Seoul",
      dateTimeFormat: "auto",
      staleOpenPrs: [],
      idleOpenPrs: [],
      stuckReviewRequests: [],
      backlogIssues: backlogItems,
      stalledInProgressIssues: [],
      unansweredMentions: [],
    } satisfies AttentionInsights;

    render(<AttentionView insights={insights} />);

    expect(
      screen.getByText("최다 생성자: 1위 Alice, 2위 Carol"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("최다 담당자: 1위 Bob, 2위 Carol"),
    ).toBeInTheDocument();
    expect(screen.getByText("2건")).toBeInTheDocument();
    expect(screen.getByText("95일")).toBeInTheDocument();

    const menuButton = screen.getByRole("button", {
      name: /정체된 Backlog 이슈/,
    });
    await user.click(menuButton);

    expect(
      screen.getByText("40일 이상 In Progress로 이동하지 않은 이슈"),
    ).toBeInTheDocument();
    expect(screen.getByText("Refactor backlog workflows")).toBeInTheDocument();
    expect(
      screen.getByText("Improve deployment configurables"),
    ).toBeInTheDocument();

    const firstItem = screen
      .getByText("Refactor backlog workflows")
      .closest("li");
    const secondItem = screen
      .getByText("Improve deployment configurables")
      .closest("li");

    if (!firstItem || !secondItem) {
      throw new Error("Expected backlog issue list items to be present");
    }

    expect(
      within(firstItem).getByText("acme/repo-one#101"),
    ).toBeInTheDocument();
    expect(
      within(firstItem).getByText("생성자 Alice (@alice)"),
    ).toBeInTheDocument();
    expect(
      within(firstItem).getByText("담당자 Bob (@bob), Carol (@carol)"),
    ).toBeInTheDocument();
    expect(within(firstItem).getByText("Age 60일")).toBeInTheDocument();

    expect(
      within(secondItem).getByText("acme/repo-two#202"),
    ).toBeInTheDocument();
    expect(
      within(secondItem).getByText("생성자 Carol (@carol)"),
    ).toBeInTheDocument();
    expect(
      within(secondItem).getByText("담당자 Bob (@bob)"),
    ).toBeInTheDocument();
    expect(within(secondItem).getByText("Age 35일")).toBeInTheDocument();

    expect(screen.getByText("생성자 경과일수 합계 순위")).toBeInTheDocument();
    expect(screen.getByText("담당자 건수 순위")).toBeInTheDocument();

    const authorFilter = screen.getByLabelText("생성자 필터");
    await user.selectOptions(authorFilter, carol.id);

    expect(
      screen.queryByText("Refactor backlog workflows"),
    ).not.toBeInTheDocument();
    expect(
      screen.getByText("Improve deployment configurables"),
    ).toBeInTheDocument();

    await user.selectOptions(authorFilter, "all");

    const assigneeFilter = screen.getByLabelText("담당자 필터");
    await user.selectOptions(assigneeFilter, carol.id);

    expect(screen.getByText("Refactor backlog workflows")).toBeInTheDocument();
    expect(
      screen.queryByText("Improve deployment configurables"),
    ).not.toBeInTheDocument();

    await user.selectOptions(assigneeFilter, "all");

    expect(refreshMock).not.toHaveBeenCalled();
  });
});
