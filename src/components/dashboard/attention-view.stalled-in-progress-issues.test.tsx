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
  linkedPullRequests?: IssueAttentionItem["linkedPullRequests"];
  createdAt: string;
  updatedAt: string | null;
  ageDays: number;
  startedAt: string;
  inProgressAgeDays: number;
}): IssueAttentionItem {
  const {
    id,
    number,
    title,
    url,
    repository,
    author,
    assignees,
    linkedPullRequests = [],
    createdAt,
    updatedAt,
    ageDays,
    startedAt,
    inProgressAgeDays,
  } = params;

  return {
    id,
    number,
    title,
    url,
    repository,
    author,
    assignees,
    linkedPullRequests,
    createdAt,
    updatedAt,
    ageDays,
    startedAt,
    inProgressAgeDays,
  } satisfies IssueAttentionItem;
}

describe("AttentionView stalled in-progress issues", () => {
  beforeEach(() => {
    refreshMock.mockReset();
  });

  it("shows stalled issue overview, rankings, and interactive filters", async () => {
    const user = userEvent.setup();

    const alice = buildUser("user-alice", "Alice", "alice");
    const bob = buildUser("user-bob", "Bob", "bob");
    const carol = buildUser("user-carol", "Carol", "carol");
    const dave = buildUser("user-dave", "Dave", "dave");

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
        author: alice,
        assignees: [bob, dave],
        createdAt: "2023-12-01T00:00:00.000Z",
        updatedAt: "2024-02-18T12:00:00.000Z",
        ageDays: 55,
        startedAt: "2024-01-02T09:00:00.000Z",
        inProgressAgeDays: 35,
      }),
      buildIssueItem({
        id: "issue-2",
        number: 311,
        title: "Improve telemetry reliability",
        url: "https://github.com/acme/engineering/issues/311",
        repository,
        author: carol,
        assignees: [bob],
        createdAt: "2023-12-15T00:00:00.000Z",
        updatedAt: "2024-02-19T12:00:00.000Z",
        ageDays: 50,
        startedAt: "2024-01-10T09:00:00.000Z",
        inProgressAgeDays: 30,
      }),
    ];

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
      screen.getByText("최다 생성자: 1위 Alice, 2위 Carol"),
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
      within(firstItem).getByText("생성자 Alice (@alice)"),
    ).toBeInTheDocument();
    expect(
      within(firstItem).getByText("담당자 Bob (@bob), Dave (@dave)"),
    ).toBeInTheDocument();
    expect(within(firstItem).getByText("Age 55일")).toBeInTheDocument();
    expect(within(firstItem).getByText("Progress 35일")).toBeInTheDocument();

    expect(
      within(secondItem).getByText("acme/engineering#311"),
    ).toBeInTheDocument();
    expect(
      within(secondItem).getByText("생성자 Carol (@carol)"),
    ).toBeInTheDocument();
    expect(
      within(secondItem).getByText("담당자 Bob (@bob)"),
    ).toBeInTheDocument();
    expect(within(secondItem).getByText("Age 50일")).toBeInTheDocument();
    expect(within(secondItem).getByText("Progress 30일")).toBeInTheDocument();

    expect(
      screen.getByText("생성자 In Progress 경과일수 합계 순위"),
    ).toBeInTheDocument();
    expect(screen.getByText("생성자 건수 순위")).toBeInTheDocument();
    expect(
      screen.getByText("담당자 In Progress 경과일수 합계 순위"),
    ).toBeInTheDocument();
    expect(screen.getByText("담당자 건수 순위")).toBeInTheDocument();

    const authorFilter = screen.getByLabelText("생성자 필터");
    await user.selectOptions(authorFilter, carol.id);

    expect(
      screen.queryByText("Stabilize rollout scripts"),
    ).not.toBeInTheDocument();
    expect(
      screen.getByText("Improve telemetry reliability"),
    ).toBeInTheDocument();

    await user.selectOptions(authorFilter, "all");

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
