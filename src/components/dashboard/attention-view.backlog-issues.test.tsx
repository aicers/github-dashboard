import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { AttentionView } from "@/components/dashboard/attention-view";
import type {
  ActivityItem,
  ActivityItemDetail,
  ActivityUser,
} from "@/lib/activity/types";
import type {
  AttentionInsights,
  IssueAttentionItem,
  RepositoryReference,
  UserReference,
} from "@/lib/dashboard/attention";

const refreshMock = vi.fn();
const mockFetchActivityDetail =
  vi.fn<(...args: unknown[]) => Promise<ActivityItemDetail>>();

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    refresh: refreshMock,
  }),
}));

vi.mock("@/lib/activity/client", () => ({
  fetchActivityDetail: (...args: unknown[]) => mockFetchActivityDetail(...args),
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
  repositoryMaintainers?: UserReference[];
  assignees: UserReference[];
  createdAt: string;
  updatedAt: string | null;
  ageDays: number;
  overrides?: Partial<IssueAttentionItem>;
}): IssueAttentionItem {
  const {
    id,
    number,
    title,
    url,
    repository,
    author,
    repositoryMaintainers = [author],
    assignees,
    createdAt,
    updatedAt,
    ageDays,
    overrides = {},
  } = params;

  return {
    id,
    number,
    title,
    url,
    repository,
    repositoryMaintainers: repositoryMaintainers ?? [],
    author,
    assignees,
    linkedPullRequests: [],
    labels: [],
    issueType: null,
    milestone: null,
    createdAt,
    updatedAt,
    ageDays,
    startedAt: null,
    inProgressAgeDays: undefined,
    ...overrides,
  } satisfies IssueAttentionItem;
}

function toActivityUser(user: UserReference | null): ActivityUser | null {
  if (!user) {
    return null;
  }
  return {
    id: user.id,
    login: user.login,
    name: user.name,
    avatarUrl: null,
  };
}

function toActivityUsers(users: UserReference[]): ActivityUser[] {
  return users.map(
    (user) =>
      ({
        id: user.id,
        login: user.login,
        name: user.name,
        avatarUrl: null,
      }) satisfies ActivityUser,
  );
}

function buildActivityDetailFromIssue(
  issue: IssueAttentionItem,
  attention: "backlog" | "stalled",
): ActivityItemDetail {
  const attentionFlags = {
    unansweredMention: false,
    reviewRequestPending: false,
    reviewerUnassignedPr: false,
    reviewStalledPr: false,
    mergeDelayedPr: false,
    backlogIssue: attention === "backlog",
    stalledIssue: attention === "stalled",
  };

  const activityItem: ActivityItem = {
    id: issue.id,
    type: "issue",
    number: issue.number,
    title: issue.title,
    url: issue.url,
    state: "open",
    status: "open",
    issueProjectStatus: issue.issueProjectStatus ?? null,
    issueProjectStatusSource: issue.issueProjectStatusSource ?? "none",
    issueProjectStatusLocked: issue.issueProjectStatusLocked ?? false,
    issueTodoProjectStatus: issue.issueTodoProjectStatus ?? null,
    issueTodoProjectStatusAt: null,
    issueTodoProjectPriority: issue.issueTodoProjectPriority ?? null,
    issueTodoProjectPriorityUpdatedAt: null,
    issueTodoProjectWeight: issue.issueTodoProjectWeight ?? null,
    issueTodoProjectWeightUpdatedAt: null,
    issueTodoProjectInitiationOptions:
      issue.issueTodoProjectInitiationOptions ?? null,
    issueTodoProjectInitiationOptionsUpdatedAt: null,
    issueTodoProjectStartDate: issue.issueTodoProjectStartDate ?? null,
    issueTodoProjectStartDateUpdatedAt: null,
    issueActivityStatus: null,
    issueActivityStatusAt: null,
    repository: issue.repository
      ? {
          id: issue.repository.id,
          name: issue.repository.name,
          nameWithOwner: issue.repository.nameWithOwner,
        }
      : null,
    author: toActivityUser(issue.author),
    assignees: toActivityUsers(issue.assignees),
    reviewers: [],
    mentionedUsers: [],
    commenters: [],
    reactors: [],
    labels: issue.labels ?? [],
    issueType: null,
    milestone: null,
    linkedPullRequests: issue.linkedPullRequests ?? [],
    linkedIssues: [],
    hasParentIssue: false,
    hasSubIssues: false,
    createdAt: issue.createdAt,
    updatedAt: issue.updatedAt,
    closedAt: null,
    mergedAt: null,
    businessDaysOpen: issue.ageDays ?? null,
    businessDaysIdle: issue.inactivityDays ?? null,
    businessDaysSinceInProgress: issue.inProgressAgeDays ?? null,
    businessDaysInProgressOpen: issue.inProgressAgeDays ?? null,
    attention: attentionFlags,
  };

  return {
    item: activityItem,
    body: null,
    bodyHtml: null,
    raw: null,
    parentIssues: [],
    subIssues: [],
    comments: [],
    commentCount: 0,
    linkedPullRequests: activityItem.linkedPullRequests,
    linkedIssues: [],
    reactions: [],
  };
}

describe("AttentionView backlog issues", () => {
  beforeEach(() => {
    refreshMock.mockReset();
    mockFetchActivityDetail.mockReset();
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
        overrides: {
          inactivityDays: 22,
          issueProjectStatus: "todo",
          issueProjectStatusSource: "todo_project",
          issueTodoProjectStatus: "todo",
          issueTodoProjectPriority: "P0",
          labels: [
            {
              key: "label::bug",
              name: "Bug",
              repositoryId: repositoryOne.id,
              repositoryNameWithOwner: repositoryOne.nameWithOwner,
            },
          ],
        },
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
        overrides: {
          inactivityDays: 12,
          issueProjectStatus: "in_progress",
          issueProjectStatusSource: "todo_project",
          issueTodoProjectStatus: "in_progress",
          issueTodoProjectPriority: "P1",
        },
      }),
    ];

    mockFetchActivityDetail.mockImplementation((id: unknown) => {
      const issueId = String(id);
      if (issueId === backlogItems[0].id) {
        return Promise.resolve(
          buildActivityDetailFromIssue(backlogItems[0], "backlog"),
        );
      }
      if (issueId === backlogItems[1].id) {
        return Promise.resolve(
          buildActivityDetailFromIssue(backlogItems[1], "backlog"),
        );
      }
      return Promise.reject(new Error(`Unexpected fetch id ${issueId}`));
    });

    const insights: AttentionInsights = {
      generatedAt: "2024-02-20T00:00:00.000Z",
      timezone: "Asia/Seoul",
      dateTimeFormat: "auto",
      reviewerUnassignedPrs: [],
      reviewStalledPrs: [],
      mergeDelayedPrs: [],
      stuckReviewRequests: [],
      backlogIssues: backlogItems,
      stalledInProgressIssues: [],
      unansweredMentions: [],
      organizationMaintainers: [alice, carol],
      repositoryMaintainersByRepository: {
        [repositoryOne.id]: [alice],
        [repositoryTwo.id]: [carol],
      },
    } satisfies AttentionInsights;

    render(<AttentionView insights={insights} />);

    expect(
      screen.getByText("최다 작성자: 1위 Alice, 2위 Carol"),
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
    expect(
      screen.getByText("저장소 책임자 경과일수 합계 순위"),
    ).toBeInTheDocument();
    expect(screen.getByText("저장소 책임자 건수 순위")).toBeInTheDocument();

    const maintainerFilter = screen.getByLabelText("저장소 책임자 필터");
    await user.selectOptions(maintainerFilter, alice.id);

    expect(
      screen.queryByText("Improve deployment configurables"),
    ).not.toBeInTheDocument();
    expect(screen.getByText("Refactor backlog workflows")).toBeInTheDocument();

    await user.selectOptions(maintainerFilter, "all");

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
    expect(within(firstItem).getByText("작성자 alice")).toBeInTheDocument();
    expect(
      within(firstItem).getByText("담당자 bob, carol"),
    ).toBeInTheDocument();
    expect(within(firstItem).getByText("Age 60일")).toBeInTheDocument();
    expect(within(firstItem).getByText("Idle 22일")).toBeInTheDocument();
    expect(within(firstItem).getByText("Todo")).toBeInTheDocument();
    expect(within(firstItem).getByText("P0")).toBeInTheDocument();
    await user.click(within(firstItem).getByRole("button"));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("Bug")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "닫기" }));
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });

    expect(
      within(secondItem).getByText("acme/repo-two#202"),
    ).toBeInTheDocument();
    expect(within(secondItem).getByText("작성자 carol")).toBeInTheDocument();
    expect(within(secondItem).getByText("담당자 bob")).toBeInTheDocument();
    expect(within(secondItem).getByText("Age 35일")).toBeInTheDocument();
    expect(within(secondItem).getByText("Idle 12일")).toBeInTheDocument();
    expect(within(secondItem).getByText("In Progress")).toBeInTheDocument();
    expect(within(secondItem).getByText("P1")).toBeInTheDocument();

    expect(screen.getByText("작성자 경과일수 합계 순위")).toBeInTheDocument();
    expect(screen.getByText("담당자 건수 순위")).toBeInTheDocument();

    const authorFilter = screen.getByLabelText("작성자 필터");
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
