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
  linkedPullRequests?: IssueAttentionItem["linkedPullRequests"];
  createdAt: string;
  updatedAt: string | null;
  ageDays: number;
  startedAt: string;
  inProgressAgeDays: number;
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
    linkedPullRequests = [],
    createdAt,
    updatedAt,
    ageDays,
    startedAt,
    inProgressAgeDays,
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
    linkedPullRequests,
    labels: [],
    issueType: null,
    milestone: null,
    createdAt,
    updatedAt,
    ageDays,
    startedAt,
    inProgressAgeDays,
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
    staleOpenPr: false,
    idlePr: false,
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

describe("AttentionView stalled in-progress issues", () => {
  beforeEach(() => {
    refreshMock.mockReset();
    mockFetchActivityDetail.mockReset();
  });

  it("shows stalled issue overview, rankings, and interactive filters", async () => {
    const user = userEvent.setup();

    const alice = buildUser("user-alice", "Alice", "alice");
    const bob = buildUser("user-bob", "Bob", "bob");
    const carol = buildUser("user-carol", "Carol", "carol");
    const dave = buildUser("user-dave", "Dave", "dave");
    const oliver = buildUser("user-oliver", "Oliver", "oliver");
    const reina = buildUser("user-reina", "Reina", "reina");

    const repository = buildRepository(
      "repo-engineering",
      "engineering",
      "acme/engineering",
    );

    const stalledItems: IssueAttentionItem[] = [
      buildIssueItem({
        id: "issue-1",
        number: 310,
        title: "Stabilize rollout scripts",
        url: "https://github.com/acme/engineering/issues/310",
        repository,
        repositoryMaintainers: [oliver],
        author: alice,
        assignees: [bob, dave],
        createdAt: "2023-12-01T00:00:00.000Z",
        updatedAt: "2024-02-18T12:00:00.000Z",
        ageDays: 55,
        startedAt: "2024-01-02T09:00:00.000Z",
        inProgressAgeDays: 35,
        overrides: {
          inactivityDays: 18,
          issueProjectStatus: "in_progress",
          issueProjectStatusSource: "todo_project",
          issueTodoProjectStatus: "in_progress",
          issueTodoProjectPriority: "P0",
          labels: [
            {
              key: "label::frontend",
              name: "Frontend",
              repositoryId: repository.id,
              repositoryNameWithOwner: repository.nameWithOwner,
            },
          ],
        },
      }),
      buildIssueItem({
        id: "issue-2",
        number: 311,
        title: "Improve telemetry reliability",
        url: "https://github.com/acme/engineering/issues/311",
        repository,
        repositoryMaintainers: [reina],
        author: carol,
        assignees: [bob],
        createdAt: "2023-12-15T00:00:00.000Z",
        updatedAt: "2024-02-19T12:00:00.000Z",
        ageDays: 50,
        startedAt: "2024-01-10T09:00:00.000Z",
        inProgressAgeDays: 30,
        overrides: {
          inactivityDays: 9,
          issueProjectStatus: "pending",
          issueProjectStatusSource: "todo_project",
          issueTodoProjectStatus: "pending",
          issueTodoProjectPriority: "P2",
        },
      }),
    ];

    mockFetchActivityDetail.mockImplementation((id: unknown) => {
      const issueId = String(id);
      if (issueId === stalledItems[0].id) {
        return Promise.resolve(
          buildActivityDetailFromIssue(stalledItems[0], "stalled"),
        );
      }
      if (issueId === stalledItems[1].id) {
        return Promise.resolve(
          buildActivityDetailFromIssue(stalledItems[1], "stalled"),
        );
      }
      return Promise.reject(new Error(`Unexpected fetch id ${issueId}`));
    });

    const insights: AttentionInsights = {
      generatedAt: "2024-02-20T00:00:00.000Z",
      timezone: "Asia/Seoul",
      dateTimeFormat: "auto",
      staleOpenPrs: [],
      idleOpenPrs: [],
      stuckReviewRequests: [],
      backlogIssues: [],
      stalledInProgressIssues: stalledItems,
      unansweredMentions: [],
    } satisfies AttentionInsights;

    render(<AttentionView insights={insights} />);

    expect(
      screen.getByText("최다 저장소 책임자: 1위 Oliver, 2위 Reina"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("최다 담당자: 1위 Bob, 2위 Dave"),
    ).toBeInTheDocument();
    expect(screen.getByText("2건")).toBeInTheDocument();
    expect(screen.getByText("65일")).toBeInTheDocument();

    const menuButton = screen.getByRole("button", {
      name: /정체된 In Progress 이슈/,
    });
    await user.click(menuButton);

    expect(
      screen.getByText("In Progress에서 20일 이상 머문 이슈"),
    ).toBeInTheDocument();

    expect(screen.getByText("Stabilize rollout scripts")).toBeInTheDocument();
    expect(
      screen.getByText("Improve telemetry reliability"),
    ).toBeInTheDocument();

    const firstItem = screen
      .getByText("Stabilize rollout scripts")
      .closest("li");
    const secondItem = screen
      .getByText("Improve telemetry reliability")
      .closest("li");

    if (!firstItem || !secondItem) {
      throw new Error("Expected stalled issue list items to be present");
    }

    expect(
      within(firstItem).getByText("acme/engineering#310"),
    ).toBeInTheDocument();
    expect(
      within(firstItem).getByText("작성자 Alice (@alice)"),
    ).toBeInTheDocument();
    expect(
      within(firstItem).getByText("담당자 Bob (@bob), Dave (@dave)"),
    ).toBeInTheDocument();
    expect(within(firstItem).getByText("Age 55일")).toBeInTheDocument();
    expect(within(firstItem).getByText("Progress 35일")).toBeInTheDocument();
    expect(within(firstItem).getByText("Idle 18일")).toBeInTheDocument();
    expect(within(firstItem).getByText("In Progress")).toBeInTheDocument();
    expect(within(firstItem).getByText("P0")).toBeInTheDocument();
    await user.click(within(firstItem).getByRole("button"));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("Frontend")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "닫기" }));
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });

    expect(
      within(secondItem).getByText("acme/engineering#311"),
    ).toBeInTheDocument();
    expect(
      within(secondItem).getByText("작성자 Carol (@carol)"),
    ).toBeInTheDocument();
    expect(
      within(secondItem).getByText("담당자 Bob (@bob)"),
    ).toBeInTheDocument();
    expect(within(secondItem).getByText("Age 50일")).toBeInTheDocument();
    expect(within(secondItem).getByText("Progress 30일")).toBeInTheDocument();
    expect(within(secondItem).getByText("Idle 9일")).toBeInTheDocument();
    expect(within(secondItem).getByText("Pending")).toBeInTheDocument();
    expect(within(secondItem).getByText("P2")).toBeInTheDocument();

    expect(
      screen.getByText("저장소 책임자 In Progress 경과일수 합계 순위"),
    ).toBeInTheDocument();
    expect(screen.getByText("저장소 책임자 건수 순위")).toBeInTheDocument();
    expect(
      screen.getByText("담당자 In Progress 경과일수 합계 순위"),
    ).toBeInTheDocument();
    expect(screen.getByText("담당자 건수 순위")).toBeInTheDocument();

    const repositoryMaintainerFilter =
      screen.getByLabelText("저장소 책임자 필터");
    await user.selectOptions(repositoryMaintainerFilter, reina.id);

    expect(
      screen.queryByText("Stabilize rollout scripts"),
    ).not.toBeInTheDocument();
    expect(
      screen.getByText("Improve telemetry reliability"),
    ).toBeInTheDocument();

    await user.selectOptions(repositoryMaintainerFilter, "all");

    const assigneeFilter = screen.getByLabelText("담당자 필터");
    await user.selectOptions(assigneeFilter, dave.id);

    expect(screen.getByText("Stabilize rollout scripts")).toBeInTheDocument();
    expect(
      screen.queryByText("Improve telemetry reliability"),
    ).not.toBeInTheDocument();

    await user.selectOptions(assigneeFilter, "all");

    expect(refreshMock).not.toHaveBeenCalled();
  });
});
